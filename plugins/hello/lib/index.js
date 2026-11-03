/**
 * 最小可用的 DSH 插件：注册一个 `buka_hello` 工具。
 *
 * 这是插件的「模板」也是「冒烟用例」：装上以后让模型调用一次 buka_hello，
 * 能证明 bundle 被 composition 加载、工具注册表被注入、索引钉住的 commit 可装。
 *
 * @module @buka/dsh-plugin-hello
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 不是一回事。 */
export const name = 'tool-buka-hello'

/** 依赖的服务：只用到工具注册表。 */
export const inject = ['tools']

const MARKETPLACE = 'https://github.com/buka-ltd/buka.dsh-plugin-marketplace'

/**
 * 注册 `buka_hello`。
 * @param {import('@deepseek-ai/cordis').Context} ctx 提供 `tools` 的上下文
 */
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'buka_hello',
      description:
        'Return a greeting and the Buka DSH plugin marketplace address. Use it to confirm that a third-party DSH bundle is installed and mounted.',
      parameters: {
        name: {
          type: 'string',
          description: 'Who to greet. Omit to greet the world.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            greeting: {
              type: 'string',
              required: true,
              description: 'The greeting line.',
            },
            marketplace: {
              type: 'string',
              required: true,
              description: 'Address of the plugin marketplace this bundle ships from.',
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.greeting }],
      },
      async execute(args) {
        const who = typeof args.name === 'string' && args.name.trim() !== '' ? args.name.trim() : 'world'
        return {
          greeting: `Hello, ${who}! This tool came from an installed DSH plugin bundle.`,
          marketplace: MARKETPLACE,
        }
      },
    }),
  )
}
