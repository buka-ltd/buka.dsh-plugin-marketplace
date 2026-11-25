/**
 * 点击输入框下方提示后弹出的「SKILL 更新」弹窗。
 *
 * 弹窗直接渲染提示已经拿到的检查快照：数据还新鲜（与 Host 一样按 5 分钟算）时
 * 立刻显示，不再发请求、不再进 loading。只有快照缺失或超过缓存时长时才在后台
 * 补一次检查，旧列表保持可见；补检查失败也不会清空已有结论。「重新检查」是唯一
 * 会强制跳过 Host 缓存的入口。
 *
 * 每一行是技能名加它在 `skills-lock.json` 里记录的来源仓库（没有来源时只显示
 * 名字），右侧一个「更新」；页脚一个「全部更新」。更新请求交给
 * `update-store.ts`：发起后弹窗可以随时关闭，更新在后台继续，提示条会显示
 * 「正在更新 N 个技能」；重新打开弹窗也能看到进行中的状态与结果。
 *
 * 单个 skill 失败不会中断整批：失败原因留在列表下方，成功的项从列表里消失。
 * 更新进行中禁用「更新 / 全部更新 / 重新检查」，但不拦关闭。没有可更新项时按
 * 检查结论区分「都已是最新」与「没有可检查的项目技能」，不会把「没检查成」说成
 * 「已是最新」。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/dialog
 */

