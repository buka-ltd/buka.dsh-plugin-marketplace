/**
 * 机器人目录里的说明文件：AGENTS.md 的读写、模板，以及 CLAUDE.md 链接。
 *
 * 机器人目录固定放一份 `AGENTS.md`；Claude Code 的 `CLAUDE.md` 默认做成指向
 * 它的符号链接（平台不支持时写 `@AGENTS.md`）。新建机器人时顺带补目录与模板。
 *
 * @module @buka/dsh-plugin-robots/store/agents
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AGENTS_FILE, AGENTS_MAX_READ_BYTES, CLAUDE_FILE, pathExists, realpathOr } from './paths.ts'

/**
 * 确保机器人目录存在，并补一份 AGENTS.md 模板（不覆盖已有的）。
 *
 * 模板里的路径用目录的规范绝对路径（`fs.realpath`，失败回退解析值），与
 * 登记进 `robots.json` 的路径、DSH 工作区记录里的路径保持一致。
 *
 */
export async function ensureRobotDirectory(directory: string, name: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const stat = await fs.stat(directory)
  if (!stat.isDirectory()) {
    const error = new Error(`目标路径已存在且不是目录：${directory}`)
    throw Object.assign(error, { code: 'not-directory' })
  }
  const canonical = await realpathOr(directory, directory)
  const agentsFile = path.join(canonical, AGENTS_FILE)
  if (!(await pathExists(agentsFile))) {
    await fs.writeFile(agentsFile, robotAgentsTemplate(name, canonical), 'utf8')
  }
  // Claude Code 读 CLAUDE.md：机器人目录里让它指向同一份 AGENTS.md。已存在的
  // 用户文件 / 别的链接不覆盖（首次创建以外的调用都是幂等的）。
  await ensureClaudeLink(canonical)
  return canonical
}

/**
 * 机器人目录里 CLAUDE.md 的状态。
 *
 * `mode`：`symlink`（指向同目录 AGENTS.md 的符号链接）、`import`（平台不支持
 * 建链接时写下的 `@AGENTS.md`）、`file`（用户自己的普通文件）、`foreign-link`
 * （指向别处的符号链接）、`missing`（不存在）。
 *
 */
export async function readClaudeLink(directory: unknown): Promise<{
  exists: boolean
  symlink: boolean
  mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing'
  target: string
}> {
  if (typeof directory !== 'string' || directory.trim() === '') {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }
  const base = path.resolve(directory)
  const file = path.join(base, CLAUDE_FILE)
  let stat: import('node:fs').Stats
  try {
    stat = await fs.lstat(file)
  } catch {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }

  if (stat.isSymbolicLink()) {
    let target = ''
    try {
      target = await fs.readlink(file)
    } catch {
      target = ''
    }
    const linked = target !== '' && path.resolve(base, target) === path.join(base, AGENTS_FILE)
    return { exists: true, symlink: linked, mode: linked ? 'symlink' : 'foreign-link', target }
  }

  // 不是符号链接：可能是 Windows 等平台的降级写法，也可能是用户自己的文件。
  try {
    if (stat.size <= 256) {
      const text = await fs.readFile(file, 'utf8')
      if (text.trim() === `@${AGENTS_FILE}`) {
        return { exists: true, symlink: false, mode: 'import', target: AGENTS_FILE }
      }
    }
  } catch {
    // 读不了就只当普通文件，不影响其它操作。
  }
  return { exists: true, symlink: false, mode: 'file', target: '' }
}

/**
 * 确保 `<机器人目录>/CLAUDE.md` 指向 `AGENTS.md`。
 *
 * - 已经是指向 AGENTS.md 的符号链接：原样返回，不重建；
 * - 已存在其它文件 / 链接：**不覆盖**，原样返回状态，交给页面提示；
 * - 不存在：优先建相对符号链接；平台不允许（如 Windows 未开开发者模式）时
 *   退回一份只有 `@AGENTS.md` 的说明文件，Claude Code 仍会导入同一份内容。
 *
 */
