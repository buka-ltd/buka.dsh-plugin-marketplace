/**
 * 从 DSH 的浏览器模块表取基座组件。
 *
 * 不能写成静态 import：`scripts/build-clients.ts` 只把 react 系列声明为 external，
 * 静态 import `@deepseek-ai/dsh-client-ui-primitives` 会被打包器拉进产物（它带 CSS
 * module，打包会直接失败）。用函数包一层 `require`，打包器无法静态解析，产物里
 * 保留运行时 `require` —— 与迁移前手写 `window.__ModuleLoader__` 外壳时的形状一致。
 *
 * 整个浏览器一半只在这里取一次基座模块：页面、面板与对话框都从这里拿组件。
 *
 * @module @buka/dsh-plugin-skills/client/primitives
 */

import { h } from '@buka/plugin-ui'

/**
 * 从 DSH 的浏览器模块表取基座组件。
 *
 * @param id 模块 id
 */
function loadPrimitives(id: string): unknown {
  return require(id)
}

const primitives = loadPrimitives(
  '@deepseek-ai/dsh-client-ui-primitives',
) as typeof import('@deepseek-ai/dsh-client-ui-primitives')

const {
  Button,
  Input,
  SegmentedTabs,
  Tag,
  Tooltip,
  Toast,
  StateDot,
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronRightOutlineRegular,
  IconDownloadOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSkillOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
} = primitives

export {
  Button,
  h,
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronRightOutlineRegular,
  IconDownloadOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSkillOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  Modal,
  SegmentedTabs,
  StateDot,
  Tag,
  Toast,
  Tooltip,
}
