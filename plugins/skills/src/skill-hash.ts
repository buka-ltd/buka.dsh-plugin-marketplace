/**
 * 已安装 skill 的内容哈希：与 `skills` CLI 的 `computedHash` 规则一致。
 *
 * `skills-lock.json` 记录了安装完成时 skill 目录的 `computedHash`。比较它和
 * 磁盘上的当前内容，就能判断本地是否被改过（`modified`），从而在更新时跳过
 * 用户的手工修改。
 *
 * 规则（见 `skills` 包 README 的 “Lock File Content Hash”）：
 *
 * 1. 收集目录里的文件，排除 `metadata.json` 与 `.git` / `__pycache__` /
 *    `__py_packages__` 目录；符号链接按它指向的内容计算，坏链、循环链与指向
 *    目录外的链接排除；
 * 2. 相对路径用 `/` 分隔；
 * 3. 文本文件（不含 NUL 字节）把 CRLF 换成 LF，二进制文件保持原样；
 * 4. 按路径的 UTF-8 字节排序（不是 locale 排序）；
 * 5. 依次喂入 `path`、NUL、内容字节数（十进制 ASCII）、NUL、内容，算 SHA-256；
 * 6. 输出小写十六进制。
 *
 * @module @buka/dsh-plugin-skills/skill-hash
 */

import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 不参与哈希的目录名。 */
const SKIPPED_DIRS = new Set(['.git', '__pycache__', '__py_packages__'])

/** 不参与哈希的文件名。 */
const SKIPPED_FILES = new Set(['metadata.json'])

/** 一个参与哈希的文件：相对路径与内容。 */
interface HashFile {
  readonly relativePath: string
  readonly content: Buffer
}

/**
 * 计算一个 skill 目录的内容哈希。
 *
 * @param root skill 目录绝对路径
 */
export async function computeSkillFolderHash(root: string): Promise<string> {
  const realRoot = await fs.realpath(root)
  const files = await collectFiles(realRoot)
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)),
  )

  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update(Buffer.from([0]))
    hash.update(String(file.content.length))
    hash.update(Buffer.from([0]))
    hash.update(file.content)
  }
  return hash.digest('hex')
}

/**
 * 递归收集目录里的文件；符号链接按目标处理，坏链 / 越界链接跳过。
 *
 * @param root 已展开符号链接的 skill 根目录
 */
async function collectFiles(root: string): Promise<HashFile[]> {
  const files: HashFile[] = []
  const visited = new Set<string>()

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`

      if (entry.isSymbolicLink()) {
        let real: string
        try {
          real = await fs.realpath(full)
        } catch {
          continue
        }
        if (!isInside(root, real)) continue
        let stat: Awaited<ReturnType<typeof fs.stat>>
        try {
          stat = await fs.stat(real)
        } catch {
          continue
        }
        if (stat.isDirectory()) {
          if (visited.has(real)) continue
          visited.add(real)
          await walk(real, relativePath)
        } else if (stat.isFile()) {
          const content = await readHashable(real)
          if (content !== null) files.push({ relativePath, content })
        }
        continue
      }

      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue
        await walk(full, relativePath)
        continue
      }
      if (!entry.isFile() || SKIPPED_FILES.has(entry.name)) continue
      const content = await readHashable(full)
      if (content !== null) files.push({ relativePath, content })
    }
  }

  await walk(root, '')
  return files
}

/**
 * 读一个文件的哈希内容：文本文件统一换行，二进制保持原样。
 *
 * @param file 文件绝对路径
 */
async function readHashable(file: string): Promise<Buffer | null> {
  try {
    const raw = await fs.readFile(file)
    return raw.includes(0) ? raw : normalizeNewlines(raw)
  } catch {
    return null
  }
}

/**
 * 把 CRLF 换成 LF；直接按字节处理，避免重新解码破坏内容。
 *
 * @param raw 文件原始字节
 */
function normalizeNewlines(raw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(raw.length)
  let length = 0
  for (let index = 0; index < raw.length; index += 1) {
    const byte = raw[index] as number
    if (byte === 13 && raw[index + 1] === 10) continue
    out[length] = byte
    length += 1
  }
  return out.subarray(0, length)
}

/**
 * `target` 是否在 `root` 之内（含 root 自身）。
 */
function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
