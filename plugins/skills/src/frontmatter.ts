/**
 * SKILL.md 的 YAML frontmatter 解析。
 *
 * 只实现本项目需要的子集：单行标量、引号标量、`|` 保留换行块与 `>` 折行块，
 * 以及 `metadata.internal` 的内部 skill 标记。frontmatter 缺失、没有对应字段、
 * 或内容不是合法 frontmatter 时，字段返回空串 / false；解析失败不影响 skill
 * 本身的列出，只影响展示用的元数据。
 *
 * 本模块只依赖字符串，不碰文件系统，便于单独测试。
 *
 * @module @buka/dsh-plugin-skills/frontmatter
 */

/** 一份 SKILL.md frontmatter 里本模块关心的字段。 */
export interface SkillFrontmatter {
  readonly name: string
  readonly description: string
}

/**
 * 从 SKILL.md 的 YAML frontmatter 里取 name 与 description。
 *
 * 只实现本项目需要的子集：单行标量、引号标量、`|` 保留换行块与 `>` 折行块。
 * frontmatter 缺失、没有对应字段、或内容不是合法 frontmatter 时，两个字段都
 * 返回空串；解析失败不影响 skill 本身的列出，只影响展示用的元数据。
 *
 * @param text SKILL.md 全文
 */
export function parseFrontmatter(text: unknown): SkillFrontmatter {
  const front = frontmatterLines(text)
  if (front === null) return { name: '', description: '' }
  return {
    name: parseFrontmatterField(front, 'name'),
    description: parseFrontmatterField(front, 'description'),
  }
}

/**
 * 取 frontmatter 内部的行（不含两侧 `---`）；不是合法 frontmatter 时返回 null。
 *
 * @param text SKILL.md 全文
 */
function frontmatterLines(text: unknown): string[] | null {
  if (typeof text !== 'string') return null
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') return null
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      end = index
      break
    }
  }
  if (end < 0) return null
  return lines.slice(1, end)
}

/**
 * `metadata.internal: true` 的 skill 是内部 skill：`npx skills` 默认不列出它、
 * 也不安装它（除非用户显式按名字请求）。这里跟随 CLI 的判定，只认 frontmatter
 * 里 `metadata` 映射下的布尔 true（带引号的 `"true"` 是字符串，不算）。
 *
 * @param text SKILL.md 全文
 */
export function parseFrontmatterInternal(text: unknown): boolean {
  const front = frontmatterLines(text)
  if (front === null) return false
  for (let index = 0; index < front.length; index += 1) {
    const match = /^metadata\s*:\s*(.*)$/u.exec(front[index] ?? '')
    if (match === null) continue
    const inline = (match[1] ?? '').trim()
    // 行内 flow 映射：`metadata: { internal: true }`。
    if (inline.startsWith('{')) {
      return /(?:^|[,{])\s*internal\s*:\s*(?:true|True|TRUE)\s*(?:[,}]|$)/u.test(inline)
    }
    // 块映射：只看 metadata 的直接子键（同一缩进）。
    let childIndent = -1
    for (let next = index + 1; next < front.length; next += 1) {
      const row = front[next] ?? ''
      if (row.trim() === '') continue
      const indent = (/^\s*/u.exec(row)?.[0] ?? '').length
      if (indent === 0) break
      if (childIndent < 0) childIndent = indent
      if (indent !== childIndent) continue
      if (/^\s+internal\s*:\s*(?:true|True|TRUE)\s*(?:#.*)?$/u.test(row)) return true
    }
    return false
  }
  return false
}

/**
 * 取 frontmatter 里的一个顶层标量字段；缺失时返回空串。
 *
 * 字段值支持单行标量、引号标量与 YAML 的 `|` / `>` 块。只认同级缩进，
 * 因此缩进在别的键下面的同名键不会被误取。
 *
 * @param front frontmatter 内部的行（不含两侧 `---`）
 * @param key 字段名
 */
function parseFrontmatterField(front: string[], key: 'name' | 'description'): string {
  for (let index = 0; index < front.length; index += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(front[index] ?? '')
    if (match === null || (match[1] ?? '') !== key) continue
    const inline = (match[2] ?? '').trim()
    if (/^[|>][+-]?$/u.test(inline)) {
      const block: string[] = []
      for (let next = index + 1; next < front.length; next += 1) {
        const row = front[next] ?? ''
        if (row.trim() === '') {
          block.push('')
          continue
        }
        if (!/^\s+/u.test(row)) break
        block.push(row.replace(/^\s+/u, ''))
      }
      if (inline.startsWith('>')) {
        return block
          .map((row) => row.trim())
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim()
      }
      return block.join('\n').trim()
    }
    return stripQuotes(inline)
  }
  return ''
}

/**
 * 从 SKILL.md 的 YAML frontmatter 里取 description。
 *
 * 保留这个导出是为了让已有的调用方（页面上的描述回退）不必关心 name；
 * 实际解析交给 `parseFrontmatter()`，行为与之前一致。
 *
 * @param text SKILL.md 全文
 */
export function parseFrontmatterDescription(text: unknown): string {
  return parseFrontmatter(text).description
}

/**
 * 去掉 YAML 标量两侧的引号；普通标量原样返回。
 */
function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'")
  }
  return value
}
