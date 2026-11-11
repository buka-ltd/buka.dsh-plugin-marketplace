/**
 * 提示音的播放：spawn 宿主系统的声音工具，失败只记一次警告。
 *
 * @module @buka/dsh-plugin-bell/player
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type { Command, Cue } from './sounds.ts'
import { commandFor } from './sounds.ts'

/** 播放器的可用性：任何一步失败都只记一次警告，绝不向生命周期抛错。 */
export type Player = (cue: Cue, sound: string) => void

/** 同类提示音的节流门：返回 true 表示这次可以响。 */
export function createGate(cooldownMs: number): () => boolean {
  let last = 0
  return () => {
    const now = Date.now()
    if (now - last < cooldownMs) return false
    last = now
    return true
  }
}

/**
 * 生成播放器。提示音失败不能影响任务本身，所以每一步失败都只记一次警告。
 */
export function createPlayer(ctx: Context): Player {
  const warned = new Set<Cue>()

  function warnUnavailable(cue: Cue): void {
    if (warned.has(cue)) return
    warned.add(cue)
    try {
      ctx.logger.warn(
        'buka-bell: no sound player is available for the %s cue; that moment will be silent',
        cue,
      )
    } catch {
      // logger 不可用时也不影响任务
    }
  }

  return (cue, sound) => {
    const candidates: readonly Command[] = commandFor(cue, sound)
    if (candidates.length === 0) return
    let index = 0

    const attempt = (): void => {
      const candidate = candidates[index]
      if (candidate === undefined) {
        warnUnavailable(cue)
        return
      }
      index += 1
      const [command, args] = candidate
      let child: ChildProcess
      try {
        child = spawn(command, [...args], { stdio: 'ignore', detached: true, windowsHide: true })
      } catch {
        attempt()
        return
      }
      child.once('error', attempt)
      child.unref()
    }

    attempt()
  }
}
