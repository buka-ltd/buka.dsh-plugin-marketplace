#!/usr/bin/env node
/**
 * 逐个插件跑 `tsc -p`（不用 `tsc -b`：项目引用要求 `composite`，而 `composite`
 * 强制产出 `.d.ts`，插件的编译产物不需要类型声明）。
 *
 * 只编译已经有 `tsconfig.json` 的插件——迁移期间未迁移的插件仍然直接跑手写 JS。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc')

/**
 * 收集某类目录下已有 tsconfig 的项目。
 *
 * 编译顺序很重要：`packages/*` 先编（插件从它们的 `lib/` 里读类型），再编 `plugins/*`。
 */
function projects(group: 'packages' | 'plugins'): string[] {
  const dir = path.join(ROOT, group)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, 'tsconfig.json'))
    .filter((config) => existsSync(config))
    .sort()
}

const configs = [...projects('packages'), ...projects('plugins')]

if (configs.length === 0) {
  process.stdout.write('没有需要编译的项目（都还没有 src/）\n')
  process.exit(0)
}

for (const config of configs) {
  process.stdout.write(`编译 ${path.relative(ROOT, config)}\n`)
  const result = spawnSync(TSC, ['-p', config], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
