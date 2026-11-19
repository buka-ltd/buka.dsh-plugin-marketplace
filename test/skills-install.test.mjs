/**
 * 「安装」流程的单测。
 *
 * 安装走 `skills` 包的库 API；这里注入假 `install`，验证本插件负责的部分：
 *
 * - 安装目录名与 `skills` 的 sanitizeName() 一致；
 * - 全局 / 执行者 / 工作区三种目标的 scope、cwd、agents 与关闭遥测；
 * - 全局安装拒绝已安装、`DSH_AGENTS_HOME` 指到别处与非法名字；
 * - 页面入口只接受收藏过的来源，skill 是否存在以 Host 读到的仓库列表为准；
 * - 目录安装逐个执行、已装过的跳过、单个失败不中断且汇总。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { addSavedRepo } from '../plugins/skills/src/repo-store.ts'
import {
  installGlobalSkill,
  installProjectSkill,
  installSavedSkill,
  installSavedSkillGroup,
  isInstallableSkillName,
  MAX_GROUP_SKILLS,
  skillDirName,
} from '../plugins/skills/src/skill-install.ts'

/** 在 `<dir>/SKILL.md` 写一个最小可发现的 skill。 */
async function writeSkill(dir, name, description = name) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
}

/** 造一份独立的全局 home，别碰真实 `~/.agents` / `~/.dsh`。 */
async function makeHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-install-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return {
    root,
    homes: { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') },
  }
}

/**
 * 假安装器：记录调用，并把每个 skill 写进目标目录（模拟库的行为）。
 *
 * @param {{ homes: { agentsHome: string }, fail?: boolean, missing?: boolean }} options
 */
function fakeInstaller({ homes, fail = false, missing = false } = {}) {
  const calls = []
  const install = async (source, options = {}) => {
    calls.push({ source, options })
    if (fail) {
      return {
        installed: [],
        skipped: [],
        failed: [{ skill: 'demo', agent: 'universal', message: 'boom' }],
      }
    }
    const skills = Array.isArray(options.skills) ? options.skills : []
    const global = options.scope === 'global'
    const directory = global ? path.join(homes.agentsHome, 'skills') : options.cwd
    const installed = skills.map((name) => ({
      skill: name,
      agent: 'universal',
      scope: global ? 'global' : 'project',
      mode: 'copy',
      path: path.join(directory ?? '', 'placeholder', skillDirName(name)),
    }))
    // fake 的路径是 `<dir>/.agents/skills/<id>`；全局是 `~/.agents/skills/<id>`。
    const normalized = []
    for (const entry of installed) {
      const target = global
        ? path.join(homes.agentsHome, 'skills', skillDirName(entry.skill))
        : path.join(options.cwd ?? '', '.agents', 'skills', skillDirName(entry.skill))
      if (!missing) await writeSkill(target, skillDirName(entry.skill))
      normalized.push({ ...entry, path: target })
    }
    return { installed: normalized, skipped: [], failed: [] }
  }
  return { install, calls }
}

test('安装目录名与 skills 的 sanitizeName() 一致', () => {
  const cases = new Map([
    ['Web Design Guidelines', 'web-design-guidelines'],
    ['Convex Best Practices', 'convex-best-practices'],
    ['My_Skill.v2', 'my_skill.v2'],
    ['../etc', 'etc'],
    ['UPPER', 'upper'],
    ['.hidden.', 'hidden'],
    ['---', ''],
    ['', ''],
  ])
  for (const [input, expected] of cases) assert.equal(skillDirName(input), expected, input)
  assert.equal(skillDirName(undefined), '')
  assert.equal(skillDirName('x'.repeat(300)).length, 255)
})

test('只接受能安全交给安装库的名字', () => {
  assert.equal(isInstallableSkillName('demo'), true)
  assert.equal(isInstallableSkillName('Convex Best Practices'), true)
  assert.equal(isInstallableSkillName(''), false)
  assert.equal(isInstallableSkillName('  demo'), false)
  assert.equal(isInstallableSkillName('-demo'), false)
  assert.equal(isInstallableSkillName('bad\u0000name'), false)
  assert.equal(isInstallableSkillName(undefined), false)
})

test('全局安装：原始来源交给 installSkills，scope/agents/遥测正确', async (t) => {
  const { homes } = await makeHomes(t)
  const fake = fakeInstaller({ homes })

  const result = await installGlobalSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    source: 'vercel-labs/agent-skills',
    name: 'Web Design Guidelines',
    install: fake.install,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.id, 'web-design-guidelines')
  assert.equal(result.target, 'global')
  assert.equal(result.path, path.join(homes.agentsHome, 'skills', 'web-design-guidelines'))

  assert.equal(fake.calls.length, 1)
  const call = fake.calls[0]
  assert.equal(call.source, 'vercel-labs/agent-skills', 'lock 里应保留原始来源')
  assert.deepEqual(call.options.skills, ['Web Design Guidelines'])
  assert.equal(call.options.scope, 'global')
  assert.deepEqual(call.options.agents, ['universal'])
  assert.deepEqual(call.options.config, { telemetry: false })
})

