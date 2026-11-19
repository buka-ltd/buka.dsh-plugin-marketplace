/**
 * 「执行者」页面的项目级 skills 动作：读收藏仓库、列候选、安装与移除。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/actions/skills
 */

import {
  claudeOf,
  errorCode,
  failureText,
  messageOf,
  outputOf,
  requestJson,
  requestUpdateJson,
  skillsOf,
} from '../api.ts'
import {
  AVAILABLE_ROUTE,
  INSTALL_ROUTE,
  SKILL_CHECK_ROUTE,
  SKILL_REMOVE_ROUTE,
  SKILL_REPOS_ROUTE,
  SKILL_UPDATE_ALL_ROUTE,
  SKILL_UPDATE_ROUTE,
} from '../constants.ts'
import type { WorkersPageState } from '../state.ts'
import type {
  SkillCheckItem,
  Translate,
  Worker,
  WorkerClaude,
  WorkerSkillCheckSnapshot,
  WorkerSkillUpdateAllSnapshot,
  WorkerSkillUpdateSnapshot,
} from '../types.ts'

/**
 * 构造 skills 动作。
 *
 */
export function createSkillActions(state: WorkersPageState, t: Translate) {
  const {
    installRepos,
    setInstallRepos,
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
    reload,
    flash,
    corrupt,
    removing,
    setRemoving,
    setConfirmingSkill,
    setSkillError,
    setSkillChecks,
    updatingSkill,
    setUpdatingSkill,
    updatingAllSkills,
    setUpdatingAllSkills,
  } = state

  /** 候选清单请求序号：切换仓库时旧响应不能覆盖新仓库的清单。 */
  let candidatesSequence = 0

  /**
   * 读 Skills 插件的「技能仓库」。Host 通过 `ctx.bukaSkills` 读收藏，插件没装
   * 或版本太旧时回 503；页面据此显示安装提示，而不是让用户手填第三方来源。
   */
  async function loadInstallRepos() {
    if (installRepos.status === 'loading') return
    setInstallRepos({ status: 'loading', repos: [], corrupt: false, error: null })
    try {
      const body = await requestJson<{
        corrupt?: unknown
        repositories?: unknown
      }>(SKILL_REPOS_ROUTE)
      const repos = (Array.isArray(body?.repositories) ? body.repositories : [])
        .filter(
          (repo): repo is Record<string, unknown> =>
            repo !== null &&
            typeof repo === 'object' &&
            typeof repo.source === 'string' &&
            repo.source !== '',
        )
        .map((repo) => ({
          id: typeof repo.id === 'string' && repo.id !== '' ? repo.id : (repo.source as string),
          source: repo.source as string,
          note: typeof repo.note === 'string' ? repo.note : '',
          kind: typeof repo.kind === 'string' && repo.kind !== '' ? repo.kind : 'unknown',
          skills:
            typeof repo.skills === 'number' && Number.isFinite(repo.skills) ? repo.skills : null,
        }))
      setInstallRepos({
        status: 'ready',
        repos,
        corrupt: body?.corrupt === true,
        error: null,
      })
      // 打开对话框时直接读第一个可用的收藏仓库，少一次点击；用户可以换仓库。
      const first = repos.find((repo) => repo.kind !== 'unavailable') ?? repos[0]
      if (body?.corrupt !== true && first !== undefined) void loadCandidates(first.source)
    } catch (failure) {
      if (errorCode(failure) === 'skills-unavailable') {
        setInstallRepos({ status: 'unavailable', repos: [], corrupt: false, error: null })
        return
      }
      setInstallRepos({
        status: 'error',
        repos: [],
        corrupt: false,
        error: failureText(t, failure),
      })
    }
  }

  /** 打开「安装 skills」对话框：清掉上一次的来源、候选与勾选，再读技能仓库。 */
  function openInstallDialog() {
    if (installing || corrupt) return
    setInstallSource('')
    setInstallCandidates({ status: 'idle', skills: [], installed: [], error: null, output: '' })
    setInstallSelected([])
    setInstallError(null)
    setInstallOpen(true)
    void loadInstallRepos()
  }

  /** 换一个收藏仓库：重新读它的 skill 清单。 */
  function selectInstallRepo(source: string) {
    if (installing) return
    if (source === installSource && installCandidates.status === 'ready') return
    void loadCandidates(source)
  }

  /** 关闭「安装 skills」对话框；安装中不响应关闭，避免请求回来时状态错位。 */
  function closeInstallDialog() {
    if (installing) return
    // 关掉时让在途的候选请求作废，别把结果写进下一次打开的弹窗。
    candidatesSequence += 1
    setInstallOpen(false)
    setInstallError(null)
  }

  /**
   * 读一个来源里的 skills 清单并默认勾选全部未安装的。
   *
   */
  async function loadCandidates(sourceOverride?: string) {
    if (installing || selectedWorker === null) return
    const sequence = ++candidatesSequence
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
    // 换仓库时先清空勾选：旧仓库的 skill 名不能套用到新仓库上。
    setInstallSelected([])
    setInstallError(null)
    try {
      const body = await requestJson(AVAILABLE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: selectedWorker.id, source: value }),
      })
      if (sequence !== candidatesSequence) return
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
      // 列表里的 skills 可能还没重新扫描过：把执行者现有的也并进来，保证已安装项一定禁用。
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
      if (sequence !== candidatesSequence) return
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
   * 安装勾选的 skills：Host 在执行者目录里跑
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
          id: selectedWorker.id,
          source: installSource.trim(),
          skills: installSelected,
        }),
      })
      patchWorker(selectedWorker.id, {
        skills: Array.isArray(body.skills) ? body.skills : [],
        claude:
          body.claude !== null && typeof body.claude === 'object'
            ? (body.claude as WorkerClaude)
            : claudeOf(selectedWorker),
      })
      setInstallOpen(false)
      flash('success', `${t('skillInstalled')} ${installSource.trim()}`)
      void checkWorkerSkills(selectedWorker)
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
   * 自动检查一个执行者的项目级 skills：进入「技能」页签、安装 / 移除 / 更新
   * 之后调用。只读，不写 lockfile；结果按 skill 名交给行内状态标记。
   *
   * 响应回来时只接受当前执行者的结果：切走再切回时旧请求不能覆盖新状态。
   */
  async function checkWorkerSkills(worker: Worker) {
    setSkillChecks((prev) => ({ ...prev, workerId: worker.id, status: 'loading', error: null }))
    try {
      const body = await requestJson<WorkerSkillCheckSnapshot>(SKILL_CHECK_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: worker.id }),
      })
      const results: Record<string, SkillCheckItem> = {}
      for (const entry of Array.isArray(body?.check?.results) ? body.check.results : []) {
        const name = typeof entry?.name === 'string' ? entry.name : ''
        const status = typeof entry?.status === 'string' ? entry.status : ''
        if (name === '' || status === '') continue
        results[name] = {
          name,
          status,
          ...(typeof entry?.message === 'string' && entry.message !== ''
            ? { message: entry.message }
            : {}),
        }
      }
      setSkillChecks((prev) =>
        prev.workerId === worker.id
          ? { workerId: worker.id, status: 'ready', results, error: null }
          : prev,
      )
    } catch (failure) {
      setSkillChecks((prev) =>
        prev.workerId === worker.id
          ? { ...prev, status: 'error', error: messageOf(failure) }
          : prev,
      )
    }
  }

  /**
   * 行内更新一个 skill：Host 把 `skills` 收窄到这一项，`modified` 会被跳过。
   * 逐项失败时路由回 200 但 `ok:false`，页面展示原因与输出；不论成功失败都
   * 重新检查一次，让行内状态回到磁盘上的真实版本。
   */
  async function updateSkill(worker: Worker, skill: { name: string }) {
    if (updatingSkill !== null || updatingAllSkills) return
    setUpdatingSkill(skill.name)
    setSkillError(null)
    try {
      const body = await requestUpdateJson<WorkerSkillUpdateSnapshot>(SKILL_UPDATE_ROUTE, {
        method: 'POST',
        body: JSON.stringify({ id: worker.id, skills: [skill.name] }),
      })
      if (Array.isArray(body.skills)) patchWorker(worker.id, { skills: body.skills })
      const summary = body.update
      const failed = Array.isArray(summary?.failed) ? summary.failed : []
      const first = failed[0]
      if (body.ok === false || failed.length > 0) {
        const message =
          typeof first?.message === 'string' && first.message !== ''
            ? first.message
            : typeof summary?.message === 'string' && summary.message !== ''
              ? summary.message
              : t('errUpdateFailed')
        setSkillError({
          message,
          output: typeof first?.output === 'string' ? first.output : '',
        })
        flash('error', message)
      } else {
        // 没有实际更新（例如这一项只剩 `modified` 被跳过）时不谎报成功，
        // 用 Host 的说明代替。
        const updated = Array.isArray(summary?.updated) ? summary.updated.length : 0
        const note = typeof summary?.message === 'string' ? summary.message : ''
        flash('success', updated === 0 && note !== '' ? note : `${t('skillUpdated')} ${skill.name}`)
      }
      await checkWorkerSkills(worker)
    } catch (failure) {
      setSkillError({ message: failureText(t, failure), output: outputOf(failure) })
    } finally {
      setUpdatingSkill(null)
    }
  }

  /**
   * 列表页「更新全部执行者」：Host 只对智能体、目录存在且有 skill 的 worker
   * 顺序执行，单个失败不中断；页面用汇总提示结果并刷新列表。
   */
  async function updateAllWorkers() {
    if (updatingSkill !== null || updatingAllSkills) return
    setUpdatingAllSkills(true)
    try {
      const body = await requestJson<WorkerSkillUpdateAllSnapshot>(SKILL_UPDATE_ALL_ROUTE, {
        method: 'POST',
      })
      const results = Array.isArray(body.results) ? body.results : []
      const failed = Number(body.failed ?? results.filter((one) => one.ok === false).length)
      const updated = Number(body.updated ?? 0)
      const skipped = Number(body.skippedWorkers ?? 0)
      const summary = t('updateAllSummary')
        .replace('{n}', String(updated))
        .replace('{f}', String(failed))
        .replace('{s}', String(skipped))
      flash(failed > 0 ? 'error' : 'success', summary)
      reload()
    } catch (failure) {
      flash('error', `${t('errUpdateFailed')} ${failureText(t, failure)}`)
    } finally {
      setUpdatingAllSkills(false)
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
        body: JSON.stringify({ id: worker.id, skill: skill.name }),
      })
      patchWorker(worker.id, { skills: Array.isArray(body.skills) ? body.skills : [] })
      setConfirmingSkill(null)
      flash('success', `${t('skillRemoved')} ${skill.name}`)
      void checkWorkerSkills(worker)
    } catch (failure) {
      setSkillError({ message: failureText(t, failure), output: outputOf(failure) })
    } finally {
      setRemoving(null)
    }
  }

  return {
    openInstallDialog,
    selectInstallRepo,
    closeInstallDialog,
    loadCandidates,
    toggleCandidate,
    selectAllCandidates,
    installSelectedSkills,
    removeSkill,
    checkWorkerSkills,
    updateSkill,
    updateAllWorkers,
  }
}
