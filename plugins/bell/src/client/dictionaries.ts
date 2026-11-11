/**
 * 设置页的文案词典：英文为键集合，简体中文按 `Record<keyof typeof en, string>`
 * 补齐，漏译由类型检查兜住。
 *
 * @module @buka/dsh-plugin-bell/client/dictionaries
 */

/** 词典命名空间。 */
export const NS = 'buka-bell'

/** 英文文案。 */
export const en = {
  nav: 'Notification sounds',
  title: 'Notification sounds',
  intro:
    'Choose which sound plays when a task finishes, when DSH waits for your input, when a plan is sent back for changes, or when you stop a task manually. Click a moment to open its sound list: clicking a sound selects it and plays it right away. “None” turns that moment off. Only the plan sound is off by default; the manual-stop sound uses the bundled clip.',
  pickHint:
    'Pick one: the sound is selected and played right away. Back returns to the four moments.',
  back: 'Back',
  previewFailed: 'Could not play the preview. Try again.',
  finish: 'Task finished',
  wait: 'Waiting for input',
  plan: 'Plan sent back for changes',
  abort: 'Task stopped manually',
  none: 'None',
  saveFailed: 'Could not save the sound. Try again.',
  loading: 'Loading sound settings…',
  unavailable: 'This plugin has no editable configuration in the current profile.',
}

/** 简体中文文案。 */
export const zh: Record<keyof typeof en, string> = {
  nav: '提示音',
  title: '提示音',
  intro:
    '选择任务结束、DSH 等待你输入、计划被退回修改、手动终止任务时播放的提示音。点一行进入该时机的播放列表：点一项即选中并试听，点「返回」回来。「无」表示这个时机不播放；计划被退回默认静音，手动终止默认播放插件自带的「你干嘛~哎哟」。',
  pickHint: '单选：选中哪个就试听哪个；点「返回」回到上一页。',
  back: '返回',
  previewFailed: '试听失败，请重试。',
  finish: '任务结束',
  wait: '等待输入',
  plan: '计划被退回修改',
  abort: '手动终止',
  none: '无',
  saveFailed: '保存失败，请重试。',
  loading: '正在读取提示音设置…',
  unavailable: '当前 profile 里这个插件没有可编辑的配置。',
}

/** 翻译函数：词典命名空间里取文案。 */
export type Translate = (key: string) => string
