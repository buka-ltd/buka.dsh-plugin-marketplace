/**
 * 打工人展示名的统一写法：两个插件都用「名称 · 标识符」消歧。
 *
 * 标识符是不可变引用键，名称是可选展示名；只读接口可能只给其中一个，也可能
 * 直接给算好的 `displayName`。这里按「名称 → displayName → 标识符」取展示名，
 * 标识符缺失时退回带过来的 `name`（v7 旧作业快照的形状）。
 *
 * @module @buka/plugin-ui/worker-label
 */

/** 打工人展示信息的最小形状；字段都按 unknown 收，缺失时各自回退。 */
export interface WorkerLabelLike {
  id?: unknown
  name?: unknown
  displayName?: unknown
}

/** 取一个字段的 trim 值；不是字符串或为空时给空串。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 打工人展示名：名称非空时用它，否则用算好的 `displayName`，再否则用标识符。
 *
 */
export function workerDisplayName(worker: WorkerLabelLike | null | undefined): string {
  const name = text(worker?.name)
  if (name !== '') return name
  const display = text(worker?.displayName)
  if (display !== '') return display
  return text(worker?.id)
}

/**
 * 「展示名 · 标识符」：列表、详情与对话框里用来消歧。展示名等于标识符
 * （没设置名称）时只显示标识符，避免出现 `writer · writer`。
 *
 */
export function workerIdentityLabel(worker: WorkerLabelLike | null | undefined): string {
  const id = text(worker?.id) || text(worker?.name)
  const display = workerDisplayName(worker)
  if (id === '') return display
  return display === '' || display === id ? id : `${display} · ${id}`
}
