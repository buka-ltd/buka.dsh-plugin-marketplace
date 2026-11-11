/**
 * 扫描工作区里的项目级 skills。
 *
 * 三个根目录：`<path>/.agents/skills`、`<path>/.claude/skills`、
 * `<path>/.dsh/skills`（`<name>/SKILL.md` 或平铺的 `<name>.md`）；`source`
 * 从项目级 `skills-lock.json` 里补。单个条目读不了时跳过，整次扫描不抛错。
 *
 * @module @buka/dsh-plugin-robots/store/project-skills
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 项目级 skills 的三个根目录（相对工作区），按扫描优先级排列。
 * `.agents/skills` 是 `npx skills` 的默认落点，`.claude/skills` 是 Claude Code
 * 的约定；同一个 skill 同时落两处时按名字去重，只展示一条。
 */
const PROJECT_SKILL_ROOTS = [
  path.join('.agents', 'skills'),
  path.join('.claude', 'skills'),
  path.join('.dsh', 'skills'),
]

/** `npx skills add` 在项目里写下的 lockfile 名。 */
const PROJECT_LOCK_FILE = 'skills-lock.json'

// ---- 单机器人的 skills / AGENTS.md --------------------------------------

/**
 * 极简 YAML frontmatter 解析：只取顶层的 `name` 与 `description`。
 *
 * 支持单行标量与单/双引号标量；没有 frontmatter、frontmatter 未闭合或
 * 两个字段都不存在时返回空对象。解析失败不抛错——skill 仍然要被列出来，
 * 只是元数据回退到目录名与空描述。
 *
 */
export function parseFrontmatter(text: unknown): { name?: string; description?: string } {
  if (typeof text !== 'string') return {}
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') return {}
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      end = index
      break
    }
  }
  if (end < 0) return {}

  const result: { name?: string; description?: string } = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line)
    if (match === null) continue
    const key = match[1]
    if (key !== 'name' && key !== 'description') continue
    if (result[key] !== undefined) continue
    result[key] = stripQuotes(match[2]?.trim() ?? '')
  }
  return result
}

/**
 * 去掉 YAML 标量两侧的引号；普通标量原样返回。
 *
 */
function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'")
  }
  return value
}

/**
 * 扫描一个工作区的项目级 skills。
 *
 * 两个根目录里的条目都算：带 `SKILL.md` 的子目录，以及根下平铺的 `<name>.md`。
 * 名字优先取 frontmatter，缺省回退目录名/文件名；`source` 从
 * `<path>/skills-lock.json` 的 `skills.<name>` 里取 `source`（缺省回退
 * `sourceUrl`），取不到就是 null。单个条目读不了（坏链接、权限、ENOTDIR）
 * 时跳过，整次扫描不抛错。
 *
 */
export async function scanProjectSkills(
  workspacePath: unknown,
): Promise<{ skills: Array<{ name: string; description: string; source: string | null }> }> {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') return { skills: [] }
  const base = path.resolve(workspacePath)
  const lock = await readProjectLock(base)

  const byName = new Map<
    string,
    { name: string; description: string; source: string | null; kind: 'directory' | 'file' }
  >()

  for (const relativeRoot of PROJECT_SKILL_ROOTS) {
    const skillsDir = path.join(base, relativeRoot)
    for (const dirent of await readDirents(skillsDir)) {
      if (dirent.name.startsWith('.')) continue
      const full = path.join(skillsDir, dirent.name)

      let stat: import('node:fs').Stats
      try {
        // 跟随符号链接：npx 也可能用链接把 skill 接进项目。
        stat = await fs.stat(full)
      } catch {
        continue
      }

      let file: string
      let kind: 'directory' | 'file'
      let fallbackName: string
      if (stat.isDirectory()) {
        file = path.join(full, 'SKILL.md')
        kind = 'directory'
        fallbackName = dirent.name
      } else if (stat.isFile() && dirent.name.endsWith('.md')) {
        file = full
        kind = 'file'
        fallbackName = dirent.name.slice(0, -3)
      } else {
        continue
      }

      let text: string
      try {
        text = await fs.readFile(file, 'utf8')
      } catch {
        // 目录里没有 SKILL.md、文件读不了：这一个条目跳过。
        continue
      }

      const front = parseFrontmatter(text)
      const name = typeof front.name === 'string' && front.name !== '' ? front.name : fallbackName
      const description = typeof front.description === 'string' ? front.description : ''
      const entry = { name, description, source: lockSource(lock, name, fallbackName), kind }

      const existing = byName.get(name)
      // 同名时保留目录形式（与 DSH 的 skill 发现优先级一致）。
      if (existing === undefined || (existing.kind === 'file' && entry.kind === 'directory')) {
        byName.set(name, entry)
      }
    }
  }

  const skills = [...byName.values()]
    .map(({ name, description, source }) => ({ name, description, source }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return { skills }
}

/**
 * 读项目级 `skills-lock.json` 的 `skills` 表；文件缺失、非法 JSON 或结构
 * 不对时按空表处理（只是所有 skill 都显示为没有来源）。
 *
 */
async function readProjectLock(workspacePath: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await fs.readFile(path.join(workspacePath, PROJECT_LOCK_FILE), 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return {}
    const skills = parsed.skills
    if (skills === null || typeof skills !== 'object' || Array.isArray(skills)) return {}
    return skills
  } catch {
    return {}
  }
}

/**
 * 从 lockfile 的 `skills` 表里取一个条目的来源。
 *
 * 依次尝试 skill 的展示名与安装目录名（frontmatter 里的名字可能和目录不同），
 * 条目里优先 `source`、其次 `sourceUrl`；都没有就返回 null。
 *
 */
function lockSource(lock: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const record = lock[name]
    if (record === null || typeof record !== 'object') continue
    if ('source' in record && typeof record.source === 'string' && record.source.trim() !== '') {
      return record.source.trim()
    }
    if (
      'sourceUrl' in record &&
      typeof record.sourceUrl === 'string' &&
      record.sourceUrl.trim() !== ''
    ) {
      return record.sourceUrl.trim()
    }
  }
  return null
}

/**
 * 读目录项；目录不存在或不是目录时当作空目录。
 *
 */
async function readDirents(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
