/**
 * 「收藏仓库里的 skill 一键装到全局」的单测。
 *
 * 覆盖容易回归的几件事：
 * - 目录名与 `npx skills` 的 sanitizeName() 一致（页面与 Host 都靠它认「已安装」）；
 * - 安装前拒绝：非法来源、非法 skill 名、已安装、DSH_AGENTS_HOME 指到 npx 不会写的位置；
 * - 全局安装走 `npx skills add <来源> --skill <名字> --global --yes`，退出码为 0 但
 *   SKILL.md 不在时按失败上报；
 * - 页面安装入口只接受收藏过的来源，skill 是否存在以 Host 读到的仓库列表为准
 *   （浏览器只传路径）；
 * - 打工人 / 工作区安装把目标目录交给 `npx skills add`，在目标目录里执行，
 *   浏览器传的名字 / 路径由 Host 解析成可信目录。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { addSavedRepo, repoStoreFile } from '../plugins/skills/src/repo-store.ts'
import {
  installGlobalSkill,
  installProjectSkill,
  installSavedSkill,
  isInstallableSkillName,
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
async function makeHomes() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-install-'))
  return {
    root,
    homes: { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') },
  }
}

/** 假目录：`npx skills add` 成功时会写入规范副本，这里照着写一份。 */
function fakeInstaller(homes, calls) {
  return async (args) => {
    calls.push(args)
    const name = args[args.indexOf('--skill') + 1]
    await writeSkill(
      path.join(homes.agentsHome, 'skills', skillDirName(name)),
      name,
      'installed by npx',
    )
    return { ok: true, output: 'installed' }
  }
}

