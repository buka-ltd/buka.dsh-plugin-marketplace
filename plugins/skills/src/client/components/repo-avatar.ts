/**
 * 仓库头像：Host 图标缓存路由返回的 GitHub owner 头像，拿不到时回退到调用方
 * 给的内置图标。
 *
 * 加载顺序：Host 图标缓存路由 → 直连 GitHub → 内置图标。旧版 Host 还没注册
 * 图标路由时（或路由暂时不可用）自动退回直连，避免页面上的头像整体消失。
 *
 * Host 有磁盘缓存时直接返回；缓存过期也在后台静默更新，不阻塞列表渲染。
 * 头像只用于识别来源，不承载文案，所以 `alt` 留空并按装饰图处理；最终加载
 * 失败（离线、来源不是 GitHub、两次都拉不到）时不再重试，显示内置图标。失败
 * 记在具体的 URL 上，来源换了会重新尝试。
 *
 * @module @buka/dsh-plugin-skills/client/components/repo-avatar
 */

import type { ReactElement } from 'react'
import { useState } from 'react'

import { h } from '../primitives.ts'
import { repoDirectIconUrl, repoIconUrl } from '../repo-source.ts'

/** 仓库头像的入参。 */
export interface RepoAvatarProps {
  /** 来源：收藏的 `source`，或已安装 skill 的 npx 来源。 */
  readonly source: unknown
  /** 头像边长（px）。 */
  readonly size: number
  /** 没有头像或加载失败时显示的内置图标。 */
  readonly fallback: ReactElement
}

/**
 * GitHub 仓库头像；没有头像时显示回退图标。
 *
 * @param props 来源、尺寸与回退图标
 */
function RepoAvatar(props: RepoAvatarProps): ReactElement {
  const routeUrl = repoIconUrl(props.source)
  const directUrl = repoDirectIconUrl(props.source)
  // 按 URL 记失败：Host 路由失败后换直连；直连也失败才回退内置图标。
  // 来源变化会带来新的 URL，旧失败记录自然失效，重新尝试。
  const [failedRoute, setFailedRoute] = useState<string | null>(null)
  const [failedDirect, setFailedDirect] = useState<string | null>(null)
  const src = failedRoute === routeUrl && directUrl !== '' ? directUrl : routeUrl
  if (routeUrl === '' || failedDirect === src || (failedRoute === routeUrl && directUrl === '')) {
    return props.fallback
  }
  return h('img', {
    className: 'buka-skills-avatar',
    src,
    alt: '',
    'aria-hidden': true,
    width: props.size,
    height: props.size,
    loading: 'lazy',
    decoding: 'async',
    referrerPolicy: 'no-referrer',
    onError: () => {
      if (src === routeUrl) setFailedRoute(routeUrl)
      else setFailedDirect(src)
    },
  })
}

export { RepoAvatar }