test('全局安装：已安装、非法名字、DSH_AGENTS_HOME 不一致都提前拒绝', async (t) => {
  const { root, homes } = await makeHomes(t)
  const fake = fakeInstaller({ homes })
  await writeSkill(path.join(homes.agentsHome, 'skills', 'demo'), 'demo')

  const already = await installGlobalSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    source: 'acme/demo',
    name: 'demo',
    install: fake.install,
  })
  assert.equal(already.ok, false)
  assert.equal(already.code, 'already-installed')

  const badName = await installGlobalSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    source: 'acme/demo',
    name: '-oops',
    install: fake.install,
  })
  assert.equal(badName.ok, false)
  assert.equal(badName.code, 'invalid-skill-name')

  const mismatch = await installGlobalSkill({
    homes,
    canonicalAgentsHome: path.join(root, 'other-agents'),
    source: 'acme/demo',
    name: 'demo2',
    install: fake.install,
  })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.code, 'unsupported-home')
  assert.equal(fake.calls.length, 0)
})

test('全局安装：库失败与目标缺少 SKILL.md 都按失败上报', async (t) => {
  const { homes } = await makeHomes(t)
  const failing = fakeInstaller({ homes, fail: true })
  const failed = await installGlobalSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    source: 'acme/demo',
    name: 'demo',
    install: failing.install,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'install-failed')
  assert.match(String(failed.message), /boom/u)

  const missing = fakeInstaller({ homes, missing: true })
  const incomplete = await installGlobalSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    source: 'acme/demo',
    name: 'demo',
    install: missing.install,
  })
  assert.equal(incomplete.ok, false)
  assert.equal(incomplete.code, 'install-incomplete')
})

test('项目级安装：执行者写 universal + claude-code，工作区只写 universal', async (t) => {
  const { root } = await makeHomes(t)
  const workerDir = path.join(root, 'worker')
  const workspaceDir = path.join(root, 'workspace')
  await fs.mkdir(workerDir, { recursive: true })
  await fs.mkdir(workspaceDir, { recursive: true })

  const calls = []
  const install = async (source, options = {}) => {
    calls.push({ source, options })
    const target = path.join(options.cwd, '.agents', 'skills', 'demo')
    await writeSkill(target, 'demo')
    return {
      installed: [
        { skill: 'demo', agent: 'universal', scope: 'project', mode: 'copy', path: target },
      ],
      skipped: [],
      failed: [],
    }
  }

  const worker = await installProjectSkill({
    targetDir: workerDir,
    target: 'worker',
    source: 'acme/demo',
    name: 'demo',
    install,
  })
  assert.equal(worker.ok, true)
  assert.deepEqual(calls[0].options.agents, ['universal', 'claude-code'])
  assert.equal(calls[0].options.cwd, workerDir)
  assert.equal(calls[0].options.scope, 'project')

  const workspace = await installProjectSkill({
    targetDir: workspaceDir,
    target: 'workspace',
    source: 'acme/demo',
    name: 'demo',
    install,
  })
  assert.equal(workspace.ok, true)
  assert.deepEqual(calls[1].options.agents, ['universal'])

  const missingTarget = await installProjectSkill({
    targetDir: '',
    target: 'worker',
    source: 'acme/demo',
    name: 'demo',
    install,
  })
  assert.equal(missingTarget.code, 'no-target')
})

test('页面入口：只安装收藏过的来源，skill 必须在 Host 读到的列表里', async (t) => {
  const { homes, root } = await makeHomes(t)
  const repoDir = path.join(root, 'repo')
  await addSavedRepo({ homes, source: repoDir })
  const fake = fakeInstaller({ homes })
  const catalog = {
    listSkills: async () => ({
      ok: true,
      skills: [
        { name: 'alpha', description: '', path: 'skills/alpha' },
        { name: 'beta', description: '', path: 'skills/beta' },
      ],
    }),
  }

  const notSaved = await installSavedSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: 'acme/other',
    skillPath: 'skills/alpha',
    install: fake.install,
  })
  assert.equal(notSaved.ok, false)
  assert.equal(notSaved.code, 'not-saved')

  const notFound = await installSavedSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: repoDir,
    skillPath: 'skills/nope',
    install: fake.install,
  })
  assert.equal(notFound.ok, false)
  assert.equal(notFound.code, 'skill-not-found')

  const installed = await installSavedSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: repoDir,
    skillPath: 'skills/alpha',
    install: fake.install,
  })
  assert.equal(installed.ok, true)
  if (installed.ok) {
    assert.equal(installed.repo, repoDir, 'lock 来源应保持本地路径')
    assert.equal(installed.name, 'alpha')
  }
  assert.equal(fake.calls[0].source, repoDir)
})

