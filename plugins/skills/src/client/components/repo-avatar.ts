/**
 * 仓库头像：GitHub owner 的头像图片，拿不到头像时回退到调用方给的内置图标。
 *
 * 头像只用于识别来源，不承载文案，所以 `alt` 留空并按装饰图处理；加载失败
 * （离线、被 CSP 拦下、来源不是 GitHub）时不再重试，直接显示内置图标。失败
 * 记在具体的 URL 上，来源换了会重新尝试。
 *
 * @module @buka/dsh-plugin-skills/client/components/repo-avatar
 */

import type { ReactElement } from 'react'
import { useState } from 'react'

import { h } from '../primitives.ts'
import { repoIconUrl } from '../repo-source.ts'

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
  const url = repoIconUrl(props.source)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (url === '' || failedUrl === url) return props.fallback
  return h('img', {
    className: 'buka-skills-avatar',
    src: url,
    alt: '',
    'aria-hidden': true,
    width: props.size,
    height: props.size,
    loading: 'lazy',
    decoding: 'async',
    referrerPolicy: 'no-referrer',
    onError: () => setFailedUrl(url),
  })
}

export { RepoAvatar }