export async function ensureClaudeLink(directory: unknown): Promise<{
  exists: boolean
  symlink: boolean
  mode: 'symlink' | 'import' | 'file' | 'foreign-link' | 'missing'
  target: string
}> {
  if (typeof directory !== 'string' || directory.trim() === '') {
    return { exists: false, symlink: false, mode: 'missing', target: '' }
  }
  const base = path.resolve(directory)
  const current = await readClaudeLink(base)
  if (current.exists) return current

  const file = path.join(base, CLAUDE_FILE)
  try {
    // 相对目标：机器人目录整体被移动或挂载到别的绝对路径时链接仍然有效。
    await fs.symlink(AGENTS_FILE, file, 'file')
    return { exists: true, symlink: true, mode: 'symlink', target: AGENTS_FILE }
  } catch {
    try {
      await fs.writeFile(file, `@${AGENTS_FILE}\n`, 'utf8')
      return { exists: true, symlink: false, mode: 'import', target: AGENTS_FILE }
    } catch {
      return { exists: false, symlink: false, mode: 'missing', target: '' }
    }
  }
}

/**
 * 空的 AGENTS.md 摘要；文件不存在或读不了时用它，保证响应结构稳定。
 *
 */
export function emptyAgentsFile(): {
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
} {
  return { exists: false, bytes: 0, modifiedAt: null, content: '', tooLarge: false }
}

/**
 * 读 `<path>/AGENTS.md`。
 *
 * 文件存在且不超过 256 KiB 时返回全文；超过上限时只返回大小与
 * `tooLarge: true`，`content` 为空串（页面不会把大文件塞进 textarea）。
 *
 */
export async function readAgentsFile(workspacePath: unknown): Promise<{
  exists: boolean
  bytes: number
  modifiedAt: string | null
  content: string
  tooLarge: boolean
}> {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') return emptyAgentsFile()
  const file = path.join(workspacePath, AGENTS_FILE)

  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(file)
  } catch {
    return emptyAgentsFile()
  }
  if (!stat.isFile()) return emptyAgentsFile()

  const modifiedAt = new Date(stat.mtimeMs).toISOString()
  if (stat.size > AGENTS_MAX_READ_BYTES) {
    return { exists: true, bytes: stat.size, modifiedAt, content: '', tooLarge: true }
  }

  try {
    const content = await fs.readFile(file, 'utf8')
    return {
      exists: true,
      bytes: Buffer.byteLength(content, 'utf8'),
      modifiedAt,
      content,
      tooLarge: false,
    }
  } catch {
    // 读权限问题不影响其它机器人：只当这个文件没有可展示的内容。
    return { exists: true, bytes: stat.size, modifiedAt, content: '', tooLarge: false }
  }
}

/**
 * 直接写 `<path>/AGENTS.md`（UTF-8），返回写入的字节数与新的修改时间。
 * 上限检查由路由做（512 KiB）；目录不存在时这里会抛错，由路由转成 409/500。
 *
 */
export async function writeAgentsFile(
  workspacePath: string,
  content: unknown,
): Promise<{ bytes: number; modifiedAt: string }> {
  if (typeof workspacePath !== 'string' || workspacePath === '') {
    throw new Error('缺少工作区目录')
  }
  const text = typeof content === 'string' ? content : String(content ?? '')
  const file = path.join(workspacePath, AGENTS_FILE)
  await fs.writeFile(file, text, 'utf8')
  const stat = await fs.stat(file)
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
  }
}

/**
 * 新机器人的 AGENTS.md 模板；路径与名字都是磁盘上的真实值。
 *
 */
export function robotAgentsTemplate(name: string, robotPath: string): string {
  return `# AGENTS.md

这是「${name}」机器人的协作说明。这个目录同时是一个 DSH 工作区。

## 项目

- 路径：\`${robotPath}\`
- 用途：

## 约定

- 动手前先读仓库里已有的文档、脚本与测试。
- 提交信息用 Conventional Commits；一个 commit 只做一件事。
`
}
