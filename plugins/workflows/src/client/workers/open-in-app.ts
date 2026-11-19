/**
 * 「用应用打开」的展示辅助。
 *
 * 应用清单来自 DSH 内置 `@deepseek-ai/dsh-client-ui-open-in-app` 的
 * `GET /open-in-app/apps`，每项只是 catalog id（`finder` / `vscode` / …）。
 * 这里给常见目录 / 终端类的系统名称做本地化；编辑器、IDE 与 Git GUI 用产品名，
 * 不随界面语言变化。未知 id 原样显示，新版本 DSH 新增的应用也不会消失。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/open-in-app
 */

import type { Translate } from './types.ts'

/** 需要随界面语言本地化的系统应用（其余用产品名）。 */
const LOCALIZED: Record<string, string> = {
  finder: 'appFinder',
  explorer: 'appExplorer',
  filemanager: 'appFileManager',
  terminal: 'appTerminal',
  windowsterminal: 'appWindowsTerminal',
  gnometerminal: 'appGnomeTerminal',
  konsole: 'appKonsole',
}

/** 编辑器、IDE、Git GUI 与终端的产品名；与内置 open-in-app 的 catalog 对齐。 */
const PRODUCT_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  vscodeinsiders: 'VS Code Insiders',
  windsurf: 'Windsurf',
  zed: 'Zed',
  sublimetext: 'Sublime Text',
  xcode: 'Xcode',
  androidstudio: 'Android Studio',
  intellij: 'IntelliJ IDEA',
  pycharm: 'PyCharm',
  webstorm: 'WebStorm',
  phpstorm: 'PhpStorm',
  goland: 'GoLand',
  rider: 'Rider',
  rustrover: 'RustRover',
  fork: 'Fork',
  sourcetree: 'Sourcetree',
  github: 'GitHub Desktop',
  tower: 'Tower',
  gitkraken: 'GitKraken',
  smartgit: 'SmartGit',
  sublimemerge: 'Sublime Merge',
  ghostty: 'Ghostty',
  warp: 'Warp',
  iterm: 'iTerm2',
  kitty: 'kitty',
  gitbash: 'Git Bash',
}

/**
 * 一个应用 id 的展示名。
 *
 * @param id `GET /open-in-app/apps` 返回的应用 id
 * @param t 翻译函数
 */
export function openInAppLabel(id: string, t: Translate): string {
  const key = LOCALIZED[id]
  return key === undefined ? (PRODUCT_NAMES[id] ?? id) : t(key)
}
