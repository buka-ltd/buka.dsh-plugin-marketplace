/**
 * 页面级的后台更新实例：把 {@link SkillUpdateJobs} 状态机接到真实请求上。
 *
 * 弹窗与提示条都 import 这一个实例，所以弹窗关闭、重新打开甚至切换会话后，
 * 更新状态仍然只有一份。状态机本身在 `update-jobs.ts`，不依赖浏览器 API。
 *
 * @module @buka/dsh-plugin-skill-update-check/client/update-store
 */

import { failureText, updateSkillUpdates } from './api.ts'
import { SkillUpdateJobs } from './update-jobs.ts'

/** 页面级的唯一 store：弹窗与提示条共用。 */
export const updateStore = new SkillUpdateJobs({
  run: (sessionId, names) => updateSkillUpdates(sessionId, names),
  describe: failureText,
})

export type { SkillUpdateJob, SkillUpdateListener } from './update-jobs.ts'
