/**
 * 创建 React 元素的小包装。
 *
 * 页面直接手写 `createElement`（不用 JSX）。短名保持 `React.createElement` 的
 * 全部重载（这样内联回调仍能拿到事件类型），另外补一个宽松签名：机器人 / 技能
 * 页有些 props 是自带的宽对象或带 `data-*` 的元素属性，类型系统不必逐个展开。
 *
 * @module plugin-ui/h
 */

import type { ReactElement, ReactNode } from 'react'
import React from 'react'

/** 宽松签名：props 只要是一个对象。 */
type LooseElementFactory = (
  type: unknown,
  props?: object | null,
  ...children: unknown[]
) => ReactElement

const looseCreateElement: LooseElementFactory = (type, props, ...children) =>
  React.createElement(
    type as string,
    props as Record<string, unknown> | null | undefined,
    ...(children as ReactNode[]),
  )

/** `React.createElement` 的短名，附带一个宽松签名。 */
export const h = looseCreateElement as typeof React.createElement & LooseElementFactory