test('安装目录名与 npx skills 的 sanitizeName() 一致', () => {
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

test('只接受能安全交给 --skill 的名字', () => {
  for (const good of ['web-design', 'Convex Best Practices', 'a', 'x'.repeat(255)]) {
    assert.equal(isInstallableSkillName(good), true, good)
  }
  for (const bad of [
    '',
    '-g',
    ' --global',
    ' leading-space',
    'a\nb',
    '...',
    'x'.repeat(256),
    undefined,
    42,
  ]) {
    assert.equal(isInstallableSkillName(bad), false, String(bad))
  }
})

test('安装：参数顺序正确，装完确认 SKILL.md 落到规范目录', async () => {
  const { root, homes } = await makeHomes()
  try {
    const calls = []
    const result = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'vercel-labs/agent-skills',
      name: 'Web Design Guidelines',
      runNpx: fakeInstaller(homes, calls),
    })

    assert.deepEqual(
      { ok: result.ok, id: result.id, name: result.name, scope: result.scope },
      { ok: true, id: 'web-design-guidelines', name: 'Web Design Guidelines', scope: 'agents' },
    )
    assert.equal(result.path, path.join(homes.agentsHome, 'skills', 'web-design-guidelines'))
    // 指定 universal agent：只写 ~/.agents/skills，不给其它 agent 目录建链接。
    assert.deepEqual(calls, [
      [
        'add',
        'vercel-labs/agent-skills',
        '--skill',
        'Web Design Guidelines',
        '--global',
        '--yes',
        '-a',
        'universal',
      ],
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('安装：CLI 不认识 universal agent 时退回默认选择', async () => {
  const { root, homes } = await makeHomes()
  try {
    const calls = []
    const result = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'vercel-labs/agent-skills',
      name: 'demo',
      runNpx: async (args) => {
        calls.push(args)
        if (calls.length === 1) {
          return { ok: false, message: 'npx skills 退出码 1', output: 'Invalid agents: universal' }
        }
        await writeSkill(path.join(homes.agentsHome, 'skills', 'demo'), 'demo')
        return { ok: true, output: 'installed' }
      },
    })

    assert.equal(result.ok, true)
    assert.equal(calls.length, 2, '应先带 universal 试一次，失败后再退回默认命令')
    assert.deepEqual(calls[1], [
      'add',
      'vercel-labs/agent-skills',
      '--skill',
      'demo',
      '--global',
      '--yes',
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('安装：非法请求与已安装都在调用 npx 之前拒绝', async () => {
  const { root, homes } = await makeHomes()
  try {
    let calls = 0
    const notCalled = async () => {
      calls += 1
      return { ok: true }
    }

    const noSource = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: '',
      name: 'x',
      runNpx: notCalled,
    })
    assert.equal(noSource.code, 'invalid-source')
    const dashSource = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: '--global',
      name: 'x',
      runNpx: notCalled,
    })
    assert.equal(dashSource.code, 'invalid-source')
    const badName = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'a/b',
      name: '-g',
      runNpx: notCalled,
    })
    assert.equal(badName.code, 'invalid-skill-name')
    const noRunner = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'a/b',
      name: 'x',
    })
    assert.equal(noRunner.code, 'no-runner')

    // 两个全局根里的同名 skill 都算已安装，不再重复安装。
    await writeSkill(path.join(homes.agentsHome, 'skills', 'taken'), 'taken')
    const agentsTaken = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'a/b',
      name: 'Taken',
      runNpx: notCalled,
    })
    assert.equal(agentsTaken.code, 'already-installed')
    assert.equal(agentsTaken.message.includes('agents'), true)

    await writeSkill(path.join(homes.dshHome, 'skills', 'dsh-only'), 'dsh-only')
    const dshTaken = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'a/b',
      name: 'dsh-only',
      runNpx: notCalled,
    })
    assert.equal(dshTaken.code, 'already-installed')
    assert.equal(dshTaken.message.includes('dsh'), true)

    assert.equal(calls, 0, '以上都应该在调用 npx 之前返回')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('安装：DSH_AGENTS_HOME 指到 npx 不会写的位置时拒绝安装', async () => {
  const { root, homes } = await makeHomes()
  try {
    const result = await installGlobalSkill({
      homes,
      canonicalAgentsHome: path.join(root, 'another-agents'),
      source: 'a/b',
      name: 'x',
      runNpx: async () => {
        throw new Error('不该被调用')
      },
    })
    assert.equal(result.code, 'unsupported-home')
    assert.ok(result.message.includes('DSH_AGENTS_HOME'), result.message)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('安装：npx 失败与「退出码 0 但文件不在」都按失败上报', async () => {
  const { root, homes } = await makeHomes()
  try {
    const failed = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'a/b',
      name: 'x',
      runNpx: async () => ({ ok: false, message: 'exit 1', output: 'network down' }),
    })
    assert.deepEqual(
      { ok: failed.ok, code: failed.code, output: failed.output },
      { ok: false, code: 'npx-failed', output: 'network down' },
    )

    const incomplete = await installGlobalSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'a/b',
      name: 'x',
      runNpx: async () => ({ ok: true, output: 'done' }),
    })
    assert.deepEqual(
      { ok: incomplete.ok, code: incomplete.code, output: incomplete.output },
      { ok: false, code: 'install-incomplete', output: 'done' },
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('页面入口：只安装收藏过的来源，并要求 skill 在该仓库的列表里', async () => {
  const { root, homes } = await makeHomes()
  try {
    await addSavedRepo({
      homes,
      source: 'https://github.com/Vercel-Labs/agent-skills.git',
      note: '',
    })
    const calls = []
    const listed = []
    const catalog = {
      async listSkills({ source }) {
        listed.push(source)
        return {
          ok: true,
          kind: 'npx-skills',
          skills: [
            {
              name: 'Frontend Design',
              description: 'design',
              path: 'skills/frontend-design/SKILL.md',
              plugin: null,
            },
            {
              name: 'Next Best Practices',
              description: 'next',
              path: 'skills/next/SKILL.md',
              plugin: 'web',
            },
          ],
        }
      },
    }

    const result = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog,
      source: 'vercel-labs/agent-skills',
      skillPath: 'skills/next/SKILL.md',
      runNpx: fakeInstaller(homes, calls),
    })

    assert.deepEqual(
      { ok: result.ok, id: result.id, repo: result.repo, plugin: result.plugin },
      { ok: true, id: 'next-best-practices', repo: 'Vercel-Labs/agent-skills', plugin: 'web' },
    )
    assert.deepEqual(listed, ['Vercel-Labs/agent-skills'], '宿主用收藏里的规范化来源读列表')
    assert.deepEqual(calls, [
      [
        'add',
        'Vercel-Labs/agent-skills',
        '--skill',
        'Next Best Practices',
        '--global',
        '--yes',
        '-a',
        'universal',
      ],
    ])

    const notSaved = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog,
      source: 'other/repo',
      skillPath: 'skills/x/SKILL.md',
      runNpx: fakeInstaller(homes, calls),
    })
    assert.equal(notSaved.code, 'not-saved')

    const missing = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog,
      source: 'vercel-labs/agent-skills',
      skillPath: 'skills/gone/SKILL.md',
      runNpx: fakeInstaller(homes, calls),
    })
    assert.equal(missing.code, 'skill-not-found')

    // 浏览器没传路径时按名字匹配，Host 自己用仓库列表里的名字去装。
    const byName = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog,
      source: 'vercel-labs/agent-skills',
      name: 'Frontend Design',
      runNpx: fakeInstaller(homes, calls),
    })
    assert.equal(byName.id, 'frontend-design')

    const invalid = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog,
      source: 'not a source',
      skillPath: 'x',
      runNpx: fakeInstaller(homes, calls),
    })
    assert.equal(invalid.code, 'invalid-source')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('页面入口：仓库读取失败原样带回，收藏文件损坏时拒绝安装', async () => {
  const { root, homes } = await makeHomes()
  try {
    await addSavedRepo({ homes, source: 'owner/repo' })
    const rateLimited = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog: {
        async listSkills() {
          return { ok: false, code: 'rate-limited', message: 'slow down' }
        },
      },
      source: 'owner/repo',
      skillPath: 'skills/x/SKILL.md',
      runNpx: async () => ({ ok: true }),
    })
    assert.deepEqual(
      { code: rateLimited.code, message: rateLimited.message },
      { code: 'rate-limited', message: 'slow down' },
    )

    const noCatalog = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      source: 'owner/repo',
      skillPath: 'skills/x/SKILL.md',
      runNpx: async () => ({ ok: true }),
    })
    assert.equal(noCatalog.code, 'no-catalog')

    await fs.mkdir(path.dirname(repoStoreFile(homes)), { recursive: true })
    await fs.writeFile(repoStoreFile(homes), '{ not json')
    const corrupt = await installSavedSkill({
      homes,
      canonicalAgentsHome: homes.agentsHome,
      catalog: {
        async listSkills() {
          return { ok: true, skills: [] }
        },
      },
      source: 'owner/repo',
      skillPath: 'skills/x/SKILL.md',
      runNpx: async () => ({ ok: true }),
    })
    assert.equal(corrupt.code, 'store-unreadable')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

