#!/usr/bin/env node
/**
 * 把 TypeScript 编译出来的中间产物打成插件最终要发布的两个文件：
 *
 *   `.build/<插件>/index.js`        → `plugins/<插件>/lib/index.js`   （宿主一半，ESM）
 *   `.build/<插件>/client/index.js` → `plugins/<插件>/lib/client.js`  （浏览器一半，包进 ModuleLoader 外壳）
 *
 * 中间产物由 `pnpm run build:code`（`tsc -p` 逐个工程）生成，放在仓库根 `.build/`
 * （不进版本库）；`lib/` 里的两个文件是
 * 随插件发布的运行文件，**必须提交**。CI 会重跑本脚本并检查 `lib/` 是否有改动，
 * 所以这里的结果必须是确定性的——不要写入时间戳、随机数或绝对路径。
 *
 * 用法：
 *   node scripts/build-clients.ts            # 构建全部插件
 *   node scripts/build-clients.ts bell workers  # 只构建指定插件
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'tsdown'
import { wrapModuleLoader } from './lib/envelope.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const BUILD_DIR = path.join(ROOT, '.build')
const PLUGINS_DIR = path.join(ROOT, 'plugins')

/** 由 DSH 浏览器模块表提供、从外壳的 `require` 里取，不打包进来。 */
const BASELINE_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

/**
 * 界面一半里所有 `@deepseek-ai/*` 都必须保持外部引用：它们是 DSH 自己提供的模块，
 * 打包进来会连 CSS 一起带进产物（tsdown 没装 CSS 插件，会直接失败），也与官方
 * 「界面插件不重复打包基座模块」的约定相悖。
 */
const HARNESS_MODULES = /^@deepseek-ai\//

/** 由 DSH 运行时提供的包：宿主一半只引用、不打包。 */
const HOST_EXTERNAL = [/^@deepseek-ai\//, /^node:/]

interface PluginManifest {
  readonly name: string
  readonly dsh?: { readonly client?: { readonly platform?: string } }
}

/** 读一个插件的清单；目录名就是包名后缀，这里顺带校验。 */
async function readManifest(dir: string): Promise<PluginManifest> {
  const file = path.join(PLUGINS_DIR, dir, 'package.json')
  return JSON.parse(await readFile(file, 'utf8')) as PluginManifest
}

/** 构建目录里只有一个入口时返回它，多于一个说明入口配错了。 */
async function singleOutput(dir: string): Promise<string> {
  const entries = (await readdir(dir)).filter((name) => /\.[cm]?js$/.test(name))
  if (entries.length !== 1) {
    throw new Error(`${dir} 应只有一个打包结果，实际是：${entries.join('、') || '（空）'}`)
  }
  return entries[0] as string
}

/** 清空并重建输出目录；`lib/` 是生成目录，不做增量。 */
async function resetDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

async function buildHost(dir: string, manifest: PluginManifest, outDir: string): Promise<void> {
  await build({
    entry: path.join(BUILD_DIR, dir, 'index.js'),
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outDir,
    deps: { neverBundle: HOST_EXTERNAL },
    dts: false,
    clean: true,
    logLevel: 'warn',
  })

  const produced = await singleOutput(outDir)
  const lib = path.join(PLUGINS_DIR, dir, 'lib')
  await mkdir(lib, { recursive: true })
  await writeFile(path.join(lib, 'index.js'), await readFile(path.join(outDir, produced)))
  process.stdout.write(`  ${manifest.name} → lib/index.js\n`)
}

async function buildClient(dir: string, manifest: PluginManifest, outDir: string): Promise<void> {
  await build({
    entry: path.join(BUILD_DIR, dir, 'client', 'index.js'),
    format: 'cjs',
    target: 'es2024',
    outDir,
    deps: { neverBundle: [...BASELINE_MODULES, HARNESS_MODULES] },
    dts: false,
    clean: true,
    logLevel: 'warn',
  })

  const produced = await singleOutput(outDir)
  const code = await readFile(path.join(outDir, produced), 'utf8')
  const lib = path.join(PLUGINS_DIR, dir, 'lib')
  await mkdir(lib, { recursive: true })
  await writeFile(path.join(lib, 'client.js'), wrapModuleLoader({ id: manifest.name, code }))
  process.stdout.write(`  ${manifest.name} → lib/client.js\n`)
}

async function buildPlugin(dir: string, onDemand: boolean): Promise<boolean> {
  const compiled = path.join(BUILD_DIR, dir, 'index.js')

  try {
    await readFile(compiled)
  } catch {
    // 迁移期间有的插件还没换到 src/，全量构建时跳过它们；点名要构建时报错。
    if (!onDemand) {
      process.stdout.write(`  跳过 ${dir}：还没有 tsc 产物（未迁移）\n`)
      return false
    }
    throw new Error(`缺少 ${path.relative(ROOT, compiled)}：先跑 pnpm run build:code`)
  }

  const manifest = await readManifest(dir)
  const outDir = path.join(BUILD_DIR, dir, 'bundle')

  await resetDir(path.join(PLUGINS_DIR, dir, 'lib'))
  await buildHost(dir, manifest, path.join(outDir, 'host'))

  if (manifest.dsh?.client === undefined) {
    process.stdout.write(`  ${manifest.name} 没有界面一半，跳过 client.js\n`)
    return true
  }
  await buildClient(dir, manifest, path.join(outDir, 'client'))
  return true
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2)
  const dirs = (await readdir(PLUGINS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => wanted.length === 0 || wanted.includes(name))
    .sort()

  if (dirs.length === 0) throw new Error('没有匹配到任何插件')

  const built: string[] = []
  for (const dir of dirs) {
    if (await buildPlugin(dir, wanted.length > 0)) built.push(dir)
  }
  if (built.length === 0) throw new Error('没有任何插件被构建：先跑 pnpm run build:code')
  process.stdout.write(`构建完成：${built.join('、')}\n`)
}

await main()
