/**
 * 新建会话输入框左下角的 warn 色提示。
 *
 * 只在有更新时出现：`{count} 个技能可更新`，tooltip 列出前几个 skill 与
 * 「点击重新检查」。检查失败时缩成一个 `!`，tooltip 给出原因；没有项目技能、
 * 全部最新或正在首次检查时都不占位置。
 *
 * 组件挂载（以及切换会话）时检查一次；点击提示会强制刷新 Host 缓存。
 * 检查全在 Host 完成，这里不碰文件系统，也不跑命令。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/badge
 */

import { h, messageOf } from '@buka/plugin-ui'
import { IconWarningOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { SkillUpdatesSnapshot } from '../types.ts'
import { readSkillUpdates } from './api.ts'
import type { SkillUpdatesKey } from './dictionary.ts'

/** 提示的插槽 props：会话 id 来自框架，`t` 来自注册时的 `locale`。 */
export interface SkillUpdatesBadgeProps {
  /** 当前会话；空会话也有 id。 */
  readonly sessionId?: string | undefined
  /** 当前界面语言的翻译函数。 */
  readonly t: (key: SkillUpdatesKey) => string
}

/** 把请求错误和它附带的 CLI 输出尾部合成一行可展示文本。 */
function failureText(error: unknown): string {
  const message = messageOf(error)
  const output = (error as { readonly output?: unknown } | null | undefined)?.output
  if (typeof output !== 'string') return message
  const line = output.trim().split(/\r?\n/u).at(-1)?.trim() ?? ''
  return line === '' ? message : `${message} ${line}`
}

/**
 * 渲染更新提示；没有更新时不渲染。
 *
 * @param props 会话 id 与翻译函数
 * @returns 提示按钮，或 null
 */
export function SkillUpdatesBadge({ sessionId, t }: SkillUpdatesBadgeProps): ReactElement | null {
  const [snapshot, setSnapshot] = useState<SkillUpdatesSnapshot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 会话切换或连续点击时，只接受最后一次请求的结果。
  const generation = useRef(0)

  // 位置随会话切换时重新检查；组件卸载后忽略迟到的响应。
  useEffect(() => {
    if (sessionId === undefined) {
      generation.current += 1
      setSnapshot(null)
      setFailure(null)
      setBusy(false)
      return undefined
    }
    const current = ++generation.current
    setSnapshot(null)
    setFailure(null)
    setBusy(true)
    void readSkillUpdates(sessionId)
      .then((next) => {
        if (generation.current === current) setSnapshot(next)
      })
      .catch((error: unknown) => {
        if (generation.current === current) setFailure(failureText(error))
      })
      .finally(() => {
        if (generation.current === current) setBusy(false)
      })
    return () => {
      if (generation.current === current) generation.current += 1
    }
  }, [sessionId])

  if (sessionId === undefined) return null

  /** 点击提示：绕过 Host 缓存重新检查。 */
  const recheck = (): void => {
    if (busy) return
    const current = ++generation.current
    setBusy(true)
    void readSkillUpdates(sessionId, true)
      .then((next) => {
        if (generation.current !== current) return
        setSnapshot(next)
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (generation.current === current) setFailure(failureText(error))
      })
      .finally(() => {
        if (generation.current === current) setBusy(false)
      })
  }

  if (failure !== null) {
    return h(
      Tooltip,
      {
        label: `${t('error')} ${failure}`,
        side: 'top',
        align: 'start',
        delayMs: 300,
        portal: true,
        maxWidth: 320,
      },
      h(
        'button',
        {
          type: 'button',
          className: 'buka-skill-update-check-badge',
          'data-state': 'error',
          'data-busy': busy ? '' : undefined,
          'aria-label': t('errorShort'),
          'aria-busy': busy,
          onClick: recheck,
        },
        h(IconWarningOutlineRegular, { size: 13 }),
        h('span', { className: 'buka-skill-update-check-errorMark' }, '!'),
      ),
    )
  }

  if (snapshot === null || snapshot.status !== 'updates' || snapshot.updates.length === 0) {
    return null
  }

  const count = snapshot.updates.length
  const label = `${count} ${count === 1 ? t('badgeOne') : t('badgeMany')}`
  const shown = snapshot.updates.slice(0, 5)
  const extra = count - shown.length
  const names = `${shown.join(t('separator'))}${extra > 0 ? '…' : ''}`
  const hint = `${t('hint')} ${names} · ${t('hintRecheck')}`

  return h(
    Tooltip,
    {
      label: hint,
      side: 'top',
      align: 'start',
      delayMs: 300,
      portal: true,
      maxWidth: 360,
    },
    h(
      'button',
      {
        type: 'button',
        className: 'buka-skill-update-check-badge',
        'data-state': 'updates',
        'data-busy': busy ? '' : undefined,
        'aria-label': `${label}. ${hint}`,
        'aria-busy': busy,
        onClick: recheck,
      },
      h(IconWarningOutlineRegular, { size: 13 }),
      h('span', { className: 'buka-skill-update-check-text' }, label),
    ),
  )
}
