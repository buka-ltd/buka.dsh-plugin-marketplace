/**
 * SemVer 2.0.0 的最小实现：版本比较与范围语法校验。
 *
 * 只做本仓库需要的两件事：按优先级排序索引里的版本、确认 `engines.dsh`
 * 是一个合法范围。DSH 自己用 `semver` 包做真正的范围求值，这里不复刻那套
 * 语义，只保证「写错了能被 check 拦住」。
 */

const NUMERIC = '0|[1-9]\\d*'
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`
const EXACT = new RegExp(
  `^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})` +
    `(?:-(${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*))?` +
    '(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$',
  'u',
)
const PARTIAL =
  /^(?:v)?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)?)?$/u

/** 是否是精确的三段式版本号。 */
export function isExactVersion(text: unknown): boolean {
  return typeof text === 'string' && EXACT.test(text)
}

interface PartialVersion {
  readonly parts: string[]
  readonly wildcard: boolean
  readonly prerelease: string | undefined
}

/** 解析成 { parts, prerelease }，不合法时返回 null。 */
function parsePartial(text: string): PartialVersion | null {
  const match = PARTIAL.exec(text)
  if (match === null) return null
  const parts = [match[1], match[2], match[3]].filter((part): part is string => part !== undefined)
  const isWildcard = (part: string): boolean => part === 'x' || part === 'X' || part === '*'
  const wildcardAt = parts.findIndex(isWildcard)
  if (wildcardAt !== -1 && parts.slice(wildcardAt).some((part) => !isWildcard(part))) return null
  if (match[4] !== undefined && (wildcardAt !== -1 || parts.length !== 3)) return null
  return { parts, wildcard: wildcardAt !== -1, prerelease: match[4] }
}

/**
 * 按 SemVer 2.0.0 优先级比较两个精确版本，返回 -1 / 0 / 1。
 */
export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const a = EXACT.exec(left)
  const b = EXACT.exec(right)
  if (a === null || b === null) throw new TypeError(`不是精确版本号：${a === null ? left : right}`)
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(a[index]) - Number(b[index])
    if (delta !== 0) return delta < 0 ? -1 : 1
  }
  const aPre = a[4] === undefined ? [] : a[4].split('.')
  const bPre = b[4] === undefined ? [] : b[4].split('.')
  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return 1
  if (bPre.length === 0) return -1
  for (let index = 0; index < Math.max(aPre.length, bPre.length); index += 1) {
    if (index >= aPre.length) return -1
    if (index >= bPre.length) return 1
    const x = aPre[index] ?? ''
    const y = bPre[index] ?? ''
    const xNumeric = /^\d+$/u.test(x)
    const yNumeric = /^\d+$/u.test(y)
    if (xNumeric && yNumeric) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta < 0 ? -1 : 1
      continue
    }
    if (xNumeric) return -1
    if (yNumeric) return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function isValidComparator(token: string): boolean {
  if (token === '') return false
  const match = /^(<=|>=|<|>|=|~|\^)?(.*)$/u.exec(token)
  if (match === null) return false
  const operator = match[1] ?? ''
  const partial = parsePartial(match[2] ?? '')
  if (partial === null) return false
  const first = partial.parts[0]
  if (operator === '^' && (first === undefined || /^[xX*]$/u.test(first))) return false
  return true
}

/**
 * 校验一个 SemVer 范围（比较符、`||`、连字符区间、通配）。
 * 只判断语法，不做求值。
 */
export function isValidRange(range: unknown): boolean {
  if (typeof range !== 'string') return false
  const text = range.trim()
  if (text === '') return false
  return text.split('||').every((group) => {
    const set = group.trim()
    if (set === '') return false
    const hyphen = /^(\S+)\s+-\s+(\S+)$/u.exec(set)
    if (hyphen !== null) {
      return parsePartial(hyphen[1] ?? '') !== null && parsePartial(hyphen[2] ?? '') !== null
    }
    return set.split(/\s+/u).every(isValidComparator)
  })
}
