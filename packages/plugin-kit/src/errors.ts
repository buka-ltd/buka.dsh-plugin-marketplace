/**
 * 错误信息的公共读法。
 *
 * 这四个函数在迁移前的四个插件里被重复实现了十几次，内容逐字相同；
 * 唯一需要按插件区分的是「错误码到 HTTP 状态码」的映射，那个留在各插件里。
 */

/** 读错误对象上的字符串 `code`；没有或不是字符串时返回 `undefined`。 */
export function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** 把任意错误转成可以展示给用户的文本。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