test('安装到执行者：Host 解析目录后才交给安装库', async (t) => {
  const { homes, root } = await makeHomes(t)
  const workerDir = path.join(root, 'worker')
  await fs.mkdir(workerDir, { recursive: true })
  await addSavedRepo({ homes, source: 'acme/demo' })
  const catalog = {
    listSkills: async () => ({
      ok: true,
      skills: [{ name: 'demo', description: '', path: 'skills/demo' }],
    }),
  }
  const calls = []
  const install = async (source, options = {}) => {
    calls.push({ source, options })
    const target = path.join(options.cwd, '.agents', 'skills', 'demo')
    await writeSkill(target, 'demo')
    return {
      installed: [
        { skill: 'demo', agent: 'universal', scope: 'project', mode: 'copy', path: target },
      ],
      skipped: [],
      failed: [],
    }
  }

  const resolved = []
  const result = await installSavedSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: 'acme/demo',
    skillPath: 'skills/demo',
    target: 'worker',
    worker: 'writer',
    resolveTarget: async (request) => {
      resolved.push(request)
      return { ok: true, path: workerDir, label: 'writer' }
    },
    install,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(resolved, [{ target: 'worker', worker: 'writer', workspace: undefined }])
  assert.equal(calls[0].options.cwd, workerDir)

  const missing = await installSavedSkill({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: 'acme/demo',
    skillPath: 'skills/demo',
    target: 'worker',
    worker: 'ghost',
    resolveTarget: async () => ({ ok: false, code: 'unknown-worker', message: '没有这个执行者' }),
    install,
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'unknown-worker')
})

test('目录安装：逐个安装、已装过跳过、单个失败不中断', async (t) => {
  const { homes } = await makeHomes(t)
  await addSavedRepo({ homes, source: 'acme/demo' })
  const catalog = {
    listSkills: async () => ({
      ok: true,
      skills: [
        { name: 'alpha', description: '', path: 'skills/alpha' },
        { name: 'beta', description: '', path: 'skills/beta' },
        { name: 'gamma', description: '', path: 'skills/gamma' },
      ],
    }),
  }
  const calls = []
  const install = async (source, options = {}) => {
    calls.push({ source, options })
    const name = options.skills?.[0]
    if (name === 'beta') {
      return {
        installed: [],
        skipped: [],
        failed: [{ skill: 'beta', agent: 'universal', message: 'network down' }],
      }
    }
    const target = path.join(homes.agentsHome, 'skills', name)
    if (name === 'gamma') {
      // 已安装：返回 already-installed 由本插件根据 fake 的安装结果无法表达，
      // 这里先写目录，让第二次调用时被 findInstalledElsewhere 命中。
      await writeSkill(target, name)
      return {
        installed: [],
        skipped: [],
        failed: [],
      }
    }
    await writeSkill(target, name)
    return {
      installed: [{ skill: name, agent: 'universal', scope: 'global', mode: 'copy', path: target }],
      skipped: [],
      failed: [],
    }
  }

  const result = await installSavedSkillGroup({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: 'acme/demo',
    skillPaths: ['skills/alpha', 'skills/beta'],
    install,
  })
  assert.equal(result.ok, false, '有一个失败就整体失败')
  assert.deepEqual(result.installed, [
    { name: 'alpha', id: 'alpha', path: path.join(homes.agentsHome, 'skills', 'alpha') },
  ])
  assert.deepEqual(
    result.failed.map((one) => one.name),
    ['beta'],
  )

  const skipped = await installSavedSkillGroup({
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: 'acme/demo',
    skillPaths: ['skills/alpha'],
    install,
  })
  assert.equal(skipped.ok, true)
  assert.deepEqual(skipped.skipped, [{ name: 'alpha' }])
})

test('目录安装：路径形状、数量上限与未知 skill 在调用安装库之前拒绝', async (t) => {
  const { homes } = await makeHomes(t)
  await addSavedRepo({ homes, source: 'acme/demo' })
  const fake = fakeInstaller({ homes })
  const catalog = {
    listSkills: async () => ({
      ok: true,
      skills: [{ name: 'alpha', description: '', path: 'skills/alpha' }],
    }),
  }
  const base = {
    homes,
    canonicalAgentsHome: homes.agentsHome,
    catalog,
    source: 'acme/demo',
    install: fake.install,
  }

  const empty = await installSavedSkillGroup({ ...base, skillPaths: [] })
  assert.equal(empty.code, 'invalid-skill-paths')

  const tooMany = await installSavedSkillGroup({
    ...base,
    skillPaths: Array.from({ length: MAX_GROUP_SKILLS + 1 }, (_, index) => `skills/${index}`),
  })
  assert.equal(tooMany.code, 'invalid-skill-paths')

  const unknown = await installSavedSkillGroup({ ...base, skillPaths: ['skills/nope'] })
  assert.equal(unknown.code, 'skill-not-found')
  assert.equal(fake.calls.length, 0)
})
