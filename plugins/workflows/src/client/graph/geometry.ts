/**
 * 节点图的几何小工具：边名字的落点与 tooltip 定位。
 */

import type { EdgeTipState } from '../types.ts'

/**
 * 边名字的落点：钉在这条线箭头的位置上，不跟着鼠标走。箭头要么在竖段中点、
 * 要么在目标端口前，所以名字不会压在节点上；拿不到 SVG 几何时返回 `null`，
 * 退回鼠标位置。
 *
 * @param path 悬浮中的命中区 path
 * @param arrow 这条线的方向箭头
 * @returns
 */
export function edgeTipAnchor(path: unknown, arrow: unknown): { left: number; top: number } | null {
  if (path === null || typeof path !== 'object') return null
  const svg = (path as { ownerSVGElement?: unknown }).ownerSVGElement
  if (svg === null || svg === undefined || typeof svg !== 'object') return null
  const svgRecord = svg as { getBoundingClientRect?: unknown }
  if (typeof svgRecord.getBoundingClientRect !== 'function') return null
  if (arrow === null || typeof arrow !== 'object') return null
  const arrowRecord = arrow as { x?: unknown; y?: unknown }
  if (typeof arrowRecord.x !== 'number' || typeof arrowRecord.y !== 'number') return null
  const rect = (svgRecord.getBoundingClientRect as () => { left: number; top: number })()
  return { left: rect.left + arrowRecord.x + 8, top: rect.top + arrowRecord.y }
}

/**
 * 边名字 tooltip 的位置：优先用钉住的中段落点，否则跟随鼠标；两种情况都夹
 * 在视口内，靠近右 / 下边缘时不会被裁掉。测试环境没有 `window`，此时直接
 * 用原值。
 *
 * @param tip
 * @returns
 */
export function edgeTipPosition(tip: EdgeTipState): { left: string; top: string } {
  const anchor = tip.anchor ?? null
  const left = anchor === null ? tip.x + 12 : anchor.left
  const top = anchor === null ? tip.y + 14 : anchor.top
  const width =
    typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0
  const height =
    typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 0
  if (width <= 0 || height <= 0) return { left: `${left}px`, top: `${top}px` }
  // 钉住的落点是名字的中心高度，跟随鼠标的落点是名字的左上角。
  const minTop = anchor === null ? 8 : 24
  const maxTop = height - (anchor === null ? 40 : 24)
  return {
    left: `${Math.max(8, Math.min(left, width - 248))}px`,
    top: `${Math.max(minTop, Math.min(top, maxTop))}px`,
  }
}
