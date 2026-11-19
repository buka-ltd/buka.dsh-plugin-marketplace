/**
 * 执行提示词拆分单测：规则 + 任务内容走上下文，任务类型的定义走用户消息。
 *
 * 三段内容的作者不同（插件 / 流程维护者 / 创建者），投递身份也不同；这里只测
 * 文本怎么切，投递由 workers 服务与引擎各自覆盖。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildExecutionPrompt,
  buildExecutionPromptSections,
} from '../plugins/workflows/src/engine/prompt.ts'

test('prompt: splits rules and content from the task type definition', () => {
  const task = { content: { request: '实现登录页' } }
  const taskType = { definition: '先读代码。\n\n/grill-with-docs' }
  const sections = buildExecutionPromptSections({ task, taskType })

  assert.match(sections.context, /## 工作流规则/u)
  assert.match(sections.context, /## 任务内容/u)
  assert.match(sections.context, /实现登录页/u)
  assert.doesNotMatch(sections.context, /## 任务类型的定义/u)
  assert.doesNotMatch(sections.context, /grill-with-docs/u)

  assert.equal(sections.userPrompt, '先读代码。\n\n/grill-with-docs')

  // 落盘的完整文本仍是固定顺序：规则 → 定义 → 内容。
  assert.equal(sections.prompt, buildExecutionPrompt({ task, taskType }))
  for (const heading of ['## 工作流规则', '## 任务类型的定义', '## 任务内容']) {
    assert.match(sections.prompt, new RegExp(heading, 'u'))
  }
  assert.ok(sections.prompt.indexOf('## 工作流规则') < sections.prompt.indexOf('## 任务类型的定义'))
  assert.ok(sections.prompt.indexOf('## 任务类型的定义') < sections.prompt.indexOf('## 任务内容'))
})

test('prompt: string task content stays in the context, never in the user prompt', () => {
  const task = { content: '把发布说明写成三段。/grill-with-docs' }
  const taskType = { definition: '/grill-with-docs' }
  const sections = buildExecutionPromptSections({ task, taskType })

  assert.match(sections.context, /把发布说明写成三段。\/grill-with-docs/u)
  assert.equal(
    sections.userPrompt,
    '/grill-with-docs',
    'only the definition reaches the user message',
  )
})

test('prompt: an empty definition produces no user prompt and degrades to a single text', () => {
  const task = { content: { request: '实现登录页' } }
  for (const definition of [undefined, '', '   \n  ']) {
    const sections = buildExecutionPromptSections({ task, taskType: { definition } })
    assert.equal(sections.userPrompt, null)
    assert.equal(
      sections.context,
      sections.prompt,
      'nothing is dropped when there is no definition',
    )
    assert.doesNotMatch(sections.prompt, /## 任务类型的定义/u)
  }
})

test('prompt: create mode tells the executor to create worktrees itself', () => {
  const task = { content: { request: '实现登录页' } }
  const taskType = { definition: '先读代码。' }
  const sections = buildExecutionPromptSections({ task, taskType, worktree: 'create' })

  assert.match(sections.context, /## 工作树/u)
  assert.match(sections.context, /`create_worktree`/u)
  assert.match(sections.context, /多个仓库/u)
  assert.match(sections.context, /`working_directory`/u)
  assert.match(sections.prompt, /## 工作树/u)
  assert.ok(
    sections.prompt.indexOf('## 工作流规则') < sections.prompt.indexOf('## 工作树'),
    'worktree rules follow the workflow rules',
  )
  assert.ok(
    sections.prompt.indexOf('## 工作树') < sections.prompt.indexOf('## 任务类型的定义'),
    'worktree rules precede the task type definition',
  )
  assert.equal(sections.userPrompt, '先读代码。', 'the definition stays a user message')
})

test('prompt: guard mode asks the user about dirty files without creating a worktree', () => {
  const task = { content: { request: '实现登录页' } }
  const sections = buildExecutionPromptSections({ task, taskType: {}, worktree: 'guard' })
  assert.match(sections.context, /## 工作区/u)
  assert.match(sections.context, /本任务不创建新的工作树/u)
  assert.match(sections.context, /未提交的修改/u)
  assert.match(sections.context, /必须停下来询问用户/u)
  assert.doesNotMatch(sections.prompt, /`create_worktree`/u)
})

test('prompt: no worktree rules appear without a worktree setting', () => {
  const task = { content: { request: '实现登录页' } }
  for (const worktree of [undefined, null]) {
    const sections = buildExecutionPromptSections({ task, taskType: {}, worktree })
    assert.doesNotMatch(sections.prompt, /## 工作树/u)
    assert.doesNotMatch(sections.prompt, /工作树/u)
  }
})
