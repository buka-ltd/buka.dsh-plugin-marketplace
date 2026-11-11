/**
 * 设置页的试听请求：把候选声音名发给 Host，只播放一次，不写配置。
 *
 * @module @buka/dsh-plugin-bell/client/preview
 */

import { requestJson } from '@buka/plugin-ui'

/** 与 Host 侧一致的试听路由：播放一次，不写配置。 */
const PREVIEW_ROUTE = '/buka-bell/preview'

/**
 * 请求 Host 播放一个候选声音。只负责试听，选中与否由列表页各自的写入
 * 决定，所以这里不发 `configForms` 请求。
 */
export async function previewSound(sound: string): Promise<void> {
  await requestJson(PREVIEW_ROUTE, {
    method: 'POST',
    body: JSON.stringify({ sound }),
    // 本地路由正常是毫秒级；卡住时也要让请求收尾，失败会提示在列表底部。
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5000) : null,
  })
}
