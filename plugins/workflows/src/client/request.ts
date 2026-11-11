/**
 * Host 只读路由的请求：JSON 请求与附件地址。
 */

import { requestJson } from '@buka/plugin-ui'
import type { WorkflowRunRecord, WorkflowStep } from '../run-store.ts'

export { requestJson }

/**
 * 附件地址：只用运行 id、执行序号、节点 id 与清单里的文件名。`mode` 只在
 * preview / inline 时写入，省略就是下载（保持原有的下载链接行为）。
 *
 * @param token
 * @param [mode]
 * @returns
 */
export function attachmentUrl(
  token: { runId?: unknown; seq?: unknown; nodeId?: unknown; name?: unknown },
  mode?: 'preview' | 'inline',
): string {
  const params = new URLSearchParams({
    runId: typeof token?.runId === 'string' ? token.runId : '',
    seq: token?.seq === undefined || token?.seq === null ? '' : String(token.seq),
    nodeId: typeof token?.nodeId === 'string' ? token.nodeId : '',
    name: typeof token?.name === 'string' ? token.name : '',
  })
  if (mode === 'preview' || mode === 'inline') params.set('mode', mode)
  return `/buka-workflows/attachment?${params.toString()}`
}

/**
 * 附件清单里的那条附件 → 路由参数。下载链接、预览请求与抽屉状态共用它。
 *
 * @param run
 * @param step
 * @param attachment
 * @returns
 */
export function attachmentToken(
  run: WorkflowRunRecord | null,
  step: WorkflowStep | null | undefined,
  attachment: Record<string, unknown> | null | undefined,
): { runId: string; seq: unknown; nodeId: string; name: string } {
  return {
    runId: typeof run?.runId === 'string' ? run.runId : '',
    seq: step?.seq ?? '',
    nodeId: typeof step?.nodeId === 'string' ? step.nodeId : '',
    name: typeof attachment?.name === 'string' ? attachment.name : '',
  }
}
