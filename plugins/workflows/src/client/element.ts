/**
 * React 元素工厂与 UI 基座的小兼容层。
 *
 * 页面源码统一用 `React.createElement`，不写 JSX（浏览器一半由 tsdown 打包）。
 */

import { h } from '@buka/plugin-ui'
import {
  type IconCloseOutlineRegular,
  type MarkdownText,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'

/** React 元素工厂统一在界面侧公共包里；这里保留导出名供页面 import。 */
export { h }

/** 图标组件运行时把额外属性透传给 `<svg>`，官方 IconProps 没有声明这些属性。 */
export function withAria(
  props: Record<string, unknown>,
): React.ComponentProps<typeof IconCloseOutlineRegular> {
  return props as unknown as React.ComponentProps<typeof IconCloseOutlineRegular>
}

/** Modal 的 headless 模式不消费 closeLabel；运行时传了也会被忽略。 */
export const ClientModal = Modal as unknown as React.ComponentType<Record<string, unknown>>

/** Markdown 预览只要复制按钮的 labels；其余 labels 由组件内部兜底。 */
export type MarkdownLabelsProp = NonNullable<React.ComponentProps<typeof MarkdownText>['labels']>
