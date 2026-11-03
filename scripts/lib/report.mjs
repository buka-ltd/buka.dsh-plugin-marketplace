/** 问题列表的终端输出：错误在前，警告在后，都带插件目录。 */

const LEVEL_LABEL = { error: '错误', warning: '警告' }

export function formatProblems(problems) {
  const errors = problems.filter((problem) => problem.level === 'error')
  const warnings = problems.filter((problem) => problem.level === 'warning')
  return { errors: errors.length, warnings: warnings.length }
}

/**
 * 把问题打到 stderr，返回是否出现错误。
 * @param {Array<{ level: 'error' | 'warning', plugin?: string, message: string }>} problems
 */
export function reportProblems(problems) {
  const ordered = [...problems].sort((left, right) => (left.level === right.level ? 0 : left.level === 'error' ? -1 : 1))
  for (const problem of ordered) {
    const label = LEVEL_LABEL[problem.level] ?? problem.level
    const where = problem.plugin === undefined ? '' : ` [${problem.plugin}]`
    console.error(`  ${label}${where} ${problem.message}`)
  }
  const { errors, warnings } = formatProblems(problems)
  if (errors + warnings > 0) console.error(`  —— ${errors} 个错误，${warnings} 个警告`)
  return errors === 0
}
