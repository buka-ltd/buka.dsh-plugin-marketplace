/**
 * 机器人（program）的内容契约。
 *
 * 契约属于程序本身，不写进工作流定义，也不进任务记录：
 *
 * - **保存工作流**：挂机器人的任务类型必须声明 `content` schema，并覆盖程序要求的
 *   必填字段（`programRequiredContent`）；
 * - **创建任务**：渲染后的任务内容按同一份 schema 校验，不合法直接拒绝；
 * - **执行前**：再校验一次，兜住旧作业与手改数据。
 *
 * @module @buka/dsh-plugin-workflows/program/contracts
 */

import type { JsonSchema } from '../json-schema.ts'
import { schemaProblems } from '../json-schema.ts'
import { CLOCK_PROGRAM_ID, programDriver } from './clock.ts'

/**
 * 归一 program id：登记表缺 `program` 时按内建 clock 处理（与引擎执行一致）。
 *
 * @param program 执行者登记表里的 program 字段
 * @returns program id
 */
export function normalizeProgramId(program: string | null | undefined): string {
  const id = typeof program === 'string' ? program.trim() : ''
  return id === '' ? CLOCK_PROGRAM_ID : id
}

/**
 * 判断一个程序是否由本插件注册。
 *
 * @param program program id
 * @returns 已注册时为 true
 */
export function isKnownProgram(program: string | null | undefined): boolean {
  return programDriver(normalizeProgramId(program)) !== undefined
}

/**
 * 一个程序接收的任务内容契约。
 *
 * @param program program id（可省略，按 clock 处理）
 * @returns 契约 schema；未知程序或驱动不声明契约时是 undefined
 */
export function programContentSchema(program: string | null | undefined): JsonSchema | undefined {
  return programDriver(normalizeProgramId(program))?.content
}

/**
 * 程序要求任务内容必须提供的顶层字段。
 *
 * 只读顶层 `required`；`oneOf` 联合类型的必填字段交给创建 / 执行前的完整校验，
 * 保存时不猜，避免把合法定义挡在外面。
 *
 * @param program program id
 * @returns 必填字段名；没有契约时是空数组
 */
export function programRequiredContent(program: string | null | undefined): string[] {
  const schema = programContentSchema(program)
  if (schema === undefined || Array.isArray(schema.oneOf)) return []
  return Array.isArray(schema.required) ? [...schema.required] : []
}

/**
 * 按程序的契约校验任务内容。
 *
 * @param program program id
 * @param content 渲染后的任务内容
 * @returns 可读问题；空数组表示通过
 */
export function programContentProblems(
  program: string | null | undefined,
  content: unknown,
): string[] {
  const schema = programContentSchema(program)
  if (schema === undefined) return []
  return schemaProblems(schema, content, 'content')
}
