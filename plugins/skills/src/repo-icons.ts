/**
 * 仓库头像缓存：把 GitHub owner 的头像落盘到 DSH home，页面通过包内路由读取。
 *
 * 头像只用来识别来源。以前页面直接把 `<img>` 指向 `github.com/<owner>.png`，
 * 每次打开页面都要重新走一次外网；这里改成 Host 先查本地缓存：
 *
 * - 有缓存：立刻返回旧图，不访问外网；
 * - 缓存超过 TTL：仍然立刻返回旧图，同时在后台静默拉一次新图写回；
 * - 没有缓存：同步拉一次，失败就让页面回退到内置图标。
 *
 * 缓存按 owner 去重（GitHub 仓库头像就是 owner 头像），一个 owner 一个文件。
 * 图标是可重建的易失数据：文件损坏、内容不是支持的图片格式时按未命中处理；
 * 写入是同目录临时文件 + rename，读到的永远是完整图片。
 *
 * @module @buka/dsh-plugin-skills/repo-icons
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Homes } from './skill-store.ts'

/** 页面读取仓库头像用的路由。 */
export const ICON_ROUTE = '/skills/icon'

/** 缓存有效期：30 分钟，与仓库树缓存一致；过期后先回旧图再后台更新。 */
export const ICON_TTL_MS = 30 * 60 * 1000

/** 拉头像的超时：头像很小，10 秒足够。 */
export const ICON_FETCH_TIMEOUT_MS = 10_000

/** 头像大小上限；GitHub 的 80px 头像远小于这个值。 */
const MAX_ICON_BYTES = 512 * 1024

/** 缓存目录与文件名（owner 小写后加固定后缀）。 */
const ICON_DIR = 'icons'
const ICON_SUFFIX = '.img'

/** 合法的 GitHub owner：首字符字母数字，其余只允许字母数字、点、下划线、连字符。 */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** 一张缓存的头像。 */
export interface IconImage {
  readonly data: Buffer
  readonly contentType: string
}

/** 缓存依赖；`fetch` 与 `now` 可注入，便于单测。 */
export interface IconCacheDeps {
  readonly homes: Pick<Homes, 'dshHome'>
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

/** 图标缓存实例。 */
export interface IconCache {
  /**
   * 取一张头像：有缓存先用缓存；缓存过期时后台刷新，不阻塞本次响应。
   *
   * @param owner GitHub owner；不合法时返回 null
   */
  load(owner: unknown): Promise<IconImage | null>
  /** 等所有后台刷新结束；测试用。 */
  whenIdle(): Promise<void>
}

/**
 * owner 是否安全：只允许 GitHub 用户名 / 组织名里的字符，避免拼出缓存路径之外
 * 的文件名。
 */
export function isSafeIconOwner(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && OWNER_PATTERN.test(value)
}

/** 头像缓存目录。 */
export function iconCacheDir(homes: Pick<Homes, 'dshHome'>): string {
  return path.join(homes.dshHome, 'buka-skills', 'cache', ICON_DIR)
}

/** 一个 owner 的缓存文件路径；owner 统一小写，大小写不同的写法共用同一份缓存。 */
export function iconCacheFile(homes: Pick<Homes, 'dshHome'>, owner: string): string {
  return path.join(iconCacheDir(homes), `${owner.toLowerCase()}${ICON_SUFFIX}`)
}

/** PNG 文件头。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 从图片头判断类型；只接受页面能安全显示的位图格式。
 *
 * @param data 图片字节
 */
function sniffContentType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (data.length >= 6 && data.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * 读缓存；文件缺失、损坏、不是支持的图片或超过大小上限都按未命中处理。
 *
 * @param file 缓存文件
 */
async function readCachedIcon(
  file: string,
): Promise<{ data: Buffer; contentType: string; mtimeMs: number } | null> {
  try {
    const stats = await fs.stat(file)
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_ICON_BYTES) return null
    const data = await fs.readFile(file)
    const contentType = sniffContentType(data)
    if (contentType === null) return null
    return { data, contentType, mtimeMs: stats.mtimeMs }
  } catch {
    return null
  }
}

/**
 * 原子写图标：同目录临时文件 → rename；失败时清理临时文件。
 *
 * @param file 目标文件
 * @param data 图片字节
 */
async function writeIconAtomic(file: string, data: Buffer): Promise<void> {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 })
    try {
      await fs.chmod(temporary, 0o600)
    } catch {
      // 平台不支持时忽略
    }
    await fs.rename(temporary, file)
  } catch (error) {
    try {
      await fs.rm(temporary, { force: true })
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error
  }
}

/**
 * 从 GitHub 拉一张 owner 头像。
 *
 * 只接受能嗅探出 PNG / JPEG / GIF / WebP 的响应；网络失败、非 2xx、超大响应
 * 都返回 null，由调用方回退到缓存或内置图标。
 *
 * @param owner GitHub owner（调用方已校验）
 * @param fetchImpl 可注入的 fetch
 */
export async function fetchGithubIcon(
  owner: string,
  fetchImpl: typeof fetch,
): Promise<IconImage | null> {
  let response: Response
  try {
    response = await fetchImpl(`https://github.com/${owner}.png?size=80`, {
      redirect: 'follow',
      headers: { accept: 'image/*', 'user-agent': 'buka-dsh-plugin-skills' },
      signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return null
  let data: Buffer
  try {
    data = Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
  if (data.length === 0 || data.length > MAX_ICON_BYTES) return null
  const contentType = sniffContentType(data)
  return contentType === null ? null : { data, contentType }
}

/**
 * 建一个图标缓存实例。
 *
 * @param deps DSH home 与可注入的 fetch / 时钟
 */
export function createIconCache(deps: IconCacheDeps): IconCache {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  // 同一个 owner 的并发请求共用一个后台刷新，避免同时拉好几次头像。
  const inFlight = new Map<string, Promise<IconImage | null>>()

  /**
   * 拉取并写回一张头像；同一 owner 的并发调用合并。
   *
   * @param owner 已校验的 owner
   */
  function refresh(owner: string): Promise<IconImage | null> {
    const key = owner.toLowerCase()
    const existing = inFlight.get(key)
    if (existing !== undefined) return existing
    const run = (async (): Promise<IconImage | null> => {
      const image = await fetchGithubIcon(owner, fetchImpl)
      if (image === null) return null
      try {
        await writeIconAtomic(iconCacheFile(deps.homes, owner), image.data)
      } catch {
        // 缓存写不进去不影响本次返回；下次再试。
      }
      return image
    })()
    inFlight.set(key, run)
    const clear = (): void => {
      if (inFlight.get(key) === run) inFlight.delete(key)
    }
    void run.then(clear, clear)
    return run
  }

  async function load(owner: unknown): Promise<IconImage | null> {
    if (!isSafeIconOwner(owner)) return null
    const file = iconCacheFile(deps.homes, owner)
    const cached = await readCachedIcon(file)
    if (cached === null) return refresh(owner)
    if (now() - cached.mtimeMs >= ICON_TTL_MS) {
      // 过期：先把旧图交给页面，更新在后台静默完成。
      void refresh(owner).catch(() => {})
    }
    return { data: cached.data, contentType: cached.contentType }
  }

  async function whenIdle(): Promise<void> {
    await Promise.allSettled([...inFlight.values()])
  }

  return { load, whenIdle }
}
