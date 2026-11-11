/**
 * 把打好的 CJS 代码包进 DSH 的浏览器模块外壳。
 *
 * DSH 的界面一半只能以 `window.__ModuleLoader__.load({ id, factory })` 的形式交付：
 * `id` 必须等于包名，`factory` 收到一个 `require`（只提供模块表里的基线模块，例如
 * `react`），返回 `{ inject, apply }`。官方没有把这层构建工具发布出来，所以由本文件生成。
 *
 * 生成结果与官方产物的形状一致：工厂内部先造 `module` / `exports`，再把 CJS 产物原样
 * 展开，最后返回 `module.exports`。
 */

export interface EnvelopeInput {
  /** 包名，必须等于 `package.json` 的 `name`。 */
  readonly id: string
  /** 打包器产出的 CJS 源码。 */
  readonly code: string
}

/** 把 CJS 源码包成 ModuleLoader 工厂，返回最终的 `client.js` 内容。 */
export function wrapModuleLoader({ id, code }: EnvelopeInput): string {
  const body = code
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `    ${line}`))
    .join('\n')

  return [
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(id)},`,
    '  factory: (require) => {',
    '    var module = { exports: {} }',
    '    var exports = module.exports',
    body,
    '    return module.exports',
    '  },',
    '})',
    '',
  ].join('\n')
}
