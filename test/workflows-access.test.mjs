/**
 * 工作流工具可见性判定的单测。
 *
 * `resolveWorkflowAccess` 决定 `buka_workflow_*` 工具对哪个会话可见：默认只
 * 放行随插件发布的 `workflow-orchestrator` preset 的根会话。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePresets, resolveWorkflowAccess } from '../plugins/workflows/src/access.ts'

/**
 * 造一个最小会话对象。
 *
 * @param {{ parentSession?: string }} [header]
 * @returns {{ header: { parentSession?: string } }}
 */
function session(header = {}) {
  return { header }
}

/**
 * 假 sessions + agentPresets 服务。
 *
 * @param {{ preset?: string | null, parentSession?: string, missing?: boolean }} [options]
 */
function services(options = {}) {
  const preset = options.preset === undefined ? 'workflow-orchestrator' : options.preset
  const live = session(
    options.parentSession === undefined ? {} : { parentSession: options.parentSession },
  )
  return {
    sessions: {
      get(id) {
        return options.missing === true || id !== 'session-1' ? undefined : live
      },
    },
    agentPresets: {
      presetForSession(target) {
        assert.equal(target, live)
        return preset
      },
    },
  }
}

test('access: an empty allowlist leaves the tools open', () => {
  const access = resolveWorkflowAccess({ allowed: [], agentId: 'session-1', ...services() })
  assert.deepEqual(access, { visible: true, preset: null, reason: 'open' })
})

test('access: normalizes the configured preset list', () => {
  assert.deepEqual(normalizePresets([' a ', '', 3, null, 'b']), ['a', 'b'])
  assert.deepEqual(normalizePresets(undefined), [])
  assert.deepEqual(normalizePresets('workflow'), [])
})

test('access: unavailable preset services keep the tools visible', () => {
  const access = resolveWorkflowAccess({
    allowed: ['workflow-orchestrator'],
    agentId: 'session-1',
    sessions: undefined,
    agentPresets: undefined,
  })
  assert.equal(access.visible, true)
  assert.equal(access.reason, 'unavailable')
})

test('access: a root session of the allowed preset sees the tools', () => {
  const access = resolveWorkflowAccess({
    allowed: ['workflow-orchestrator'],
    agentId: 'session-1',
    ...services(),
  })
  assert.deepEqual(access, { visible: true, preset: 'workflow-orchestrator', reason: 'allowed' })
})

test('access: a session of another preset is denied', () => {
  const access = resolveWorkflowAccess({
    allowed: ['workflow-orchestrator'],
    agentId: 'session-1',
    ...services({ preset: 'standard' }),
  })
  assert.equal(access.visible, false)
  assert.equal(access.reason, 'denied')
  assert.equal(access.preset, 'standard')
})

test('access: a child session of the allowed preset is denied', () => {
  const access = resolveWorkflowAccess({
    allowed: ['workflow-orchestrator'],
    agentId: 'session-1',
    ...services({ parentSession: 'session-0' }),
  })
  assert.equal(access.visible, false)
  assert.equal(access.reason, 'child-session')
})

test('access: a session without a recorded preset is denied', () => {
  const access = resolveWorkflowAccess({
    allowed: ['workflow-orchestrator'],
    agentId: 'session-1',
    ...services({ preset: null }),
  })
  assert.equal(access.visible, false)
  assert.equal(access.reason, 'no-preset')
})

test('access: an unknown session is denied', () => {
  const access = resolveWorkflowAccess({
    allowed: ['workflow-orchestrator'],
    agentId: 'session-1',
    ...services({ missing: true }),
  })
  assert.equal(access.visible, false)
  assert.equal(access.reason, 'no-session')
})
