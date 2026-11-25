/**
 * Pen 官方 logo（笔尖 / nib）的描边版本。
 *
 * 形状照着 Pen（pen.dev）的笔尖 logo 描摹：宽顶、直边、底部收成尖，中间一个
 * 圆点和一条竖线。这里以前内联的是 `assets/pen-logo.png` 的 PNG data URL，
 * 12px 下会糊成一个灰点；改成矢量描边后，勾选框与标题标记都用 `currentColor`
 * 跟随主题，任意尺寸都清晰。
 *
 * 与 `plugins/pen/icon.svg`（市场图标）共用同一组路径；改形状时两处一起改。
 *
 * @module @buka/dsh-plugin-pen/client/logo
 */

import { h } from '@buka/plugin-ui'
import type { ReactElement } from 'react'

/** 原始画布：与 Pen 笔尖 logo 的宽高比一致（64×77）。 */
const VIEWBOX = '0 0 64 77'

/** 描边粗细（原始画布单位）；缩到 12–14px 时约为 1px。 */
const STROKE_WIDTH = 4.6

/** 外轮廓：宽顶、直边、底部收尖。 */
const OUTLINE = 'M9.5 4.5h45a3 3 0 0 1 3 3V37L32 73.5 6.5 37V7.5a3 3 0 0 1 3-3Z'

/** 笔尖的圆点与分缝。 */
const CIRCLE = { cx: 32, cy: 27.5, r: 8 } as const
const SEAM = 'M32 36v29'

/** 画布宽高比；用来按高度算宽度。 */
const ASPECT = 64 / 77

/** 描边笔尖图标的 props。 */
export interface PenLogoProps {
  /** 渲染高度（像素）；宽度按 logo 比例算。 */
  readonly height?: number
  /** 额外的 class；颜色由 `currentColor` 继承。 */
  readonly className?: string
}

/**
 * 渲染 Pen 笔尖描边图标。
 *
 * @param props 高度与 class
 * @returns 跟随文字颜色的 SVG
 */
export function PenLogo({ height = 14, className }: PenLogoProps): ReactElement {
  return h(
    'svg',
    {
      className,
      width: Math.round(height * ASPECT * 100) / 100,
      height,
      viewBox: VIEWBOX,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: STROKE_WIDTH,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: OUTLINE }),
    h('circle', CIRCLE),
    h('path', { d: SEAM }),
  )
}