/** 假的项目级安装：在传入的工作目录里写 `.agents/skills`。 */
function projectInstaller(calls) {
  return async (args, cwd) => {
    calls.push({ args, cwd })
    const name = args[args.indexOf('--skill') + 1]
    await writeSkill(path.join(cwd, '.agents', 'skills', skillDirName(name)), name)
    return { ok: true, output: 'installed' }
  }
}

test('项目级安装：打工人写 .agents 与 .claude 的 agent，工作区只写 .agents', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-project-'))
  try {
    const workerDir = path.join(root, 'worker')
    const workspaceDir = path.join(root, 'workspace')
    await fs.mkdir(workerDir, { recursive: true })
    await fs.mkdir(workspaceDir, { recursive: true })
    const calls = []

    const worker = await installProjectSkill({
      targetDir: workerDir,
      target: 'worker',
      source: 'Vercel-Labs/agent-skills',
      name: 'Web Design Guidelines',
      runNpx: projectInstaller(calls),
    })
    assert.deepEqual(
      { ok: worker.ok, id: worker.id, target: worker.target },
      { ok: true, id: 'web-design-guidelines', target: 'worker' },
    )
    assert.equal(worker.path, path.join(workerDir, '.agents', 'skills', 'web-design-guidelines'))

    const workspace = await installProjectSkill({
      targetDir: workspaceDir,
      target: 'workspace',
      source: 'Vercel-Labs/agent-skills',
      name: 'Web Design Guidelines',
      runNpx: projectInstaller(calls),
    })
    assert.equal(workspace.ok, true)
    assert.equal(workspace.target, 'workspace')
    assert.equal(
      workspace.path,
      path.join(workspaceDir, '.agents', 'skills', 'web-design-guidelines'),
    )

    assert.deepEqual(
      calls.map((call) => call.args),
      [
        [
          'add',
          'Vercel-Labs/agent-skills',
          '--skill',
          'Web Design Guidelines',
          '-a',
          'universal',
          '-a',
          'claude-code',
          '-y',
        ],
        [
          'add',
          'Vercel-Labs/agent-skills',
          '--skill',
          'Web Design Guidelines',
          '-a',
          'universal',
          '-y',
        ],
      ],
    )
    assert.deepEqual(
      calls.map((call) => call.cwd),
      [workerDir, workspaceDir],
      '每次都要在目标目录里执行 npx，不能沿用全局的 agentsHome',
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('项目级安装：目标目录缺失与非法名字都在调用 npx 之前拒绝', async () => {
  let called = false
  const runNpx = async () => {
    called = true
    return { ok: true }
  }

  const noTarget = await installProjectSkill({
    target: 'workspace',
    source: 'owner/repo',
    name: 'x',
    runNpx,
  })
  assert.equal(noTarget.code, 'no-target')

  const missing = await installProjectSkill({
    targetDir: path.join(tmpdir(), 'buka-skills-does-not-exist'),
    target: 'workspace',
    source: 'owner/repo',
    name: 'x',
    runNpx,
  })
  assert.equal(missing.code, 'missing-target')

  const badName = await installProjectSkill({
    targetDir: tmpdir(),
    target: 'workspace',
    source: 'owner/repo',
    name: '-g',
    runNpx,
  })
  assert.equal(badName.code, 'invalid-skill-name')
  assert.equal(called, false, '校验失败不该调用 npx')
})

test('项目级安装：CLI 不认识指定 agent 时退回默认命令', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-project-agent-'))
  try {
    const targetDir = path.join(root, 'worker')
    await fs.mkdir(targetDir, { recursive: true })
    const calls = []
    const runNpx = async (args, cwd) => {
      calls.push({ args, cwd })
      if (calls.length === 1) {
        return { ok: false, message: 'Invalid agents: universal, claude-code' }
      }
      const name = args[args.indexOf('--skill') + 1]
      await writeSkill(path.join(cwd, '.agents', 'skills', skillDirName(name)), name)
      return { ok: true, output: 'installed' }
    }

    const result = await installProjectSkill({
      targetDir,
      target: 'worker',
      source: 'owner/repo',
      name: 'Convex Best Practices',
      runNpx,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(calls[1].args, ['add', 'owner/repo', '--skill', 'Convex Best Practices', '-y'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('页面入口：安装到打工人 / 工作区由 Host 解析目录，失败码原样带回', async () => {
  const { root, homes } = await makeHomes()
  try {
    await addSavedRepo({ homes, source: 'owner/repo' })
    const targetDir = path.join(root, 'worker')
    await fs.mkdir(targetDir, { recursive: true })
    const catalog = {
      async listSkills() {
        return {
          ok: true,
          skills: [{ name: 'Frontend Design', description: 'design', path: 'skills/fe/SKILL.md' }],
        }
      },
    }
    const calls = []
    const resolved = []
    const resolveTarget = async (request) => {
      resolved.push(request)
      return { ok: true, path: targetDir, label: 'bot' }
    }

    const result = await installSavedSkill({
      homes,
      catalog,
      source: 'owner/repo',
      skillPath: 'skills/fe/SKILL.md',
      target: 'worker',
      worker: 'bot',
      resolveTarget,
      runNpx: projectInstaller(calls),
    })
    assert.deepEqual(
      { ok: result.ok, id: result.id, target: result.target, repo: result.repo },
      { ok: true, id: 'frontend-design', target: 'worker', repo: 'owner/repo' },
    )
    assert.deepEqual(resolved, [{ target: 'worker', worker: 'bot', workspace: undefined }])
    assert.equal(calls[0].cwd, targetDir)

    const denied = await installSavedSkill({
      homes,
      catalog,
      source: 'owner/repo',
      skillPath: 'skills/fe/SKILL.md',
      target: 'workspace',
      workspace: '/gone',
      resolveTarget: async () => ({
        ok: false,
        code: 'unknown-workspace',
        message: '没有找到这个工作区',
      }),
      runNpx: async () => ({ ok: true }),
    })
    assert.deepEqual(
      { code: denied.code, message: denied.message },
      { code: 'unknown-workspace', message: '没有找到这个工作区' },
    )

    const invalid = await installSavedSkill({
      homes,
      catalog,
      source: 'owner/repo',
      skillPath: 'skills/fe/SKILL.md',
      target: 'elsewhere',
      runNpx: async () => ({ ok: true }),
    })
    assert.equal(invalid.code, 'invalid-target')

    const noResolver = await installSavedSkill({
      homes,
      catalog,
      source: 'owner/repo',
      skillPath: 'skills/fe/SKILL.md',
      target: 'worker',
      worker: 'bot',
      runNpx: async () => ({ ok: true }),
    })
    assert.equal(noResolver.code, 'no-target-resolver')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
