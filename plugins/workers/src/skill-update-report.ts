/**
 * 把 Skills 服务的更新结果翻译成路由响应。
 *
 * `updateSkills()` 有两种失败：整体失败（`ok:false`，带错误码与 message）与
 * 逐项失败（`ok:true`，`failed` 数组里是失败的 skill）。前者要让请求方看到
 * 错误状态，后者是请求成功、只是部分 skill 没更新成功，所以回 200，但用
 * `ok:false` 明确结果。
 *
 * @module @buka/dsh-plugin-workers/skill-update-report
 */

/** 整体失败时写回响应的错误信息。 */
export interface SkillUpdateFailureReport {
  readonly code?: string
  readonly message: string
  readonly output?: string
}

/** 一次更新结果的 HTTP 呈现。 */
export interface SkillUpdateReport {
  /** 整体失败时的 HTTP 状态码；可以逐项处理时是 200。 */
  readonly status: number
  /** 整体成功且没有 skill 失败才是 true。 */
  readonly ok: boolean
  /** 整体失败时要写回的错误；逐项失败或成功时为 null。 */
  readonly failure: SkillUpdateFailureReport | null
  /** 失败的 skill 数。 */
  readonly failed: number
}

/**
 * 更新服务的失败码 → HTTP 状态码，与 Skills 插件的 `updateStatusFor` 一致。
 *
 * @param code 服务返回的错误码
 */
export function skillUpdateErrorStatus(code: string | undefined): number {
  if (code === 'invalid-dir' || code === 'invalid-source') return 400
  if (code === 'lock-unreadable') return 409
  if (code === 'unsupported-home') return 500
  return 502
}

/** 读一个字符串字段；不是非空字符串时返回 undefined。 */
function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 读一次 `updateSkills()` 的结果。
 *
 * @param result Skills 服务返回的更新结果
 * @returns 状态码、整体是否成功与失败 skill 数
 */
export function reportSkillUpdate(result: unknown): SkillUpdateReport {
  const record: Record<string, unknown> =
    result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  if (record.ok === false) {
    const code = text(record, 'code')
    const message = text(record, 'message') ?? '更新 skill 失败。'
    const output = typeof record.output === 'string' ? record.output : undefined
    return {
      status: skillUpdateErrorStatus(code),
      ok: false,
      failure: {
        ...(code === undefined ? {} : { code }),
        message,
        ...(output === undefined ? {} : { output }),
      },
      failed: 0,
    }
  }
  const failed = Array.isArray(record.failed) ? record.failed.length : 0
  return { status: 200, ok: failed === 0, failure: null, failed }
}
