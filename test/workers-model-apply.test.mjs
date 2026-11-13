/**
 * `agent/created` 模型套用的单测：只给智能体目录里的新会话选模型，
 * 已有显式 `model/selection` 的会话不覆盖。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerWorkerModelEnforcement } from '../plugins/workers/src/model-apply.ts'
import {
  addWorker,
  resolveWorkerRegistryFile,
  setWorkerModel,
} from '../plugins/workers/src/worker-store.ts'

/** 建临时登记表 + 一个配了模型的 writer。 */
async function makeHarness() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-model-apply-'))
  const workersDir = path.join(root, 'workers')
  const registryFile = resolveWorkerRegistryFile(workersDir)
  await addWorker({ workersDir, file: registryFile, name: 'writer' })
  await setWorkerModel({
    file: registryFile,
    name: 'writer',
    model: { provider: 'p1', model: 'm1', reasoningEffort: 'high' },
  })

  const listeners = new Map()
  const warnings = []
  const ctx = {
    effect: (fn) => fn(),
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    logger: { info() {}, warn: (message) => warnings.push(String(message)) },
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'default', model: 'default' }) }
      }
      return undefined
    },
  }
  registerWorkerModelEnforcement(ctx, registryFile)
  return {
    root,
    workersDir,
    registryFile,
    warnings,
    async created(payload) {
      const listener = listeners.get('agent/created')
      assert.equal(typeof listener, 'function')
      await listener(payload)
    },
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

/** 一个 live agent 的最小形状。 */
function makeAgent({ cwd, events = [] } = {}) {
  const selections = []
  return {
    selections,
    agent: {
      session: {
        header: { cwd },
        snapshotEvents: () => events,
      },
      model: {
        current: () => ({ provider: 'default', model: 'default' }),
        select: (selection) => selections.push(selection),
      },
    },
  }
}

test('模型套用：新会话按打工人目录使用登记的模型', async () => {
  const harness = await makeHarness()
  try {
    const { agent, selections } = makeAgent({
      cwd: path.join(harness.workersDir, 'writer'),
    })
    await harness.created({ agent })
    assert.deepEqual(selections, [{ provider: 'p1', model: 'm1', reasoningEffort: 'high' }])
    assert.deepEqual(harness.warnings, [])
  } finally {
    await harness.cleanup()
  }
})

test('模型套用：已有显式模型选择、目录不匹配或没有配置模型时不覆盖', async () => {
  const harness = await makeHarness()
  try {
    // 会话里已经有 model/selection：用户切过模型或恢复的旧会话。
    const selected = makeAgent({
      cwd: path.join(harness.workersDir, 'writer'),
      events: [{ type: 'model/selection', data: {} }],
    })
    await harness.created({ agent: selected.agent })
    assert.deepEqual(selected.selections, [])

    // 已经用过模型（request/header）：恢复的会话保留自己的模型。
    const used = makeAgent({
      cwd: path.join(harness.workersDir, 'writer'),
      events: [{ type: 'request/header', data: {} }],
    })
    await harness.created({ agent: used.agent })
    assert.deepEqual(used.selections, [])

    // 调用方显式给了非默认模型（工作流 agentOptions 覆盖）：保留调用方的选择。
    const overridden = makeAgent({ cwd: path.join(harness.workersDir, 'writer') })
    overridden.agent.model.current = () => ({ provider: 'caller', model: 'caller' })
    await harness.created({ agent: overridden.agent })
    assert.deepEqual(overridden.selections, [])

    // 不在打工人目录里。
    const elsewhere = makeAgent({ cwd: path.join(harness.root, 'elsewhere') })
    await harness.created({ agent: elsewhere.agent })
    assert.deepEqual(elsewhere.selections, [])

    // 子 agent 不套用父目录的模型。
    const subagent = makeAgent({ cwd: path.join(harness.workersDir, 'writer') })
    subagent.agent.session.header.origin = 'subagent'
    await harness.created({ agent: subagent.agent })
    assert.deepEqual(subagent.selections, [])

    // 没有 agent 形状 / 没有 cwd：静默跳过。
    await harness.created({})
    await harness.created({ agent: makeAgent().agent })
  } finally {
    await harness.cleanup()
  }
})
