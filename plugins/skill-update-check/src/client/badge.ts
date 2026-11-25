/**
 * 新建会话输入框下方统计行最右侧（「上下文已用」圆环之后）的 warn 色提示。
 *
 * 有更新时显示 `{count} 个技能可更新`。点击提示会打开「SKILL 更新」弹窗
 * （`dialog.ts`），里面列出过期的项目技能，每一行一个「更新」，页脚一个
 * 「全部更新」。tooltip 列出前几个 skill 名并提示点击。
 *
 * 更新在后台进行：弹窗发起后请求挂在 `update-store.ts` 上，用户随时可以关掉
 * 弹窗；这期间提示条改成「正在更新 N 个技能」，结束后短暂显示「已更新 N 个
 * 技能」，再把 Host 返回的新快照同步给计数。
 *
 * 弹窗直接复用这里拿到的快照，打开时不再重新检查，所以不会出现加载态。
 * 检查失败时提示缩成一个 `!`，tooltip 给出原因；点击同样打开弹窗并显示原因。
 * 没有项目技能、全部最新或正在首次检查时都不占位置。
 *
 * 组件挂载（以及切换会话）时检查一次；检查全在 Host 完成，这里不碰文件系统，
 * 也不跑命令。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/badge
 */

import { h } from '@buka/plugin-ui'
import {
  IconCheckOutlineRegular,
  IconWarningOutlineRegular,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'

import type { SkillUpdatesSnapshot } from '../types.ts'
import { failureText, readSkillUpdates } from './api.ts'
import { SkillUpdatesDialog } from './dialog.ts'
import type { SkillUpdatesKey } from './dictionary.ts'
import type { SkillUpdateJob } from './update-store.ts'
import { updateStore } from './update-store.ts'

/** 更新结束后提示条停留的时长。 */
const COMPLETED_MS = 4_000

/** 提示的插槽 props：会话 id 来自框架，`t` 来自注册时的 `locale`。 */
export interface SkillUpdatesBadgeProps {
  /** 当前会话；空会话也有 id。 */
  readonly sessionId?: string | undefined
  /** 当前界面语言的翻译函数。 */
  readonly t: (key: SkillUpdatesKey, params?: Record<string, unknown>) => string
}

/**
 * 渲染更新提示与它打开的弹窗；没有更新且弹窗未打开时不渲染。
 *
 * @param props 会话 id 与翻译函数
 * @returns 提示按钮（可能附带弹窗），或 null
 */
export function SkillUpdatesBadge({ sessionId, t }: SkillUpdatesBadgeProps): ReactElement | null {
  const [snapshot, setSnapshot] = useState<SkillUpdatesSnapshot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [job, setJob] = useState<SkillUpdateJob | null>(null)
  /** 后台更新刚结束时短暂显示的「已更新 N 个技能」。 */
  const [completed, setCompleted] = useState<{ readonly count: number } | null>(null)
  // 会话切换或弹窗连续操作时，只接受最后一次请求的结果。
  const generation = useRef(0)

  // 位置随会话切换时重新检查；组件卸载后忽略迟到的响应。
  useEffect(() => {
    if (sessionId === undefined) {
      generation.current += 1
      setSnapshot(null)
      setFailure(null)
      setOpen(false)
      return undefined
    }
    const current = ++generation.current
    setSnapshot(null)
    setFailure(null)
    void readSkillUpdates(sessionId)
      .then((next) => {
        if (generation.current === current) setSnapshot(next)
      })
      .catch((error: unknown) => {
        if (generation.current === current) setFailure(failureText(error))
      })
    return () => {
      if (generation.current === current) generation.current += 1
    }
  }, [sessionId])

  // 后台更新：更新进行中、结束都只改提示条，不依赖弹窗是否打开。
  useEffect(() => {
    if (sessionId === undefined) {
      setJob(null)
      return undefined
    }
    setJob(updateStore.jobOf(sessionId) ?? null)
    return updateStore.subscribe((next) => {
      if (next.sessionId !== sessionId) return
      setJob(next)
      if (next.status === 'done' && next.snapshot !== null) {
        generation.current += 1
        setSnapshot(next.snapshot)
        setFailure(next.failure)
      }
    })
  }, [sessionId])

  // 整批更新成功时让提示条短暂显示结果；部分失败时不显示，交给弹窗解释。
  useEffect(() => {
    if (job === null || job.status !== 'done' || job.finishedAt === null) return undefined
    if (job.updated.length === 0 || job.failed.length > 0) return undefined
    const remaining = job.finishedAt + COMPLETED_MS - Date.now()
    if (remaining <= 0) return undefined
    setCompleted({ count: job.updated.length })
    const timer = setTimeout(() => setCompleted(null), remaining)
    return () => clearTimeout(timer)
  }, [job])

  if (sessionId === undefined) return null

  /**
   * 弹窗检查的结果同步回提示：计数、`!` 状态与弹窗保持一致。
   *
   * @param next 新快照；检查失败时为 null
   * @param nextFailure 检查失败的原因
   */
  const sync = (next: SkillUpdatesSnapshot | null, nextFailure: string | null): void => {
    generation.current += 1
    setSnapshot(next)
    setFailure(nextFailure)
  }

  const dialog = h(SkillUpdatesDialog, {
    open,
    sessionId,
    t,
    snapshot,
    failure,
    onClose: () => setOpen(false),
    onSnapshot: sync,
  })

  /** 提示按钮的外壳：相同的样式、可访问性与点击行为。 */
  const badgeButton = (state: string, label: string, content: ReactElement): ReactElement =>
    h(
      Tooltip,
      {
        label,
        side: 'top',
        align: 'end',
        delayMs: 300,
        portal: true,
        maxWidth: 360,
      },
      h(
        'button',
        {
          type: 'button',
          className: 'skill-update-check-badge',
          'data-state': state,
          'aria-label': label,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          onClick: () => setOpen(true),
        },
        content,
      ),
    )

  if (job !== null && job.status === 'running') {
    const count = job.names.length
    const label =
      count === 1
        ? t('updatingBadgeOne')
        : count > 0
          ? t('updatingBadge', { count })
          : t('updating')
    const names = job.names.slice(0, 5).join(t('separator'))
    const hint = names === '' ? label : `${label} · ${names}`
    return h(
      Fragment,
      null,
      badgeButton(
        'updating',
        hint,
        h(
          Fragment,
          null,
          h(StateDot, { state: 'ongoing', size: 12 }),
          h('span', { className: 'skill-update-check-text' }, label),
        ),
      ),
      dialog,
    )
  }

  if (completed !== null && !open) {
    const label =
      completed.count === 1 ? t('updatedBadgeOne') : t('updatedBadge', { count: completed.count })
    return h(
      Fragment,
      null,
      badgeButton(
        'done',
        label,
        h(
          Fragment,
          null,
          h(IconCheckOutlineRegular, { size: 13 }),
          h('span', { className: 'skill-update-check-text' }, label),
        ),
      ),
      dialog,
    )
  }

  if (failure !== null) {
    return h(
      Fragment,
      null,
      badgeButton(
        'error',
        `${t('error')} ${failure} · ${t('hintOpen')}`,
        h(
          Fragment,
          null,
          h(IconWarningOutlineRegular, { size: 13 }),
          h('span', { className: 'skill-update-check-errorMark' }, '!'),
        ),
      ),
      dialog,
    )
  }

  if (snapshot === null || snapshot.status !== 'updates' || snapshot.updates.length === 0) {
    // 弹窗还开着（例如刚把全部技能更新完）时继续渲染它，让用户看到结果。
    return open ? dialog : null
  }

  const count = snapshot.updates.length
  const label = `${count} ${count === 1 ? t('badgeOne') : t('badgeMany')}`
  const shown = snapshot.updates.slice(0, 5)
  const extra = count - shown.length
  const names = `${shown.join(t('separator'))}${extra > 0 ? '…' : ''}`
  const hint = `${t('hint')} ${names} · ${t('hintOpen')}`

  return h(
    Fragment,
    null,
    badgeButton(
      'updates',
      hint,
      h(
        Fragment,
        null,
        h(IconWarningOutlineRegular, { size: 13 }),
        h('span', { className: 'skill-update-check-text' }, label),
      ),
    ),
    dialog,
  )
}
