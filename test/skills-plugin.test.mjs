/**
 * 全局 skills 扫描与卸载决策的单测。
 *
 * 覆盖三件容易回归的事：
 * - npx 管理判定必须同时看「位于 ~/.agents/skills」与「出现在 lockfile 里」；
 * - 手工安装的 skill 直接删目录，不调用 npx；
 * - npx 管理但工具退出码为 0 时，仍要确认目标真的消失。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanOutput, createNpxRunner } from '../packages/plugin-kit/src/npx.ts'
import {
  addSavedRepo,
  listSavedRepos,
  normalizeRepoSource,
  removeSavedRepo,
  repoStoreFile,
} from '../plugins/skills/src/repo-store.ts'
import {
  collectGlobalSkills,
  globalRoots,
  isSafeSkillId,
  parseFrontmatterDescription,
  readNpxLock,
  resolveHomes,
  scanRoot,
  uninstallGlobalSkill,
} from '../plugins/skills/src/skill-store.ts'

/** 在 `<dir>/SKILL.md` 写一个最小可发现的 skill。 */
async function writeSkill(dir, name, description) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
}

/** 把 lockfile 写回磁盘。 */
async function writeLock(homes, skills) {
  await fs.mkdir(homes.agentsHome, { recursive: true })
  await fs.writeFile(
    path.join(homes.agentsHome, '.skill-lock.json'),
    JSON.stringify({ version: 3, skills }),
  )
}

