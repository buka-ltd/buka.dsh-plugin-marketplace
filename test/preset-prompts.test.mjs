/**
 * 随插件发布的 agent preset 的 persona 提示词必须能被 DSH 渲染。
 *
 * DSH 把 `@deepseek-ai/dsh-persona` 的 `prefix` / `suffix` 当作模板登记进
 * `deployment:persona-prefix` / `deployment:persona-suffix` 两个提示词段：渲染时
 * 每个完整的 `{{…}}` 都按提示词变量解析，变量名必须匹配 /^[a-z][a-z0-9_]*$/，
 * 且必须是运行时注册过的变量，否则 preset 的每一轮都直接抛错、整个预设不可用。
 *
 * issue #1 就是这么来的：`workflow-orchestrator` 的 prefix 里写了一句字面量的
 * `{{nodes.<id>.data.<path>}}` 说明（那是工作流自己的边 prompt 模板语法），
 * 被 DSH 当成了提示词变量。本仓库没有 DSH 运行时依赖，这里按
 * `@deepseek-ai/dsh-system-prompt` 的 `renderPrompt()` → `interpolate()` 逐条实现
 * 同一套扫描规则，把所有插件自带 preset 的 persona 完整渲染一遍当回归测试。
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

/** 与 DSH 的 `VARIABLE_NAME` 一致。 */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/u
/** 与 DSH 的 `GROUP_AT` 一致：扫描位置上的完整 `{{…}}` 组。 */
const GROUP_AT = /^\{\{([^{}]*)\}\}/u
/** `@deepseek-ai/dsh-agent-loop` 注册的全局提示词变量。 */
const RUNTIME_VARIABLES = Object.freeze({ provider: 'deepseek', model: 'flash' })

/**
 * `@deepseek-ai/dsh-system-prompt` 的 `interpolate()` 副本。
 * 完整的 `{{name}}` 必须合法且已注册；没有配对 `}}` 的孤立 `{{` 是普通文字。
 * @param {string} text
 * @param {string} section 报错用的提示词段名
 * @param {Record<string, string>} [variables]
 * @returns {string}
 */
function renderPromptText(text, section, variables = RUNTIME_VARIABLES) {
  let result = ''
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      if (text.indexOf('}}', open + 2) >= 0) {
        throw new Error(
          `malformed prompt variable reference at "${text.slice(open, open + 16)}…" in section "${section}" (references are complete simple {{name}} groups)`,
        )
      }
      result += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    const name = group[0].slice(2, -2)
    if (!VARIABLE_NAME.test(name)) {
      throw new Error(`malformed prompt variable reference "{{${name}}}" in section "${section}" (variable names match ${String(VARIABLE_NAME)})`)
    }
    if (!Object.hasOwn(variables, name)) {
      throw new Error(`unknown prompt variable "{{${name}}}" in section "${section}"; registered variables: ${Object.keys(variables).join(', ') || '(none)'}`)
    }
    result += text.slice(last, open) + variables[name]
    last = open + group[0].length
  }
  return result + text.slice(last)
}

/**
 * 取出 cordis.patch.yml 里 `@deepseek-ai/dsh-persona` 的 `prefix` / `suffix` 块标量。
 * 这两个键只出现在 persona 的 config 里，也就是它注册的两个提示词段。
 * @param {string} patchText
 * @returns {Array<{ key: string, section: string, text: string }>}
 */
function extractPersonaPrompts(patchText) {
  const lines = patchText.split('\n')
  const prompts = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(prefix|suffix):\s*[|>][+-]?\s*$/u.exec(lines[index])
    if (match === null) continue
    const keyIndent = match[1].length
    const body = []
    let blockIndent = null
    let next = index + 1
    for (; next < lines.length; next += 1) {
      const line = lines[next]
      if (line.trim() === '') {
        body.push('')
        continue
      }
      const indent = line.length - line.trimStart().length
      if (indent <= keyIndent) break
      blockIndent ??= indent
      body.push(line.slice(blockIndent))
    }
    prompts.push({
      key: match[2],
      section: `deployment:persona-${match[2]}`,
      text: body.join('\n').replace(/\n+$/u, ''),
    })
    index = next - 1
  }
  return prompts
}

const pluginDirectories = readdirSync(new URL('../plugins', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort()

test('随插件发布的 preset persona 提示词都能被 DSH 渲染（issue #1 回归）', () => {
  let rendered = 0
  for (const directory of pluginDirectories) {
    const pluginRoot = new URL(`../plugins/${directory}/`, import.meta.url)
    let manifest
    try {
      manifest = JSON.parse(readFileSync(new URL('package.json', pluginRoot), 'utf8'))
    } catch {
      continue // 没有 package.json 的目录由 pnpm run check 报错，这里不重复。
    }
    const patch = manifest.dsh?.bundle?.patch
    if (patch === undefined) continue // 不是 bundle，没有补丁层。
    for (const one of Array.isArray(patch) ? patch : [patch]) {
      const prompts = extractPersonaPrompts(readFileSync(new URL(one, pluginRoot), 'utf8'))
      for (const prompt of prompts) {
        try {
          renderPromptText(prompt.text, prompt.section)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          assert.fail(`${directory} 的 preset persona ${prompt.key} 渲染失败：${reason}`)
        }
        rendered += 1
      }
    }
  }
  assert.ok(rendered > 0, '没有找到任何 preset persona 前缀，测试会变成空转')
})

test('提示词扫描规则与 DSH 一致：非法变量名会抛错', () => {
  assert.throws(
    () => renderPromptText('checked when you validate: a {{nodes.<id>.data.<path>}} reference must be declared', 'deployment:persona-prefix'),
    /malformed prompt variable reference "\{\{nodes\.<id>\.data\.<path>\}\}" in section "deployment:persona-prefix"/u,
  )
})

test('提示词扫描规则与 DSH 一致：未知变量与缺配对的花括号都会抛错', () => {
  assert.throws(() => renderPromptText('{{missing}}', 'deployment:persona-suffix'), /unknown prompt variable "\{\{missing\}\}"/u)
  assert.throws(() => renderPromptText('a {{b c}} reference', 'deployment:persona-suffix'), /malformed prompt variable reference/u)
  assert.throws(() => renderPromptText('a {{b}c}} reference', 'deployment:persona-suffix'), /malformed prompt variable reference/u)
})

test('提示词扫描规则与 DSH 一致：已注册变量会替换，孤立 {{ 保留为普通文字', () => {
  assert.equal(renderPromptText('model={{model}} provider={{provider}}', 'deployment:persona-prefix'), 'model=flash provider=deepseek')
  assert.equal(renderPromptText('a lone {{ stays literal', 'deployment:persona-prefix'), 'a lone {{ stays literal')
})
