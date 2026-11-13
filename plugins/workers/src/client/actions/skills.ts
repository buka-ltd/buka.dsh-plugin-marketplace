/**
 * 「打工人」页面的项目级 skills 动作：读收藏仓库、列候选、安装与移除。
 *
 * @module @buka/dsh-plugin-workers/client/actions/skills
 */

import { claudeOf, failureText, outputOf, requestJson, skillsOf } from '../api.ts'
import {
  AVAILABLE_ROUTE,
  INSTALL_ROUTE,
  SKILL_REMOVE_ROUTE,
  SKILLS_REPOS_ROUTE,
} from '../constants.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate, Worker, WorkerClaude } from '../types.ts'

/**
 * 构造 skills 动作。
 *
 */
export function createSkillActions(state: WorkersPageState, t: Translate) {
  const {
    favourites,
    setFavourites,
    setInstallOpen,
    installCandidates,
    setInstallCandidates,
    installSource,
    setInstallSource,
    installSelected,
    setInstallSelected,
    setInstallError,
    installing,
    setInstalling,
    selectedWorker,
    patchWorker,
    flash,
    corrupt,
    removing,
    setRemoving,
    setConfirmingSkill,
    setSkillError,
  } = state

  /**
   * 读 Skills 插件的收藏仓库。只读它已经存在的 `GET /buka-skills/repos`：
   * 两个插件之间不 import，这个路由回 404（插件没装）或任何失败都按
   * 「没有收藏夹」处理，页面不显示这一块也不报错。
   */
  function loadFavourites() {
    if (favourites.status === 'loading' || favourites.status === 'ready') return
    setFavourites((prev) => ({ ...prev, status: 'loading' }))
    requestJson(SKILLS_REPOS_ROUTE).then(
      (body) => {
        const repos = (Array.isArray(body?.repos) ? body.repos : [])
          .filter(
            (repo) =>
              repo !== null &&
              typeof repo === 'object' &&
              typeof repo.source === 'string' &&
              repo.source !== '',
          )
          .map((repo) => ({
            id: typeof repo.id === 'string' && repo.id !== '' ? repo.id : (repo.source ?? ''),
            source: repo.source ?? '',
            note: typeof repo.note === 'string' ? repo.note : '',
          }))
        setFavourites({ status: 'ready', repos })
      },
      () => setFavourites({ status: 'unavailable', repos: [] }),
    )
  }

  /** 打开「安装 skills」对话框：清掉上一次的来源、候选与勾选，并按需加载收藏夹。 */
  function openInstallDialog() {
    if (installing || corrupt) return
    setInstallSource('')
    setInstallCandidates({ status: 'idle', skills: [], installed: [], error: null, output: '' })
    setInstallSelected([])
    setInstallError(null)
    setInstallOpen(true)
    loadFavourites()
  }

  /** 关闭「安装 skills」对话框；安装中不响应关闭，避免请求回来时状态错位。 */
  function closeInstallDialog() {
    if (installing) return
    setInstallOpen(false)
    setInstallError(null)
  }

  /**
   * 读一个来源里的 skills 清单并默认勾选全部未安装的。
   *
   */
  async function loadCandidates(sourceOverride?: string) {
    if (installing || selectedWorker === null) return
    const value = (sourceOverride ?? installSource).trim()
    if (value === '') {
      setInstallCandidates({
        status: 'error',
        skills: [],
        installed: [],
        error: t('errInvalidSource'),
        output: '',
      })
      return
    }
    setInstallSource(value)
    setInstallCandidates({ status: 'loading', skills: [], installed: [], error: null, output: '' })
    setInstallError(null)
    try {
      const body = await requestJson(AVAILABLE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: selectedWorker.name, source: value }),
      })
      const skills = (Array.isArray(body?.skills) ? body.skills : []).filter(
        (skill) =>
          skill !== null &&
          typeof skill === 'object' &&
          typeof skill.name === 'string' &&
          skill.name !== '',
      )
      const installed = new Set(
        (Array.isArray(body?.installed) ? body.installed : []).map((name) => String(name)),
      )
      // 列表里的 skills 可能还没重新扫描过：把打工人现有的也并进来，保证已安装项一定禁用。
      for (const skill of skillsOf(selectedWorker)) installed.add(String(skill.name))
      setInstallCandidates({
        status: 'ready',
        skills,
        installed: [...installed],
        error: null,
        output: '',
      })
      setInstallSelected(
        skills.filter((skill) => !installed.has(skill.name)).map((skill) => skill.name),
      )
    } catch (failure) {
      setInstallCandidates({
        status: 'error',
        skills: [],
        installed: [],
        error: failureText(t, failure),
        output: outputOf(failure),
      })
    }
  }

  /**
   * 勾选 / 取消一个候选 skill。
   *
   */
  function toggleCandidate(skillName: string) {
    setInstallSelected((prev) =>
      prev.includes(skillName) ? prev.filter((name) => name !== skillName) : [...prev, skillName],
    )
  }

  /**
   * 全选 / 取消全选（已安装的不参与）。
   *
   */
  function selectAllCandidates(checked: boolean) {
    const installed = new Set(installCandidates.installed)
    const selectable = installCandidates.skills
      .filter((skill) => !installed.has(skill.name))
      .map((skill) => skill.name)
    setInstallSelected(checked ? selectable : [])
  }

  /**
   * 安装勾选的 skills：Host 在打工人目录里跑
   * `npx skills add <source> --skill … -a universal -a claude-code -y`，
   * 同时落 `.agents/skills` 与 `.claude/skills`；成功响应带新的 skills 列表。
   */
  async function installSelectedSkills() {
    if (installing || selectedWorker === null) return
    if (installSelected.length === 0) {
      setInstallError({ message: t('installEmptySelection'), output: '' })
      return
    }
    setInstalling(true)
    setInstallError(null)
    try {
      const body = await requestJson(INSTALL_ROUTE, {
        method: 'POST',
        body: JSON.stringify({
          name: selectedWorker.name,
          source: installSource.trim(),
          skills: installSelected,
        }),
      })
      patchWorker(selectedWorker.name, {
        skills: Array.isArray(body.skills) ? body.skills : [],
        claude:
          body.claude !== null && typeof body.claude === 'object'
            ? (body.claude as WorkerClaude)
            : claudeOf(selectedWorker),
      })
      setInstallOpen(false)
      flash('success', `${t('skillInstalled')} ${installSource.trim()}`)
    } catch (failure) {
      setInstallError({
        message: failureText(t, failure),
        output: outputOf(failure),
      })
    } finally {
      setInstalling(false)
    }
  }

  /**
   * 移除项目级 skill：Host 执行 `npx skills remove <skill> -y` 并返回新的
   * skills 列表；请求体字段是 `{ name, skill }`（路由契约）。
   *
   */
  async function removeSkill(worker: Worker, skill: { name: string }) {
    if (removing !== null) return
    setRemoving(skill.name)
    setSkillError(null)
    try {
      const body = await requestJson(SKILL_REMOVE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ name: worker.name, skill: skill.name }),
      })
      patchWorker(worker.name, { skills: Array.isArray(body.skills) ? body.skills : [] })
      setConfirmingSkill(null)
      flash('success', `${t('skillRemoved')} ${skill.name}`)
    } catch (failure) {
      setSkillError({ message: failureText(t, failure), output: outputOf(failure) })
    } finally {
      setRemoving(null)
    }
  }

  return {
    loadFavourites,
    openInstallDialog,
    closeInstallDialog,
    loadCandidates,
    toggleCandidate,
    selectAllCandidates,
    installSelectedSkills,
    removeSkill,
  }
}