test('全局 skills 扫描与 npx 判定', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    const dshSkills = path.join(homes.dshHome, 'skills')

    await writeSkill(path.join(agentsSkills, 'npx-skill'), 'npx-skill', 'managed by npx')
    await writeSkill(path.join(agentsSkills, 'manual-skill'), 'manual-skill', 'installed by hand')
    await fs.writeFile(
      path.join(agentsSkills, 'flat-skill.md'),
      '---\nname: flat-skill\ndescription: flat\n---\n',
    )
    // 同名但落在 ~/.dsh/skills：即便 lockfile 里有同名记录，也不算 npx 管理。
    await writeSkill(path.join(dshSkills, 'npx-skill'), 'npx-skill', 'same name under dsh')
    await writeSkill(path.join(dshSkills, 'dsh-skill'), 'dsh-skill', 'dsh only')
    await writeLock(homes, {
      'npx-skill': {
        source: 'buka-ltd/skills',
        sourceUrl: 'https://github.com/buka-ltd/skills.git',
        installedAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-02-03T04:05:06.000Z',
      },
    })

    assert.deepEqual(globalRoots(homes), [
      { scope: 'dsh', skillsDir: dshSkills },
      { scope: 'agents', skillsDir: agentsSkills },
    ])

    const scanned = await scanRoot({ scope: 'agents', skillsDir: agentsSkills })
    assert.deepEqual(scanned.map((one) => one.id).sort(), [
      'flat-skill',
      'manual-skill',
      'npx-skill',
    ])
    assert.equal(scanned.find((one) => one.id === 'flat-skill').kind, 'file')

    const snapshot = await collectGlobalSkills({
      homes,
      env: {},
      summaries: [
        {
          name: 'npx-skill',
          description: 'summary description',
          path: path.join(agentsSkills, 'npx-skill', 'SKILL.md'),
        },
        {
          name: 'flat-skill',
          description: 'flat summary',
          path: path.join(agentsSkills, 'flat-skill.md'),
        },
      ],
    })
    const byKey = new Map(snapshot.skills.map((one) => [`${one.scope}:${one.id}`, one]))

    assert.equal(snapshot.skills.length, 5)
    assert.equal(byKey.get('agents:npx-skill').managedByNpx, true)
    assert.equal(byKey.get('agents:npx-skill').description, 'summary description')
    assert.equal(byKey.get('agents:npx-skill').npxSource, 'buka-ltd/skills')
    assert.equal(byKey.get('agents:npx-skill').npxUpdatedAt, '2026-02-03T04:05:06.000Z')
    assert.equal(byKey.get('dsh:npx-skill').managedByNpx, false)
    assert.equal(byKey.get('agents:manual-skill').managedByNpx, false)
    assert.equal(byKey.get('agents:flat-skill').managedByNpx, false)
    assert.equal(byKey.get('agents:flat-skill').description, 'flat summary')
    assert.equal(byKey.get('dsh:dsh-skill').managedByNpx, false)
    assert.equal(snapshot.lock.exists, true)
    assert.equal(snapshot.lock.version, 3)
    assert.deepEqual(
      snapshot.skills.map((one) => one.name),
      [...snapshot.skills.map((one) => one.name)].sort(),
    )

    for (const good of ['ok-name_1.2', 'a']) assert.equal(isSafeSkillId(good), true)
    for (const bad of ['../x', 'a/b', '.hidden', '', 'x y'])
      assert.equal(isSafeSkillId(bad), false, String(bad))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('卸载：手工安装直接删目录，不调用 npx', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    await writeSkill(path.join(agentsSkills, 'manual-skill'), 'manual-skill', 'installed by hand')

    let npxCalls = 0
    const result = await uninstallGlobalSkill({
      homes,
      env: {},
      scope: 'agents',
      id: 'manual-skill',
      runNpx: async () => {
        npxCalls += 1
        return { ok: true }
      },
    })

    assert.deepEqual({ ok: result.ok, method: result.method }, { ok: true, method: 'local' })
    assert.equal(npxCalls, 0)
    await assert.rejects(fs.access(path.join(agentsSkills, 'manual-skill')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('卸载：npx 管理的 skill 交给 npx，并确认目标消失', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    const lockPath = path.join(homes.agentsHome, '.skill-lock.json')
    await writeSkill(path.join(agentsSkills, 'npx-skill'), 'npx-skill', 'managed by npx')
    await writeLock(homes, { 'npx-skill': { source: 'buka-ltd/skills' } })

    const calls = []
    const result = await uninstallGlobalSkill({
      homes,
      env: {},
      scope: 'agents',
      id: 'npx-skill',
      runNpx: async (args) => {
        calls.push(args)
        await fs.rm(path.join(agentsSkills, 'npx-skill'), { recursive: true, force: true })
        const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'))
        delete lock.skills['npx-skill']
        await fs.writeFile(lockPath, JSON.stringify(lock, null, 2))
        return { ok: true, output: 'removed' }
      },
    })

    assert.deepEqual({ ok: result.ok, method: result.method }, { ok: true, method: 'npx' })
    assert.deepEqual(calls, [['remove', 'npx-skill', '--global', '--yes']])
    assert.equal((await readNpxLock(lockPath)).skills['npx-skill'], undefined)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('卸载：npx 退出码为 0 但目录仍在时按失败上报', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    await writeSkill(path.join(agentsSkills, 'stuck-skill'), 'stuck-skill', 'stuck')
    await writeLock(homes, { 'stuck-skill': { source: 'x/y' } })

    const stuck = await uninstallGlobalSkill({
      homes,
      env: {},
      scope: 'agents',
      id: 'stuck-skill',
      runNpx: async () => ({ ok: true }),
    })
    assert.equal(stuck.ok, false)
    assert.equal(stuck.code, 'npx-incomplete')

    const failed = await uninstallGlobalSkill({
      homes,
      env: {},
      scope: 'agents',
      id: 'stuck-skill',
      runNpx: async () => ({ ok: false, message: 'exit 1', output: 'network down' }),
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.code, 'npx-failed')
    assert.equal(failed.output, 'network down')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('卸载：~/.dsh 下的 skill 永远本地删除；非法输入被拒绝', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const dshSkills = path.join(homes.dshHome, 'skills')
    await writeSkill(path.join(dshSkills, 'dsh-skill'), 'dsh-skill', 'dsh only')

    let npxCalls = 0
    const notCalled = async () => {
      npxCalls += 1
      return { ok: true }
    }
    const result = await uninstallGlobalSkill({
      homes,
      scope: 'dsh',
      id: 'dsh-skill',
      runNpx: notCalled,
      env: {},
    })
    assert.deepEqual({ ok: result.ok, method: result.method }, { ok: true, method: 'local' })
    assert.equal(npxCalls, 0)

    assert.equal(
      (
        await uninstallGlobalSkill({
          homes,
          scope: 'agents',
          id: 'missing',
          runNpx: notCalled,
          env: {},
        })
      ).code,
      'not-found',
    )
    assert.equal(
      (await uninstallGlobalSkill({ homes, scope: 'nope', id: 'x', runNpx: notCalled, env: {} }))
        .code,
      'invalid-scope',
    )
    assert.equal(
      (
        await uninstallGlobalSkill({
          homes,
          scope: 'agents',
          id: '../etc',
          runNpx: notCalled,
          env: {},
        })
      ).code,
      'invalid-id',
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('lockfile 不存在时不算 npx 管理；环境变量可覆盖根目录', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    await writeSkill(path.join(homes.agentsHome, 'skills', 'one'), 'one', 'one')

    const lock = await readNpxLock(path.join(homes.agentsHome, '.skill-lock.json'))
    assert.deepEqual({ exists: lock.exists, skills: lock.skills }, { exists: false, skills: {} })

    const snapshot = await collectGlobalSkills({ homes, env: {} })
    assert.equal(snapshot.lock.exists, false)
    assert.equal(
      snapshot.skills.some((one) => one.managedByNpx),
      false,
    )

    assert.deepEqual(resolveHomes({ DSH_HOME: '/tmp/d', DSH_AGENTS_HOME: '/tmp/a' }), {
      agentsHome: '/tmp/a',
      dshHome: '/tmp/d',
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

/** 在临时目录写一个可执行的假 npx；脚本内容由调用方给出。 */
async function writeFakeNpx(binDir, body) {
  await fs.mkdir(binDir, { recursive: true })
  const file = path.join(binDir, 'npx')
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`)
  await fs.chmod(file, 0o755)
  return file
}

test('npx runner：参数顺序、退出码与输出', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-npx-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents') }
    await fs.mkdir(homes.agentsHome, { recursive: true })

    const argsFile = path.join(root, 'args.txt')
    await writeFakeNpx(path.join(root, 'bin-ok'), 'printf \'%s\\n\' "$@" > "$ARGS_FILE"')
    const ok = await createNpxRunner({
      cwd: homes.agentsHome,
      env: { ...process.env, PATH: path.join(root, 'bin-ok'), ARGS_FILE: argsFile },
    })(['remove', 'demo', '--global', '--yes'])
    assert.equal(ok.ok, true)
    assert.deepEqual((await fs.readFile(argsFile, 'utf8')).trim().split('\n'), [
      '--yes',
      'skills',
      'remove',
      'demo',
      '--global',
      '--yes',
    ])

    await writeFakeNpx(path.join(root, 'bin-fail'), 'echo "fake failure" >&2\nexit 2')
    const failed = await createNpxRunner({
      cwd: homes.agentsHome,
      env: { ...process.env, PATH: path.join(root, 'bin-fail') },
    })(['remove', 'demo', '--global', '--yes'])
    assert.equal(failed.ok, false)
    assert.match(failed.message, /退出码 2/u)
    assert.match(failed.output, /fake failure/u)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('cleanOutput 去掉 ANSI 颜色、光标控制与回车', () => {
  assert.equal(cleanOutput('\u001b[32mDone\u001b[0m\r\nline 2\r\n'), 'Done\nline 2')
  assert.equal(cleanOutput('\u001b[?25l│\n◇ ok\u001b[?25h'), '│\n◇ ok')
})

test('lockfile 位置跟随 XDG_STATE_HOME', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const stateHome = path.join(root, 'state')
    await writeSkill(path.join(homes.agentsHome, 'skills', 'xdg-skill'), 'xdg-skill', 'xdg')
    await fs.mkdir(path.join(stateHome, 'skills'), { recursive: true })
    await fs.writeFile(
      path.join(stateHome, 'skills', '.skill-lock.json'),
      JSON.stringify({ version: 3, skills: { 'xdg-skill': { source: 'buka-ltd/skills' } } }),
    )

    const snapshot = await collectGlobalSkills({ homes, env: { XDG_STATE_HOME: stateHome } })
    assert.equal(snapshot.lock.path, path.join(stateHome, 'skills', '.skill-lock.json'))
    assert.equal(snapshot.lock.exists, true)
    assert.equal(snapshot.skills.find((one) => one.id === 'xdg-skill').managedByNpx, true)

    // 没有 XDG_STATE_HOME 时回到 ~/.agents/.skill-lock.json（这里不存在）。
    const fallback = await collectGlobalSkills({ homes, env: {} })
    assert.equal(fallback.lock.path, path.join(homes.agentsHome, '.skill-lock.json'))
    assert.equal(fallback.lock.exists, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('lockfile 损坏或版本过旧时不下结论，agents 下的卸载被拒绝', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    const lockPath = path.join(homes.agentsHome, '.skill-lock.json')
    await writeSkill(path.join(agentsSkills, 'broken'), 'broken', 'broken')
    await writeSkill(path.join(homes.dshHome, 'skills', 'dsh-skill'), 'dsh-skill', 'dsh only')
    await fs.mkdir(homes.agentsHome, { recursive: true })

    let npxCalls = 0
    const notCalled = async () => {
      npxCalls += 1
      return { ok: true }
    }

    await fs.writeFile(lockPath, '{ this is not json')
    const corrupt = await collectGlobalSkills({ homes, env: {} })
    assert.equal(corrupt.lock.exists, true)
    assert.equal(corrupt.lock.corrupt, true)
    assert.equal(corrupt.skills.find((one) => one.id === 'broken').managedByNpx, false)

    const refused = await uninstallGlobalSkill({
      homes,
      scope: 'agents',
      id: 'broken',
      runNpx: notCalled,
      env: {},
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.code, 'lock-unreadable')
    assert.equal(npxCalls, 0)
    // 目录没有被删：宁可不卸载，也不留下 lock 记录与悬空链接。
    await fs.access(path.join(agentsSkills, 'broken'))

    await fs.writeFile(
      lockPath,
      JSON.stringify({ version: 2, skills: { broken: { source: 'a/b' } } }),
    )
    assert.equal((await collectGlobalSkills({ homes, env: {} })).lock.corrupt, true)

    // ~/.dsh 下的 skill 不依赖 npx lockfile，仍然可以本地删除。
    const dshResult = await uninstallGlobalSkill({
      homes,
      scope: 'dsh',
      id: 'dsh-skill',
      runNpx: notCalled,
      env: {},
    })
    assert.deepEqual({ ok: dshResult.ok, method: dshResult.method }, { ok: true, method: 'local' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('lock 键与目录名不同时用 skillPath 目录段判定 npx 管理', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    await writeSkill(path.join(agentsSkills, 'folder-name'), 'folder-name', 'folder name')
    await writeLock(homes, {
      'display-name': { source: 'buka-ltd/skills', skillPath: 'skills/folder-name/SKILL.md' },
    })

    const snapshot = await collectGlobalSkills({ homes, env: {} })
    assert.equal(snapshot.skills.find((one) => one.id === 'folder-name').managedByNpx, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('同一名字的目录与平铺文件只保留目录', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const skillsDir = path.join(root, 'agents', 'skills')
    await writeSkill(path.join(skillsDir, 'dup'), 'dup', 'directory form')
    await fs.writeFile(
      path.join(skillsDir, 'dup.md'),
      '---\nname: dup\ndescription: flat form\n---\n',
    )

    const scanned = await scanRoot({ scope: 'agents', skillsDir })
    const matches = scanned.filter((one) => one.id === 'dup')
    assert.equal(matches.length, 1)
    assert.equal(matches[0].kind, 'directory')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('npx runner：超时后及时返回失败并杀掉子进程', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-npx-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents') }
    await fs.mkdir(homes.agentsHome, { recursive: true })
    const binDir = path.join(root, 'bin')
    await writeFakeNpx(binDir, 'sleep 30')

    const started = Date.now()
    const result = await createNpxRunner({
      cwd: homes.agentsHome,
      env: { ...process.env, PATH: binDir },
      timeoutMs: 500,
    })(['remove', 'demo', '--global', '--yes'])

    assert.equal(result.ok, false)
    assert.match(result.message, /超时/u)
    assert.ok(
      Date.now() - started < 15_000,
      'timeout should settle promptly instead of waiting for the child',
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

// ---- 收藏的 npx skills 仓库 -------------------------------------------------

test('收藏来源规范化：GitHub 链接收敛成 owner/repo，非法输入被拒绝', () => {
  const cases = new Map([
    ['vercel-labs/agent-skills', 'vercel-labs/agent-skills'],
    ['github.com/vercel-labs/agent-skills', 'vercel-labs/agent-skills'],
    ['https://github.com/vercel-labs/agent-skills', 'vercel-labs/agent-skills'],
    ['https://github.com/vercel-labs/agent-skills.git', 'vercel-labs/agent-skills'],
    ['https://github.com/vercel-labs/agent-skills/', 'vercel-labs/agent-skills'],
    ['  https://www.github.com/vercel-labs/agent-skills  ', 'vercel-labs/agent-skills'],
    ['notion', 'notion'],
    ['@scope/pkg', '@scope/pkg'],
    ['https://notion.so/some-skill-page', 'https://notion.so/some-skill-page'],
    [
      'https://github.com/vercel-labs/agent-skills/tree/main/skills/react',
      'https://github.com/vercel-labs/agent-skills/tree/main/skills/react',
    ],
  ])
  for (const [input, expected] of cases) assert.equal(normalizeRepoSource(input), expected, input)
  for (const bad of [
    '',
    '   ',
    '-g',
    '--global',
    'a b',
    'owner/repo/extra',
    '../etc',
    'https://',
    'ftp://x/y',
    'a\nb',
  ]) {
    assert.equal(normalizeRepoSource(bad), null, JSON.stringify(bad))
  }
  assert.equal(normalizeRepoSource(`a/${'b'.repeat(301)}`), null)
  assert.equal(normalizeRepoSource(42), null)
})

test('收藏仓库：添加、去重、持久化与移除', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-repos-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const file = repoStoreFile(homes)
    assert.equal(file, path.join(homes.dshHome, 'buka-skills', 'repos.json'))

    const empty = await listSavedRepos({ homes })
    assert.deepEqual(
      { exists: empty.exists, corrupt: empty.corrupt, repos: empty.repos },
      { exists: false, corrupt: false, repos: [] },
    )

    const first = await addSavedRepo({
      homes,
      source: 'https://github.com/Vercel-Labs/agent-skills.git',
      note: ' 前端常用 ',
    })
    assert.equal(first.ok, true)
    assert.equal(first.repo.source, 'Vercel-Labs/agent-skills')
    assert.equal(first.repo.id, 'vercel-labs/agent-skills')
    assert.equal(first.repo.note, '前端常用')
    assert.ok(!Number.isNaN(Date.parse(first.repo.addedAt)))

    const duplicate = await addSavedRepo({ homes, source: 'vercel-labs/agent-skills' })
    assert.deepEqual({ ok: duplicate.ok, code: duplicate.code }, { ok: false, code: 'duplicate' })

    await addSavedRepo({ homes, source: 'notion' })
    const listed = await listSavedRepos({ homes })
    assert.equal(listed.exists, true)
    assert.equal(listed.corrupt, false)
    // 新收藏在前。
    assert.deepEqual(
      listed.repos.map((one) => one.source),
      ['notion', 'Vercel-Labs/agent-skills'],
    )

    // 原子写入不留下临时文件。
    assert.deepEqual(await fs.readdir(path.dirname(file)), ['repos.json'])

    const removed = await removeSavedRepo({ homes, id: 'VERCEL-LABS/AGENT-SKILLS' })
    assert.equal(removed.ok, true)
    assert.deepEqual(
      removed.repos.map((one) => one.source),
      ['notion'],
    )
    assert.equal((await listSavedRepos({ homes })).repos.length, 1)
    assert.equal((await removeSavedRepo({ homes, id: 'missing/repo' })).code, 'not-found')
    assert.equal((await addSavedRepo({ homes, source: 'a b' })).code, 'invalid-source')
    assert.equal(
      (await addSavedRepo({ homes, source: 'a/b', note: 'x'.repeat(201) })).code,
      'invalid-note',
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('收藏文件损坏或版本未知时拒绝写入，不覆盖原文件', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-repos-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const file = repoStoreFile(homes)
    await fs.mkdir(path.dirname(file), { recursive: true })

    await fs.writeFile(file, '{ this is not json')
    const corrupt = await listSavedRepos({ homes })
    assert.deepEqual(
      { exists: corrupt.exists, corrupt: corrupt.corrupt, repos: corrupt.repos },
      {
        exists: true,
        corrupt: true,
        repos: [],
      },
    )
    assert.equal((await addSavedRepo({ homes, source: 'a/b' })).code, 'store-unreadable')
    assert.equal((await removeSavedRepo({ homes, id: 'a/b' })).code, 'store-unreadable')
    assert.equal(await fs.readFile(file, 'utf8'), '{ this is not json')

    await fs.writeFile(file, JSON.stringify({ version: 99, repos: [] }))
    assert.equal((await listSavedRepos({ homes })).corrupt, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('SKILL.md frontmatter 的 description 解析', () => {
  assert.equal(
    parseFrontmatterDescription('---\nname: demo\ndescription: inline text\n---\n\n# Demo\n'),
    'inline text',
  )
  assert.equal(
    parseFrontmatterDescription('---\r\nname: demo\r\ndescription: crlf text\r\n---\r\n'),
    'crlf text',
  )
  assert.equal(parseFrontmatterDescription('---\ndescription: "quoted text"\n---\n'), 'quoted text')
  assert.equal(
    parseFrontmatterDescription("---\ndescription: 'single quoted'\n---\n"),
    'single quoted',
  )
  assert.equal(
    parseFrontmatterDescription('---\ndescription: >\n  folded line one\n  folded line two\n---\n'),
    'folded line one folded line two',
  )
  assert.equal(
    parseFrontmatterDescription('---\ndescription: |\n  literal one\n  literal two\n---\n'),
    'literal one\nliteral two',
  )
  assert.equal(parseFrontmatterDescription('---\nname: demo\n---\n'), '')
  assert.equal(parseFrontmatterDescription('no frontmatter at all'), '')
  assert.equal(parseFrontmatterDescription(''), '')
  assert.equal(parseFrontmatterDescription(undefined), '')
})

test('注册表没有摘要时，描述回退读取 SKILL.md', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-store-'))
  try {
    const homes = { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
    const agentsSkills = path.join(homes.agentsHome, 'skills')
    await writeSkill(
      path.join(agentsSkills, 'from-disk'),
      'from-disk',
      'description from the file itself',
    )

    const snapshot = await collectGlobalSkills({ homes, summaries: [], env: {} })
    const entry = snapshot.skills.find((one) => one.id === 'from-disk')
    assert.equal(entry.description, 'description from the file itself')

    // 摘要里有描述时优先用注册表解析的结果。
    const withSummary = await collectGlobalSkills({
      homes,
      env: {},
      summaries: [
        {
          name: 'from-disk',
          description: 'description from registry',
          path: path.join(agentsSkills, 'from-disk', 'SKILL.md'),
        },
      ],
    })
    assert.equal(
      withSummary.skills.find((one) => one.id === 'from-disk').description,
      'description from registry',
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