import { h } from '@buka/plugin-ui'
import {
  Button,
  IconCheckOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'

import type { SkillUpdateFailureItem, SkillUpdatesSnapshot } from '../types.ts'
import { failureText, readSkillUpdates } from './api.ts'
import type { SkillUpdatesKey } from './dictionary.ts'
import type { SkillUpdateJob } from './update-store.ts'
import { updateStore } from './update-store.ts'

/** 弹窗里的翻译函数；`{count}` / `{names}` 这类占位符由词典服务替换。 */
export type Translate = (key: SkillUpdatesKey, params?: Record<string, unknown>) => string

/** 弹窗需要的 props。 */
export interface SkillUpdatesDialogProps {
  /** 弹窗是否打开；关闭时仍保留组件，只是 `Modal` 不渲染。 */
  readonly open: boolean
  /** 当前会话；没有会话时弹窗不发请求。 */
  readonly sessionId?: string | undefined
  /** 当前界面语言的翻译函数。 */
  readonly t: Translate
  /**
   * 提示最近一次拿到的检查快照。弹窗直接用它渲染，打开时不再重复检查；为
   * `null` 时才需要自己补一次。
   */
  readonly snapshot: SkillUpdatesSnapshot | null
  /** 提示最近一次检查失败的原因；没有快照时弹窗用它解释 `!`。 */
  readonly failure: string | null
  /** 关闭弹窗。 */
  readonly onClose: () => void
  /**
   * 检查拿到新结果时回调：`snapshot` 是成功时的快照，失败时是 `null` 加失败
   * 原因。提示用它更新计数与 `!` 状态，保证两处显示一致。更新结果由
   * `update-store.ts` 直接同步，不走这里。
   */
  readonly onSnapshot: (snapshot: SkillUpdatesSnapshot | null, failure: string | null) => void
}

/**
 * 快照仍然新鲜、不需要后台复查的时长。
 *
 * 与 Host 的 `CHECK_TTL_MS` 一致：超过它之后 Host 的缓存也过期，后台复查才会
 * 真正跑一次 CLI；在这之内打开弹窗只是渲染已有结果。
 */
const FRESH_MS = 5 * 60_000

/** 更新结束后弹窗仍然展示结果的时长。 */
const NOTICE_MS = 30_000

/** 弹窗自己那次检查的失败。 */
interface DialogFailure {
  readonly kind: 'check' | 'update'
  readonly text: string
}

/**
 * 渲染「SKILL 更新」弹窗。
 *
 * @param props 快照、失败原因、会话、翻译函数与关闭回调
 * @returns 弹窗；关闭时为 `null`
 */
export function SkillUpdatesDialog(props: SkillUpdatesDialogProps): ReactElement | null {
  const { open, sessionId, t, snapshot, failure: checkFailure, onClose, onSnapshot } = props

  const [checkError, setCheckError] = useState<DialogFailure | null>(null)
  const [checking, setChecking] = useState(false)
  const [job, setJob] = useState<SkillUpdateJob | null>(null)

  // 连续点击「重新检查」时，只接受最后一次请求的结果。
  const generation = useRef(0)
  // 回调每次渲染都是新函数；用 ref 读取，避免把 effect 挂在它上面。
  const onSnapshotRef = useRef(onSnapshot)
  onSnapshotRef.current = onSnapshot
  // 打开弹窗的 effect 只在打开 / 切换会话时跑，当前快照与失败原因用 ref 读。
  const latest = useRef({ snapshot, checkFailure })
  latest.current = { snapshot, checkFailure }

  // 后台更新由 store 持有，弹窗只订阅它的状态。
  useEffect(() => {
    if (sessionId === undefined) {
      setJob(null)
      return undefined
    }
    setJob(updateStore.jobOf(sessionId) ?? null)
    return updateStore.subscribe((next) => {
      if (next.sessionId === sessionId) setJob(next)
    })
  }, [sessionId])

  /**
   * 检查一次；`refresh` 为 true 时跳过 Host 缓存，只有「重新检查」这样做。
   *
   * 失败时保留已有列表，只把原因显示出来；还没有任何结论时才把失败同步给提示。
   *
   * @param refresh 是否强制跳过 Host 缓存
   */
  function load(refresh: boolean): void {
    if (sessionId === undefined) return
    const current = ++generation.current
    setChecking(true)
    setCheckError(null)
    void readSkillUpdates(sessionId, refresh)
      .then((next) => {
        if (generation.current !== current) return
        onSnapshotRef.current(next, null)
      })
      .catch((error: unknown) => {
        if (generation.current !== current) return
        const text = failureText(error)
        setCheckError({ kind: 'check', text })
        if (latest.current.snapshot === null) onSnapshotRef.current(null, text)
      })
      .finally(() => {
        if (generation.current === current) setChecking(false)
      })
  }

  // 打开（以及打开状态下切换会话）时决定要不要补检查：数据新鲜就直接显示。
  useEffect(() => {
    if (!open || sessionId === undefined) return undefined
    setCheckError(null)
    const { snapshot: current, checkFailure: failed } = latest.current
    // 数据还新鲜：直接渲染，不重复跑一次慢检查。
    if (current !== null && Date.now() - current.checkedAt < FRESH_MS) return undefined
    // 还没有快照但已经有失败原因：直接展示原因，也不重新检查。
    if (current === null && failed !== null) return undefined
    // 更新进行中：列表正由后台更新推进，不插一次检查。
    if (updateStore.jobOf(sessionId)?.status === 'running') return undefined
    load(false)
    return undefined
    // `load` 只依赖 sessionId；这里按打开状态与会话决定是否补检查。
  }, [open, sessionId])

  if (!open) return null

  const status = snapshot?.status
  const updates = status === 'updates' && snapshot !== null ? snapshot.updates : []
  const modified = snapshot?.modified ?? []
  const updating = job !== null && job.status === 'running' ? job : null
  const busy = checking || updating !== null
  const hasUpdates = updates.length > 0
  const failures: readonly SkillUpdateFailureItem[] =
    job !== null && job.status === 'done' ? job.failed : []

  // 用户操作产生的失败优先；其次整次更新失败；最后是提示带过来的检查失败。
  const shownFailure: DialogFailure | null =
    checkError ??
    (job !== null && job.status === 'failed' && job.failure !== null
      ? { kind: 'update', text: job.failure }
      : null) ??
    (checkFailure === null ? null : { kind: 'check', text: checkFailure })

  // 后台更新刚结束时展示结果；超过 NOTICE_MS 后不再重复。
  const notice: string | null =
    job !== null &&
    job.status === 'done' &&
    job.finishedAt !== null &&
    Date.now() - job.finishedAt < NOTICE_MS
      ? job.updated.length > 0
        ? t('updatedNames', { names: job.updated.join(t('separator')) })
        : job.failed.length === 0
          ? t('nothingUpdated')
          : null
      : null

  /** 发起更新；请求挂在 store 上，关掉弹窗也会继续。 */
  const update = (names: readonly string[]): void => {
    if (sessionId === undefined || busy || names.length === 0) return
    setCheckError(null)
    updateStore.start(sessionId, names)
  }

  const failureLine =
    shownFailure === null
      ? null
      : h(
          'p',
          { className: 'skill-update-check-failure', role: 'alert' },
          h(StateDot, { state: 'error', size: 13 }),
          `${t(shownFailure.kind === 'check' ? 'error' : 'updateFailed')} ${shownFailure.text}`,
        )

  const checkingLine = checking
    ? h(
        'p',
        { className: 'skill-update-check-status', role: 'status' },
        h(StateDot, { state: 'ongoing', size: 13 }),
        t('checking'),
      )
    : null

  const updatingLine =
    updating === null
      ? null
      : h(
          'p',
          { className: 'skill-update-check-status', role: 'status' },
          h(StateDot, { state: 'ongoing', size: 13 }),
          updating.names.length === 1
            ? `${t('updating')} ${updating.names[0]}`
            : t('updatingCount', { count: updating.names.length }),
        )

  // 更新在后台继续，所以明确告诉用户可以关掉弹窗，而不是把关闭按钮锁住。
  const updatingHint =
    updating === null ? null : h('p', { className: 'skill-update-check-hint' }, t('updatingHint'))

  const noticeLine =
    notice === null
      ? null
      : h(
          'p',
          { className: 'skill-update-check-notice', role: 'status' },
          h(StateDot, { state: 'done', size: 13 }),
          notice,
        )

  const failureLines = failures.map((item) =>
    h(
      'p',
      { key: `failed-${item.name}`, className: 'skill-update-check-failure', role: 'alert' },
      h(StateDot, { state: 'error', size: 13 }),
      `${item.name} · ${item.message}`,
    ),
  )

  const rows = updates.map((name) => {
    const source = snapshot?.sources?.[name]
    const rowUpdating =
      updating !== null && updating.names.length === 1 && updating.names[0] === name
    return h(
      'li',
      { key: name, className: 'skill-update-check-row' },
      h(
        'span',
        { className: 'skill-update-check-rowMain' },
        h('span', { className: 'skill-update-check-name', title: name }, name),
        source === undefined
          ? null
          : h('span', { className: 'skill-update-check-source', title: source }, source),
      ),
      rowUpdating
        ? h(
            'span',
            { className: 'skill-update-check-rowStatus' },
            h(StateDot, { state: 'ongoing', size: 13 }),
            t('updating'),
          )
        : h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              disabled: busy,
              'aria-label': `${t('update')} ${name}`,
              onClick: () => update([name]),
            },
            t('update'),
          ),
    )
  })

  const modifiedLine =
    modified.length === 0
      ? null
      : h(
          'p',
          { className: 'skill-update-check-modified' },
          h(StateDot, { state: 'warning', size: 13 }),
          `${t('modifiedTitle')} ${modified.join(t('separator'))}`,
        )

  // 没有可更新项时按检查结论分支：只有 up-to-date 才能说「都已是最新」。
  const emptyState =
    snapshot !== null && !checking && !hasUpdates
      ? status === 'up-to-date'
        ? h(
            'div',
            { className: 'skill-update-check-empty' },
            h(
              'span',
              { className: 'skill-update-check-emptyIcon', 'aria-hidden': true },
              h(IconCheckOutlineRegular, { size: 28 }),
            ),
            h('p', { className: 'skill-update-check-emptyTitle' }, t('upToDateTitle')),
            h('p', { className: 'skill-update-check-emptyHint' }, t('upToDateHint')),
          )
        : h(
            'div',
            { className: 'skill-update-check-empty' },
            h(
              'span',
              { className: 'skill-update-check-emptyIconNeutral', 'aria-hidden': true },
              h(IconWarningOutlineRegular, { size: 24 }),
            ),
            h('p', { className: 'skill-update-check-emptyTitle' }, t('nothingToCheckTitle')),
            h(
              'p',
              { className: 'skill-update-check-emptyHint' },
              snapshot.message ?? t('nothingToCheckHint'),
            ),
          )
      : null

  const body = h(
    'div',
    { className: 'skill-update-check-dialog' },
    failureLine,
    checkingLine,
    updatingLine,
    updatingHint,
    noticeLine,
    failureLines,
    modifiedLine,
    hasUpdates ? h('ul', { className: 'skill-update-check-list' }, ...rows) : emptyState,
  )

  return h(
    Modal,
    {
      open,
      onClose: onClose,
      title: t('dialogTitle'),
      closeLabel: t('close'),
      className: 'skill-update-check-modal',
      contentClassName: 'skill-update-check-modalContent',
      footer: h(
        Fragment,
        null,
        h(
          Button,
          {
            variant: 'ghost',
            icon: h(IconRefreshOutlineRegular, { size: 14 }),
            disabled: busy,
            onClick: () => load(true),
          },
          t('recheck'),
        ),
        h(Button, { variant: 'outline', onClick: onClose }, t('close')),
        h(
          Button,
          {
            variant: 'primary',
            disabled: busy || !hasUpdates,
            icon: updating === null ? undefined : h(StateDot, { state: 'ongoing', size: 13 }),
            onClick: () => update(updates),
          },
          updating === null ? t('updateAll') : t('updating'),
        ),
      ),
    },
    body,
  )
}
