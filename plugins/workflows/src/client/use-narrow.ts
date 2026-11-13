/**
 * 视口宽度：窄屏时看板退化成按状态分组的纵向列表。
 *
 * 只在页面组件顶层调用一次，通过 `AppContext.narrow` 传给渲染函数；渲染函数
 * 自己不能调用 hook（它们在条件分支里被调用）。
 */

import React from 'react'

/** 与 CSS 的 `@media (width<=767px)` 保持一致。 */
const NARROW_QUERY = '(max-width: 767px)'

/**
 * 当前视口是否窄屏。
 *
 * @returns 窄屏时为 true
 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = React.useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    try {
      return window.matchMedia(NARROW_QUERY).matches
    } catch {
      return false
    }
  })
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    return undefined
  }, [])
  return narrow
}
