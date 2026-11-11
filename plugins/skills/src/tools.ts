/**
 * 模型工具：只读列举全局 skills。
 *
 * 一个只读工具 `buka_skills`，让模型能回答「本机装了哪些全局 skill、它们
 * 是不是 npx skills 装的」。安装与卸载都是写操作，只留给页面上的用户按钮，
 * 不开放给模型。
 *
 * @module @buka/dsh-plugin-skills/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { GlobalSkillsSnapshot } from './skill-store.ts'

/** 工具注册需要的共享依赖：都由入口装配好后传进来。 */
export interface ToolDeps {
  /** 读一份已安装 skills 快照。 */
  readonly readSnapshot: () => Promise<GlobalSkillsSnapshot>
}

/**
 * 注册只读工具。
 *
 * @param ctx 提供 `tools` 的插件上下文
 * @param deps 入口装配好的共享依赖
 */
export function registerTools(ctx: Context, deps: ToolDeps): void {
  const { readSnapshot } = deps

  // ---- 模型工具：只读列举 ------------------------------------------------

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(
      defineTool({
        name: 'buka_skills',
        description:
          'List the skills installed globally for every DSH session (~/.agents/skills and ~/.dsh/skills) and mark the ones the npx skills CLI installed and manages. Use it when the user asks which global skills exist or how one of them got installed. Uninstalling is a user action on the Skills page in the DSH sidebar.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              skills: {
                type: 'array',
                required: true,
                description: 'Global skills, sorted by name.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: {
                      type: 'string',
                      required: true,
                      description: 'Skill name from its frontmatter.',
                    },
                    description: {
                      type: 'string',
                      required: true,
                      description: 'Skill description from its frontmatter.',
                    },
                    scope: {
                      type: 'string',
                      required: true,
                      description: 'agents for ~/.agents/skills or dsh for ~/.dsh/skills.',
                    },
                    managedByNpx: {
                      type: 'boolean',
                      required: true,
                      description: 'Whether the npx skills CLI installed and manages this skill.',
                    },
                    source: {
                      type: 'string',
                      description:
                        'For npx-managed skills, the source repository such as firecrawl/skills.',
                    },
                  },
                },
              },
            },
          },
          render: (_args, value) => {
            const skills = Array.isArray(value?.skills) ? value.skills : []
            if (skills.length === 0)
              return [{ type: 'text', text: 'No global skills are installed.' }]
            return [
              {
                type: 'text',
                text: skills
                  .map((skill) => {
                    const origin = skill.managedByNpx ? 'npx skills' : 'manual'
                    const source = skill.source === undefined ? '' : ` — ${skill.source}`
                    return `- ${skill.name} (${origin}, ${skill.scope})${source}`
                  })
                  .join('\n'),
              },
            ]
          },
        },
        async execute() {
          const snapshot = await readSnapshot()
          return {
            skills: snapshot.skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              scope: skill.scope,
              managedByNpx: skill.managedByNpx,
              ...(skill.npxSource === null ? {} : { source: skill.npxSource }),
            })),
          }
        },
      }),
    )
  })
}
