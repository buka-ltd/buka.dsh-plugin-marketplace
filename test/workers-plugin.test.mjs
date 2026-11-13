/**
 * @buka/dsh-plugin-workers Host 一半的单测。
 *
 * 全部用 `fs.mkdtemp(tmpdir())` 的临时目录，不联网、不读真实 home、不启动
 * webServer。覆盖：名称/路径校验、登记表（缺失、原子写 0600、损坏拒绝写入、
 * 坏条目过滤）、addWorker / removeWorker、listWorkers 的挂载 join 与容错、
 * 项目级 skills 扫描、AGENTS.md 上限、npx 输出清理。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanOutput, parseSkillList } from '../packages/plugin-kit/src/npx.ts'
import {
  AVATARS,
  DEFAULT_AVATAR_ID as UI_DEFAULT_AVATAR_ID,
} from '../packages/plugin-ui/src/avatars.ts'
import {
  AVATAR_IDS,
  DEFAULT_AVATAR_ID,
  defaultAvatarFor,
  isAvatarId,
  pickDefaultAvatar,
  resolveAvatar,
} from '../plugins/workers/src/avatar.ts'
import { buildWorkerModelCatalog } from '../plugins/workers/src/model-catalog.ts'
import { PRESET_WORKERS, seedPresetWorkers } from '../plugins/workers/src/presets.ts'
import { revealCommand, revealDirectory } from '../plugins/workers/src/reveal.ts'
import {
  AGENTS_MAX_READ_BYTES,
  addWorker,
  BUILTIN_WORKERS,
  CLAUDE_FILE,
  CLOCK_WORKER_NAME,
  defaultWorkersRoot,
  emptyAgentsFile,
  ensureBuiltinWorkers,
  ensureClaudeLink,
  isValidWorkerDescription,
  isValidWorkerName,
  legacyPluginCacheDir,
  listWorkers,
  migrateWorkerStore,
  normalizeWorkerDescription,
  parseFrontmatter,
  pluginCacheDir,
  readAgentsFile,
  readClaudeLink,
  readWorkerRegistry,
  removeWorker,
  renameWorker,
  resolveWorkerRegistryFile,
  resolveWorkersDir,
  scanProjectSkills,
  setWorkerAssistant,
  setWorkerAvatar,
  setWorkerDescription,
  setWorkerModel,
  WORKER_DESCRIPTION_MAX_LENGTH,
  workerDirectory,
  writeAgentsFile,
  writeWorkerRegistry,
} from '../plugins/workers/src/worker-store.ts'

/**
 * 建一个临时根目录。
 *
 * @returns {Promise<string>}
 */
async function makeRoot() {
  return await fs.mkdtemp(path.join(tmpdir(), 'buka-workers-'))
}

/**
 * 写一个文件，自动建父目录。
 *
 * @param {string} file
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

/**
 * 在 `<dir>/SKILL.md` 写一个 skill。
 *
 * @param {string} dir
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeSkill(dir, content) {
  await writeFile(path.join(dir, 'SKILL.md'), content)
}

/**
 * `fs.realpath`，不存在时回退原值。
 *
 * @param {string} target
 * @returns {Promise<string>}
 */
async function realpathOr(target) {
  try {
    return await fs.realpath(target)
  } catch {
    return target
  }
}

/**
 * 删掉临时根目录。
 *
 * @param {string} root
 * @returns {Promise<void>}
 */
async function removeRoot(root) {
  await fs.rm(root, { recursive: true, force: true })
}

test('打工人名称校验与目录拼接', () => {
  for (const good of ['writer', 'a', 'A1', '写作-bot', 'bot_1.2', 'x'.repeat(64)]) {
    assert.equal(isValidWorkerName(good), true, good)
  }
  for (const bad of [
    '',
    '   ',
    '.',
    '..',
    '.hidden',
    'a/b',
    'a\\b',
    'a b',
    'a\u0000b',
    'x'.repeat(65),
  ]) {
    assert.equal(isValidWorkerName(bad), false, JSON.stringify(bad))
  }
  assert.equal(isValidWorkerName(null), false)
  // 首尾空白会先 trim，再校验。
  assert.equal(isValidWorkerName('  writer  '), true)

  const root = path.resolve(path.join(tmpdir(), 'workers-root'))
  assert.equal(workerDirectory(root, 'writer'), path.join(root, 'writer'))
  assert.equal(workerDirectory(root, '  writer  '), path.join(root, 'writer'))
  assert.equal(workerDirectory(root, '.'), null)
  assert.equal(workerDirectory(root, '..'), null)
  assert.equal(workerDirectory(root, '../escape'), null)
  assert.equal(workerDirectory(root, 'a/b'), null)
  assert.equal(workerDirectory('', 'writer'), null)
})

test('插件全局目录、打工人根目录与登记文件路径', async () => {
  const root = await makeRoot()
  try {
    const cache = path.join(root, 'cache')
    const home = path.join(root, 'home')

    assert.equal(pluginCacheDir({ XDG_CACHE_HOME: cache }), path.join(cache, 'dsh-plugin-workers'))
    assert.equal(
      defaultWorkersRoot({ XDG_CACHE_HOME: cache }),
      path.join(cache, 'dsh-plugin-workers', 'workers'),
    )
    // 注入的 env 完全决定默认值，不读真实 home。
    assert.equal(
      resolveWorkersDir(undefined, { XDG_CACHE_HOME: cache }),
      path.join(cache, 'dsh-plugin-workers', 'workers'),
    )
    assert.equal(
      resolveWorkersDir('   ', { XDG_CACHE_HOME: cache }),
      path.join(cache, 'dsh-plugin-workers', 'workers'),
    )
    // 没有 XDG_CACHE_HOME 时回退 <HOME>/.cache。
    assert.equal(
      resolveWorkersDir(undefined, { HOME: home }),
      path.join(home, '.cache', 'dsh-plugin-workers', 'workers'),
    )
    assert.equal(resolveWorkersDir('~/workers', { HOME: home }), path.join(home, 'workers'))
    assert.equal(
      resolveWorkersDir('relative/dir', { XDG_CACHE_HOME: cache }),
      path.resolve('relative/dir'),
    )

    const pluginDir = path.join(cache, 'dsh-plugin-workers')
    assert.equal(
      resolveWorkerRegistryFile(path.join(pluginDir, 'workers')),
      path.join(pluginDir, 'workers.json'),
    )
    assert.equal(
      resolveWorkerRegistryFile(path.join(root, 'custom')),
      path.join(root, 'workers.json'),
    )
  } finally {
    await removeRoot(root)
  }
})

test('frontmatter 极简解析', () => {
  assert.deepEqual(parseFrontmatter('---\nname: foo\ndescription: "does foo"\n---\n'), {
    name: 'foo',
    description: 'does foo',
  })
  assert.deepEqual(parseFrontmatter("---\nname: 'it''s'\ndescription: plain\n---"), {
    name: "it's",
    description: 'plain',
  })
  // 没有 frontmatter / 未闭合 / 没有认识的字段时都返回空对象，且不抛错。
  assert.deepEqual(parseFrontmatter('plain markdown'), {})
  assert.deepEqual(parseFrontmatter('---\nname: unclosed\n'), {})
  assert.deepEqual(parseFrontmatter('---\ntitle: other\n---'), {})
  assert.deepEqual(parseFrontmatter(null), {})
})

test('项目级 skills 扫描：目录、平铺、frontmatter 缺省与 lockfile 来源', async () => {
  const root = await makeRoot()
  try {
    const workspace = path.join(root, 'worker')
    await writeSkill(
      path.join(workspace, '.agents', 'skills', 'foo'),
      '---\nname: foo\ndescription: "does foo things"\n---\n\n# foo\n',
    )
    await writeSkill(path.join(workspace, '.dsh', 'skills', 'bar'), 'no frontmatter here\n')
    // Claude Code 的落点也算项目级 skill；同名时与 .agents 的条目去重。
    await writeSkill(
      path.join(workspace, '.claude', 'skills', 'baz'),
      '---\nname: baz\ndescription: claude code copy\n---\n',
    )
    await writeSkill(
      path.join(workspace, '.claude', 'skills', 'foo'),
      '---\nname: foo\ndescription: duplicate of .agents copy\n---\n',
    )
    await writeFile(
      path.join(workspace, '.agents', 'skills', 'flat.md'),
      "---\nname: 'flat-skill'\ndescription: flat description\n---\n",
    )
    await writeFile(
      path.join(workspace, 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          foo: { source: 'owner/repo' },
          bar: { sourceUrl: 'https://github.com/owner/bar' },
        },
      }),
    )
    // 悬挂符号链接：单个坏条目不参与扫描，也不让整次扫描抛错。
    await fs.symlink(
      path.join(workspace, 'missing-target'),
      path.join(workspace, '.agents', 'skills', 'dangling'),
    )

    const { skills } = await scanProjectSkills(workspace)
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ['bar', 'baz', 'flat-skill', 'foo'],
    )
    const byName = new Map(skills.map((skill) => [skill.name, skill]))
    assert.deepEqual(byName.get('foo'), {
      name: 'foo',
      description: 'does foo things',
      source: 'owner/repo',
    })
    assert.deepEqual(byName.get('bar'), {
      name: 'bar',
      description: '',
      source: 'https://github.com/owner/bar',
    })
    assert.deepEqual(byName.get('baz'), {
      name: 'baz',
      description: 'claude code copy',
      source: null,
    })
    assert.deepEqual(byName.get('flat-skill'), {
      name: 'flat-skill',
      description: 'flat description',
      source: null,
    })

    // lockfile 坏了也不能抛错：只是所有 source 都变成 null。
    await fs.writeFile(path.join(workspace, 'skills-lock.json'), '{not json')
    const again = await scanProjectSkills(workspace)
    assert.equal(again.skills.length, 4)
    assert.equal(again.skills.find((skill) => skill.name === 'foo').source, null)

    // 工作区不存在时返回空列表，不抛错。
    assert.deepEqual(await scanProjectSkills(path.join(root, 'missing')), { skills: [] })
    assert.deepEqual(await scanProjectSkills(undefined), { skills: [] })
  } finally {
    await removeRoot(root)
  }
})

test('AGENTS.md 读取、写入与 256 KiB 上限', async () => {
  const root = await makeRoot()
  try {
    const workspace = path.join(root, 'worker')
    await fs.mkdir(workspace, { recursive: true })

    assert.deepEqual(await readAgentsFile(workspace), {
      exists: false,
      bytes: 0,
      modifiedAt: null,
      content: '',
      tooLarge: false,
    })

    const text = '# AGENTS.md\n\n你好，打工人。\n'
    const saved = await writeAgentsFile(workspace, text)
    assert.equal(saved.bytes, Buffer.byteLength(text, 'utf8'))
    assert.ok(!Number.isNaN(Date.parse(saved.modifiedAt)))

    const read = await readAgentsFile(workspace)
    assert.equal(read.exists, true)
    assert.equal(read.content, text)
    assert.equal(read.bytes, saved.bytes)
    assert.equal(read.tooLarge, false)
    assert.ok(!Number.isNaN(Date.parse(read.modifiedAt)))

    // 正好 256 KiB 仍然返回全文；多一个字节只返回大小。
    const exact = 'y'.repeat(AGENTS_MAX_READ_BYTES)
    await writeFile(path.join(workspace, 'AGENTS.md'), exact)
    const exactRead = await readAgentsFile(workspace)
    assert.equal(exactRead.tooLarge, false)
    assert.equal(exactRead.bytes, AGENTS_MAX_READ_BYTES)
    assert.equal(exactRead.content.length, AGENTS_MAX_READ_BYTES)

    const tooLarge = 'z'.repeat(AGENTS_MAX_READ_BYTES + 1)
    await writeFile(path.join(workspace, 'AGENTS.md'), tooLarge)
    const tooLargeRead = await readAgentsFile(workspace)
    assert.equal(tooLargeRead.exists, true)
    assert.equal(tooLargeRead.tooLarge, true)
    assert.equal(tooLargeRead.content, '')
    assert.equal(tooLargeRead.bytes, AGENTS_MAX_READ_BYTES + 1)

    // AGENTS.md 是目录时当作不存在。
    const dirAsFile = path.join(root, 'other')
    await fs.mkdir(path.join(dirAsFile, 'AGENTS.md'), { recursive: true })
    assert.deepEqual(await readAgentsFile(dirAsFile), emptyAgentsFile())
  } finally {
    await removeRoot(root)
  }
})

test('打工人登记表：缺失按空表、原子写 0600', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    assert.deepEqual(await readWorkerRegistry({ file }), { version: 3, workers: [], file })

    const entries = [
      {
        name: 'writer',
        path: path.join(workersDir, 'writer'),
        createdAt: '2026-01-02T03:04:05.000Z',
      },
      {
        name: 'painter',
        path: path.join(workersDir, 'painter'),
        createdAt: '2026-02-03T04:05:06.000Z',
      },
    ]
    await writeWorkerRegistry({ file, workers: entries })
    // 写回时一定会落下具体头像：没有指定就按名字分配。
    const written = entries.map((entry) => ({
      ...entry,
      driver: 'agent',
      program: '',
      avatar: defaultAvatarFor(entry.name),
      description: '',
      assistant: false,
    }))
    assert.deepEqual(await readWorkerRegistry({ file }), { version: 3, workers: written, file })

    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    }

    // 覆盖写之后权限仍然收紧，且不残留临时文件。
    await writeWorkerRegistry({ file, workers: entries.slice(0, 1) })
    assert.deepEqual(await readWorkerRegistry({ file }), {
      version: 3,
      workers: written.slice(0, 1),
      file,
    })
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    }
    assert.deepEqual(await fs.readdir(pluginDir), ['workers.json'])
  } finally {
    await removeRoot(root)
  }
})

test('损坏的登记表：读返回 corrupt，写操作拒绝且不覆盖', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const cases = [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ version: 4, workers: [] }),
      JSON.stringify({ version: 1, workers: 'nope' }),
    ]
    for (const bad of cases) {
      await writeFile(file, bad)
      const registry = await readWorkerRegistry({ file })
      assert.equal(registry.corrupt, true, bad)
      assert.deepEqual(registry.workers, [], bad)
      await assert.rejects(
        () => addWorker({ workersDir, file, name: 'writer' }),
        (error) => error.code === 'registry-unreadable',
        bad,
      )
      await assert.rejects(
        () => removeWorker({ file, name: 'writer' }),
        (error) => error.code === 'registry-unreadable',
        bad,
      )
      // 原始内容没有被写操作覆盖。
      assert.equal(await fs.readFile(file, 'utf8'), bad)
    }

    // 坏条目被过滤，同名只保留第一个。
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        workers: [
          { name: 'ok', path: '/abs/ok', createdAt: '2026-01-01T00:00:00.000Z' },
          { name: 'bad/name', path: '/abs/bad', createdAt: '2026-01-01T00:00:00.000Z' },
          { name: '', path: '/abs/empty', createdAt: '2026-01-01T00:00:00.000Z' },
          { name: 'nopath', createdAt: '2026-01-01T00:00:00.000Z' },
          { name: 'ok', path: '/abs/dup', createdAt: '2026-01-01T00:00:00.000Z' },
          'nope',
          null,
        ],
      }),
    )
    const filtered = await readWorkerRegistry({ file })
    assert.equal(filtered.corrupt, undefined)
    assert.deepEqual(filtered.workers, [
      {
        name: 'ok',
        driver: 'agent',
        program: '',
        path: '/abs/ok',
        createdAt: '2026-01-01T00:00:00.000Z',
        avatar: '',
        description: '',
        assistant: false,
      },
    ])
  } finally {
    await removeRoot(root)
  }
})

test('addWorker / removeWorker：目录、模板、插到最前、同名复用、只删登记', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({ workersDir, file, name: 'writer' })
    assert.equal(writer.created, true)
    assert.equal(writer.worker.name, 'writer')
    assert.equal(writer.worker.path, await realpathOr(path.join(workersDir, 'writer')))
    assert.ok(!Number.isNaN(Date.parse(writer.worker.createdAt)))
    assert.equal((await fs.stat(writer.worker.path)).isDirectory(), true)

    const template = await fs.readFile(path.join(writer.worker.path, 'AGENTS.md'), 'utf8')
    assert.ok(template.startsWith('# AGENTS.md\n'))
    assert.ok(template.includes('这是「writer」打工人的协作说明'))
    assert.ok(template.includes(`- 路径：\`${writer.worker.path}\``))

    // 创建打工人时自动把 CLAUDE.md 做成指向 AGENTS.md 的软链接。
    const claudeLink = path.join(writer.worker.path, CLAUDE_FILE)
    assert.equal((await fs.lstat(claudeLink)).isSymbolicLink(), true)
    assert.equal(
      path.resolve(writer.worker.path, await fs.readlink(claudeLink)),
      path.join(writer.worker.path, 'AGENTS.md'),
    )
    assert.deepEqual(await readClaudeLink(writer.worker.path), {
      exists: true,
      symlink: true,
      mode: 'symlink',
      target: 'AGENTS.md',
    })

    // 新打工人插到数组最前（页面最新在上）。
    const painter = await addWorker({ workersDir, file, name: 'painter' })
    let registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.name),
      ['painter', 'writer'],
    )

    // 同名复用：created=false，条目与 createdAt 不变，已有 AGENTS.md 不被覆盖。
    // 用户自己的 CLAUDE.md 也不能被覆盖。
    await fs.rm(claudeLink)
    await fs.writeFile(claudeLink, 'my own notes\n')
    await fs.writeFile(path.join(writer.worker.path, 'AGENTS.md'), '# custom\n')
    const again = await addWorker({ workersDir, file, name: 'writer' })
    assert.equal(again.created, false)
    assert.deepEqual(again.worker, writer.worker)
    assert.equal(
      await fs.readFile(path.join(writer.worker.path, 'AGENTS.md'), 'utf8'),
      '# custom\n',
    )
    assert.equal(await fs.readFile(claudeLink, 'utf8'), 'my own notes\n')
    registry = await readWorkerRegistry({ file })
    assert.equal(registry.workers.length, 2)

    // 目录被外部删掉后，同名再登记会重新建目录与模板，但沿用原条目。
    await fs.rm(painter.worker.path, { recursive: true, force: true })
    const restored = await addWorker({ workersDir, file, name: 'painter' })
    assert.equal(restored.created, false)
    assert.deepEqual(restored.worker, painter.worker)
    assert.equal((await fs.stat(restored.worker.path)).isDirectory(), true)
    assert.ok(
      (await fs.readFile(path.join(restored.worker.path, 'AGENTS.md'), 'utf8')).startsWith(
        '# AGENTS.md',
      ),
    )

    // 非法名字：抛 code=invalid-name。
    await assert.rejects(
      () => addWorker({ workersDir, file, name: '../escape' }),
      (error) => error.code === 'invalid-name',
    )

    // 移除只删登记，目录保留。
    const removed = await removeWorker({ file, name: 'writer' })
    assert.deepEqual(removed, { removed: true })
    assert.equal((await fs.stat(writer.worker.path)).isDirectory(), true)
    registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.name),
      ['painter'],
    )
    // 未知名字：不写文件，removed=false。
    assert.deepEqual(await removeWorker({ file, name: 'nobody' }), { removed: false })
    assert.deepEqual(
      (await readWorkerRegistry({ file })).workers.map((worker) => worker.name),
      ['painter'],
    )
  } finally {
    await removeRoot(root)
  }
})

test('listWorkers：挂载 join、目录缺失、skills/agents 汇总与损坏容错', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 没有任何用户登记时，视图里只有内建机器人 clock，不抛错。
    const empty = await listWorkers({ file, workersDir })
    assert.equal(empty.root, workersDir)
    assert.equal(empty.registry, file)
    assert.equal(empty.corrupt, false)
    assert.deepEqual(
      empty.workers.map((worker) => worker.name),
      ['clock'],
    )
    assert.equal(empty.workers[0].driver, 'robot')
    assert.equal(empty.workers[0].program, 'clock')
    assert.equal(empty.workers[0].exists, false)
    assert.deepEqual(empty.workers[0].skills, [])

    const writer = await addWorker({ workersDir, file, name: 'writer' })
    const painter = await addWorker({ workersDir, file, name: 'painter' })
    const _ghost = await addWorker({ workersDir, file, name: 'ghost' })

    // writer 里装一个项目级 skill，并写一份 lockfile。
    await writeSkill(
      path.join(writer.worker.path, '.agents', 'skills', 'foo'),
      '---\nname: foo\ndescription: foo desc\n---\n',
    )
    await writeFile(
      path.join(writer.worker.path, 'skills-lock.json'),
      JSON.stringify({ version: 1, skills: { foo: { source: 'owner/repo' } } }),
    )

    // painter 的目录被外部删掉，但 DSH 里的工作区注册仍然存在。
    await fs.rm(painter.worker.path, { recursive: true, force: true })

    const workspaceRegistry = {
      list: () => [
        // 路径故意绕一下（含 `..`），验证按规范路径 join。
        { id: 'w-writer', path: path.join(workersDir, '..', 'workers', 'writer') },
        { id: 'w-painter', path: painter.worker.path },
        { id: 'w-unrelated', path: path.join(root, 'elsewhere') },
      ],
    }

    const snapshot = await listWorkers({ file, workspaceRegistry, workersDir })
    assert.equal(snapshot.root, workersDir)
    assert.equal(snapshot.registry, file)
    assert.equal(snapshot.corrupt, false)
    assert.deepEqual(
      snapshot.workers.map((worker) => worker.name),
      ['ghost', 'painter', 'writer', 'clock'],
    )

    const byName = new Map(snapshot.workers.map((worker) => [worker.name, worker]))

    assert.equal(byName.get('writer').driver, 'agent')
    assert.equal(byName.get('writer').assistant, false)
    assert.equal(byName.get('writer').exists, true)
    assert.equal(byName.get('writer').mounted, true)
    assert.equal(byName.get('writer').workspaceId, 'w-writer')
    assert.deepEqual(byName.get('writer').skills, [
      { name: 'foo', description: 'foo desc', source: 'owner/repo' },
    ])
    assert.equal(byName.get('writer').agents.exists, true)
    assert.ok(byName.get('writer').agents.content.startsWith('# AGENTS.md\n'))
    assert.deepEqual(byName.get('writer').claude, {
      exists: true,
      symlink: true,
      mode: 'symlink',
      target: 'AGENTS.md',
    })

    // 目录没了但工作区注册还在：exists=false、mounted=true。
    assert.equal(byName.get('painter').exists, false)
    assert.equal(byName.get('painter').mounted, true)
    assert.equal(byName.get('painter').workspaceId, 'w-painter')
    assert.deepEqual(byName.get('painter').skills, [])
    assert.deepEqual(byName.get('painter').agents, emptyAgentsFile())
    assert.deepEqual(byName.get('painter').claude, {
      exists: false,
      symlink: false,
      mode: 'missing',
      target: '',
    })

    // 旧打工人没有 CLAUDE.md 链接：列清单时自动补一份（目录与 AGENTS.md 都在）。
    await fs.rm(path.join(writer.worker.path, CLAUDE_FILE))
    await listWorkers({ file, workersDir })
    assert.equal(
      (await fs.lstat(path.join(writer.worker.path, CLAUDE_FILE))).isSymbolicLink(),
      true,
    )

    // 未挂载：mounted=false、workspaceId=null。
    assert.equal(byName.get('ghost').exists, true)
    assert.equal(byName.get('ghost').mounted, false)
    assert.equal(byName.get('ghost').workspaceId, null)

    // 登记文件损坏：corrupt=true 且 workers 为空。
    await writeFile(file, '{broken')
    const corrupt = await listWorkers({ file, workspaceRegistry, workersDir })
    assert.equal(corrupt.corrupt, true)
    assert.deepEqual(corrupt.workers, [])
    assert.equal(corrupt.root, workersDir)
  } finally {
    await removeRoot(root)
  }
})

test('CLAUDE.md 链接：自动创建、状态识别、不覆盖用户文件', async () => {
  const root = await makeRoot()
  try {
    // 空目录：建出指向 AGENTS.md 的相对链接。
    const linked = path.join(root, 'linked')
    await fs.mkdir(linked, { recursive: true })
    await writeFile(path.join(linked, 'AGENTS.md'), '# AGENTS.md\n')
    assert.deepEqual(await ensureClaudeLink(linked), {
      exists: true,
      symlink: true,
      mode: 'symlink',
      target: 'AGENTS.md',
    })
    // 幂等：第二次调用不重建、不报错。
    assert.equal((await ensureClaudeLink(linked)).mode, 'symlink')

    // 用户自己的普通文件：原样保留。
    const userFile = path.join(root, 'user-file')
    await fs.mkdir(userFile, { recursive: true })
    await writeFile(path.join(userFile, 'AGENTS.md'), '# AGENTS.md\n')
    await writeFile(path.join(userFile, 'CLAUDE.md'), '# 用户自己写的\n')
    const kept = await ensureClaudeLink(userFile)
    assert.equal(kept.mode, 'file')
    assert.equal(await fs.readFile(path.join(userFile, 'CLAUDE.md'), 'utf8'), '# 用户自己写的\n')

    // 指向别处的符号链接：也不覆盖。
    const foreign = path.join(root, 'foreign-link')
    await fs.mkdir(foreign, { recursive: true })
    await writeFile(path.join(foreign, 'AGENTS.md'), '# AGENTS.md\n')
    await writeFile(path.join(foreign, 'OTHER.md'), '# other\n')
    await fs.symlink('OTHER.md', path.join(foreign, 'CLAUDE.md'))
    assert.equal((await ensureClaudeLink(foreign)).mode, 'foreign-link')

    // 平台不支持链接时的降级文件：识别为 import 模式。
    const fallback = path.join(root, 'fallback')
    await fs.mkdir(fallback, { recursive: true })
    await writeFile(path.join(fallback, 'CLAUDE.md'), '@AGENTS.md\n')
    assert.deepEqual(await readClaudeLink(fallback), {
      exists: true,
      symlink: false,
      mode: 'import',
      target: 'AGENTS.md',
    })

    // 空路径不抛错。
    assert.equal((await readClaudeLink(undefined)).mode, 'missing')
    assert.equal((await ensureClaudeLink('')).mode, 'missing')
  } finally {
    await removeRoot(root)
  }
})

test('parseSkillList 解析 npx skills add --list 的人读输出', () => {
  const output = [
    '\u001b[38;5;245m│\u001b[0m',
    '│  Available Skills',
    '│',
    '│    web-design-guidelines',
    '│',
    '│      Review UI code for Web Interface Guidelines compliance.',
    '│      Second line of the description.',
    '│',
    '│    Convex Best Practices',
    '│',
    '│      Use Convex best practices.',
    '│',
    '│  Use --skill <name> to install specific skills',
    '',
  ].join('\n')
  assert.deepEqual(parseSkillList(output), [
    {
      name: 'web-design-guidelines',
      description:
        'Review UI code for Web Interface Guidelines compliance. Second line of the description.',
    },
    { name: 'Convex Best Practices', description: 'Use Convex best practices.' },
  ])

  // 没有 Available Skills 段（命令失败/输出格式变了）：空数组，由调用方报错。
  assert.deepEqual(parseSkillList('Fetching skills…\nFetching skills…'), [])
  assert.deepEqual(parseSkillList(''), [])
  assert.deepEqual(parseSkillList(undefined), [])
})

test('打开目录：平台命令映射与空路径校验', async () => {
  assert.deepEqual(revealCommand('darwin'), { command: 'open' })
  assert.deepEqual(revealCommand('win32'), { command: 'explorer' })
  assert.deepEqual(revealCommand('linux'), { command: 'xdg-open' })
  // 空路径不能执行任何命令。
  await assert.rejects(() => revealDirectory(''), /缺少要打开的目录路径/)
  await assert.rejects(() => revealDirectory(undefined), /缺少要打开的目录路径/)
  await assert.rejects(() => revealDirectory('   '), /缺少要打开的目录路径/)
})

test('cleanOutput 去掉 ANSI 与回车并保留末尾 4000 字符', () => {
  assert.equal(cleanOutput('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(cleanOutput('\u001b[2Kinstalled foo'), 'installed foo')
  assert.equal(cleanOutput('a\r\nb'), 'a\nb')
  assert.equal(cleanOutput('  trimmed  \n'), 'trimmed')
  assert.equal(cleanOutput('x'.repeat(9000)).length, 4000)
  assert.equal(cleanOutput('x'.repeat(9000), 100).length, 100)
  assert.equal(cleanOutput(undefined), '')
})

test('预设头像：id 唯一、确定性默认分配与新打工人一定带头像', async () => {
  assert.equal(new Set(AVATAR_IDS).size, AVATAR_IDS.length)
  assert.ok(AVATAR_IDS.includes(DEFAULT_AVATAR_ID))
  for (const id of AVATAR_IDS) assert.equal(isAvatarId(id), true, id)
  assert.equal(isAvatarId('dragon'), false)
  assert.equal(isAvatarId(''), false)
  assert.equal(isAvatarId(undefined), false)

  // 同名永远得到同一个预设；不同名字通常是不同预设。
  assert.equal(defaultAvatarFor('writer'), defaultAvatarFor('writer'))
  assert.ok(AVATAR_IDS.includes(defaultAvatarFor('写作-bot')))
  assert.ok(AVATAR_IDS.includes(defaultAvatarFor('')))

  // 名字哈希到的头像已被占用时，按预设顺序挑第一个没被占用的。
  const preferred = defaultAvatarFor('writer')
  const picked = pickDefaultAvatar('writer', [preferred])
  assert.notEqual(picked, preferred)
  assert.ok(AVATAR_IDS.includes(picked))
  assert.equal(pickDefaultAvatar('writer', AVATAR_IDS), preferred, '全部被占用时回到名字哈希的结果')

  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 不指定头像：Host 自动分配并写进登记表。
    const writer = await addWorker({ workersDir, file, name: 'writer' })
    assert.ok(AVATAR_IDS.includes(writer.worker.avatar))
    const painter = await addWorker({ workersDir, file, name: 'painter' })
    assert.ok(AVATAR_IDS.includes(painter.worker.avatar))
    assert.notEqual(painter.worker.avatar, writer.worker.avatar, '新建时优先挑没被占用的头像')

    // 指定头像：按传入 id 落盘；非法 id 退回默认分配。
    const panda = await addWorker({ workersDir, file, name: 'panda', avatar: 'panda' })
    assert.equal(panda.worker.avatar, 'panda')
    const invalid = await addWorker({ workersDir, file, name: 'invalid', avatar: 'dragon' })
    assert.ok(AVATAR_IDS.includes(invalid.worker.avatar))
    assert.notEqual(invalid.worker.avatar, 'dragon')

    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.name, worker.avatar]),
      [
        ['invalid', invalid.worker.avatar],
        ['panda', 'panda'],
        ['painter', painter.worker.avatar],
        ['writer', writer.worker.avatar],
      ],
    )

    // listWorkers 带出头像；同名复用时返回值也带头像。
    const listed = await listWorkers({ file, workersDir })
    assert.equal(listed.workers.find((worker) => worker.name === 'panda').avatar, 'panda')
  } finally {
    await removeRoot(root)
  }
})

test('setWorkerAvatar：只改登记表、旧登记表兜底、错误码明确', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({ workersDir, file, name: 'writer' })
    const changed = await setWorkerAvatar({ file, name: 'writer', avatar: 'owl' })
    assert.equal(changed.worker.avatar, 'owl')
    assert.equal(changed.worker.path, writer.worker.path, '目录不变')
    assert.equal(changed.worker.createdAt, writer.worker.createdAt, '创建时间不变')
    const registry = await readWorkerRegistry({ file })
    assert.equal(registry.workers[0].avatar, 'owl')
    // 目录与 AGENTS.md 不受影响。
    assert.equal((await fs.stat(writer.worker.path)).isDirectory(), true)
    assert.ok(
      (await fs.readFile(path.join(writer.worker.path, 'AGENTS.md'), 'utf8')).startsWith(
        '# AGENTS.md',
      ),
    )

    await assert.rejects(
      () => setWorkerAvatar({ file, name: 'writer', avatar: 'dragon' }),
      (error) => error.code === 'invalid-avatar',
    )
    await assert.rejects(
      () => setWorkerAvatar({ file, name: 'nobody', avatar: 'owl' }),
      (error) => error.code === 'unknown-worker',
    )

    // 旧登记表没有 avatar：读出来是空字符串，展示时按名字兜底，写一次就补齐。
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        workers: [
          {
            name: 'legacy',
            path: path.join(workersDir, 'legacy'),
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    )
    const legacy = await readWorkerRegistry({ file })
    assert.equal(legacy.workers[0].avatar, '')
    const listed = await listWorkers({ file, workersDir: workersDir })
    assert.equal(listed.workers[0].avatar, defaultAvatarFor('legacy'))
    await setWorkerAvatar({ file, name: 'legacy', avatar: 'whale' })
    assert.equal((await readWorkerRegistry({ file })).workers[0].avatar, 'whale')

    // 登记表损坏：拒绝写入，错误码 registry-unreadable。
    await fs.writeFile(file, '{broken')
    await assert.rejects(
      () => setWorkerAvatar({ file, name: 'legacy', avatar: 'owl' }),
      (error) => error.code === 'registry-unreadable',
    )
  } finally {
    await removeRoot(root)
  }
})

test('头像契约：Host 与两个浏览器一半共用同一组 id、emoji 与底色', () => {
  // 预设表只有一份，在 packages/plugin-ui；两个浏览器一半都从它派生。
  assert.deepEqual(
    AVATARS.map((preset) => preset.id),
    [...AVATAR_IDS],
    '界面侧预设顺序与 Host 的 lib/avatar.js 一致',
  )
  assert.equal(UI_DEFAULT_AVATAR_ID, DEFAULT_AVATAR_ID, '默认头像与 Host 一致')

  // emoji / 底色 / 词典 key 是契约的一部分：id 唯一、格式正确，编码与 Host 同序。
  assert.equal(new Set(AVATARS.map((preset) => preset.id)).size, AVATARS.length, 'id 不重复')
  for (const preset of AVATARS) {
    assert.match(preset.emoji, /\S/u, `${preset.id} 有 emoji`)
    assert.match(preset.color, /^#[0-9A-F]{6}$/u, `${preset.id} 的底色是六位十六进制`)
    assert.match(preset.labelKey, /^avatar[A-Z][A-Za-z]*$/u, `${preset.id} 有词典 key`)
  }
})

test('历史遗留的 worker 头像 id 不在预设里，会按名字哈希落回其它预设', () => {
  assert.equal(AVATAR_IDS.includes('worker'), false)
  assert.equal(isAvatarId('worker'), false)
  // 旧登记表里残留的 worker 会按名字哈希落回其它预设，而不是原样显示。
  assert.notEqual(resolveAvatar('worker', 'writer'), 'worker')
  assert.ok(AVATAR_IDS.includes(resolveAvatar('worker', 'writer')))
})

test('打工人描述：空白折叠、上限、登记表与列表读写', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 创建时带描述：空白折叠成一行。
    const writer = await addWorker({
      workersDir,
      file,
      name: 'writer',
      description: '  把会议记录\n整理成三点结论  ',
    })
    assert.equal(writer.worker.description, '把会议记录 整理成三点结论')
    assert.equal(
      (await readWorkerRegistry({ file })).workers[0].description,
      '把会议记录 整理成三点结论',
    )

    // listWorkers 把描述带给页面。
    const listed = await listWorkers({ file, workersDir })
    assert.equal(listed.workers[0].description, '把会议记录 整理成三点结论')

    // 改描述；换头像不影响描述。
    const changed = await setWorkerDescription({ file, name: 'writer', description: '写发布说明' })
    assert.equal(changed.worker.description, '写发布说明')
    await setWorkerAvatar({ file, name: 'writer', avatar: 'owl' })
    assert.equal((await readWorkerRegistry({ file })).workers[0].description, '写发布说明')

    // 空串 / 纯空白表示清空。
    await setWorkerDescription({ file, name: 'writer', description: '   ' })
    assert.equal((await readWorkerRegistry({ file })).workers[0].description, '')

    // 上限与非字符串都拒绝，未知打工人 404 语义。
    await assert.rejects(
      () =>
        setWorkerDescription({
          file,
          name: 'writer',
          description: 'x'.repeat(WORKER_DESCRIPTION_MAX_LENGTH + 1),
        }),
      (error) => error.code === 'invalid-description',
    )
    await assert.rejects(
      () => setWorkerDescription({ file, name: 'writer', description: 42 }),
      (error) => error.code === 'invalid-description',
    )
    await assert.rejects(
      () => setWorkerDescription({ file, name: 'nobody', description: 'x' }),
      (error) => error.code === 'unknown-worker',
    )

    // 新建时不传描述：空串；旧登记表缺字段读出来也是空串。
    const plain = await addWorker({ workersDir, file, name: 'plain' })
    assert.equal(plain.worker.description, '')
    await writeWorkerRegistry({
      file,
      workers: [
        {
          name: 'legacy',
          path: path.join(workersDir, 'legacy'),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    assert.equal((await readWorkerRegistry({ file })).workers[0].description, '')

    // 纯函数边界。
    assert.equal(normalizeWorkerDescription(' a\n\n  b '), 'a b')
    assert.equal(normalizeWorkerDescription(undefined), '')
    assert.equal(normalizeWorkerDescription(null), '')
    assert.equal(isValidWorkerDescription('x'), true)
    assert.equal(isValidWorkerDescription(42), false)

    // 超长值写到文件里也在读取时截断，页面/工具不会拿到超大文本。
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        workers: [
          {
            name: 'long',
            path: path.join(workersDir, 'long'),
            createdAt: '2026-01-01T00:00:00.000Z',
            description: 'x'.repeat(WORKER_DESCRIPTION_MAX_LENGTH + 50),
          },
        ],
      }),
    )
    assert.equal(
      (await readWorkerRegistry({ file })).workers[0].description.length,
      WORKER_DESCRIPTION_MAX_LENGTH,
    )
  } finally {
    await removeRoot(root)
  }
})

test('renameWorker：改目录与登记表、保留条目字段、模板只在未改动时同步', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({ workersDir, file, name: 'writer', description: '写发布说明' })
    await addWorker({ workersDir, file, name: 'painter' })
    const before = (await readWorkerRegistry({ file })).workers.find(
      (worker) => worker.name === 'writer',
    )

    const moved = await renameWorker({ workersDir, file, name: 'writer', newName: 'author' })
    assert.equal(moved.renamed, true)
    assert.equal(moved.previousName, 'writer')
    assert.equal(moved.agentsRewritten, true)
    assert.equal(moved.worker.name, 'author')
    assert.equal(moved.worker.path, await realpathOr(path.join(workersDir, 'author')))
    assert.equal(moved.worker.avatar, before.avatar, '头像不随名字漂移')
    assert.equal(moved.worker.description, '写发布说明')
    assert.equal(moved.worker.createdAt, before.createdAt)
    assert.equal(
      await fs.stat(writer.worker.path).then(
        () => true,
        () => false,
      ),
      false,
      '旧目录已不存在',
    )
    assert.equal((await fs.stat(moved.worker.path)).isDirectory(), true)

    // 登记表：条目在原位置更新 name / path，其它条目不受影响。
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.name),
      ['painter', 'author'],
    )
    assert.equal(registry.workers[1].path, moved.worker.path)
    assert.equal(registry.workers[1].createdAt, before.createdAt)
    assert.equal(registry.workers[1].description, '写发布说明')

    // 未改过的 AGENTS.md 模板同步成新名字与新路径。
    const template = await fs.readFile(path.join(moved.worker.path, 'AGENTS.md'), 'utf8')
    assert.ok(template.includes('这是「author」打工人的协作说明'))
    assert.ok(template.includes(`- 路径：\`${moved.worker.path}\``))
    assert.ok(!template.includes('writer'), '旧名字不再留在模板里')

    // CLAUDE.md 的相对软链接继续有效。
    assert.deepEqual(await readClaudeLink(moved.worker.path), {
      exists: true,
      symlink: true,
      mode: 'symlink',
      target: 'AGENTS.md',
    })

    // 用户改过的 AGENTS.md 不动。
    const edited = await addWorker({ workersDir, file, name: 'edited' })
    await fs.writeFile(path.join(edited.worker.path, 'AGENTS.md'), '# 我自己的说明\n')
    const editedMoved = await renameWorker({
      workersDir,
      file,
      name: 'edited',
      newName: 'edited-next',
    })
    assert.equal(editedMoved.agentsRewritten, false)
    assert.equal(
      await fs.readFile(path.join(editedMoved.worker.path, 'AGENTS.md'), 'utf8'),
      '# 我自己的说明\n',
    )

    // 旧登记表缺头像：按旧名字兜底后写回，改名不会让头像换一个。
    const legacyPath = await realpathOr(path.join(workersDir, 'legacy'))
    await fs.mkdir(legacyPath, { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        workers: [
          { name: 'legacy', path: legacyPath, createdAt: '2026-01-01T00:00:00.000Z' },
          ...(await readWorkerRegistry({ file })).workers,
        ],
      }),
    )
    const legacyMoved = await renameWorker({
      workersDir,
      file,
      name: 'legacy',
      newName: 'legacy-next',
    })
    assert.equal(legacyMoved.worker.avatar, resolveAvatar('', 'legacy'))
  } finally {
    await removeRoot(root)
  }
})

test('renameWorker：同名 no-op、名称/目录冲突、未知与缺失目录、越界路径与损坏登记表', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({ workersDir, file, name: 'writer' })
    await addWorker({ workersDir, file, name: 'painter' })

    // 同名：不落盘、不改目录，返回 renamed=false。
    const same = await renameWorker({ workersDir, file, name: 'writer', newName: 'writer' })
    assert.equal(same.renamed, false)
    assert.equal(same.previousName, 'writer')
    assert.equal(same.worker.path, writer.worker.path)

    // 新名与登记表里的打工人重名。
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'writer', newName: 'painter' }),
      (error) => error.code === 'name-taken',
    )
    // 新名与 workersDir 下已存在的目录重名。
    await fs.mkdir(path.join(workersDir, 'ghost'))
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'writer', newName: 'ghost' }),
      (error) => error.code === 'name-taken',
    )
    // 非法名字 / 未知打工人 / 目录被外部删掉。
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'writer', newName: '../escape' }),
      (error) => error.code === 'invalid-name',
    )
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'nobody', newName: 'author' }),
      (error) => error.code === 'unknown-worker',
    )
    await fs.rm(writer.worker.path, { recursive: true, force: true })
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'writer', newName: 'author' }),
      (error) => error.code === 'missing-directory',
    )

    // 登记表被手改到 workersDir 之外：拒绝移动用户目录。
    const outside = path.join(root, 'elsewhere', 'worker')
    await fs.mkdir(outside, { recursive: true })
    await writeWorkerRegistry({
      file,
      workers: [{ name: 'outside', path: outside, createdAt: '2026-01-01T00:00:00.000Z' }],
    })
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'outside', newName: 'inside' }),
      (error) => error.code === 'path-outside-root',
    )
    assert.equal((await fs.stat(outside)).isDirectory(), true)

    // 只改大小写：macOS 默认大小写不敏感，目标「已存在」其实是同一个目录，
    // 不能被误判成 name-taken；Linux 上本来就是普通改名。
    await addWorker({ workersDir, file, name: 'writer-case' })
    const cased = await renameWorker({
      workersDir,
      file,
      name: 'writer-case',
      newName: 'Writer-Case',
    })
    assert.equal(cased.renamed, true)
    assert.equal(cased.worker.name, 'Writer-Case')
    assert.ok(
      (await readWorkerRegistry({ file })).workers.some((worker) => worker.name === 'Writer-Case'),
      '登记表里是新名字',
    )

    // 登记表损坏：拒绝改名，不覆盖文件。
    await fs.writeFile(file, '{broken')
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'painter', newName: 'author' }),
      (error) => error.code === 'registry-unreadable',
    )
    assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  } finally {
    await removeRoot(root)
  }
})

test('renameWorker：登记表写失败时把目录改回旧名（失败后两侧仍一致）', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')
    const writer = await addWorker({ workersDir, file, name: 'writer' })

    // 收掉登记文件所在目录的写权限：原子写的临时文件创建失败。
    await fs.chmod(pluginDir, 0o500)
    try {
      await assert.rejects(
        () => renameWorker({ workersDir, file, name: 'writer', newName: 'author' }),
        (error) => error.code === 'EACCES' || error.code === 'EPERM',
      )
    } finally {
      await fs.chmod(pluginDir, 0o700)
    }

    // 目录改回旧名，登记表依旧指向 writer（没有半个新名字的条目）。
    assert.equal((await fs.stat(path.join(workersDir, 'writer'))).isDirectory(), true)
    assert.equal(
      await fs.stat(path.join(workersDir, 'author')).then(
        () => true,
        () => false,
      ),
      false,
    )
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.name),
      ['writer'],
    )
    assert.equal(registry.workers[0].path, writer.worker.path)
  } finally {
    await fs.chmod(path.join(root, 'cache', 'dsh-plugin-workers'), 0o700).catch(() => {})
    await removeRoot(root)
  }
})

test('预设打工人：只在登记表为空时种子一次，非空 / 损坏都不动', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 空登记表：补上两个预设，每个都有目录、AGENTS.md 与登记条目。
    const seeded = await seedPresetWorkers({ workersDir, file })
    assert.equal(seeded.corrupt, false)
    assert.deepEqual(seeded.seeded.sort(), PRESET_WORKERS.map((preset) => preset.name).sort())
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.name).sort(),
      PRESET_WORKERS.map((preset) => preset.name).sort(),
    )
    for (const preset of PRESET_WORKERS) {
      const entry = registry.workers.find((worker) => worker.name === preset.name)
      assert.ok(entry, `预设 ${preset.name} 应已登记`)
      assert.equal(entry.avatar, preset.avatar)
      assert.ok((await fs.stat(entry.path)).isDirectory())
      const agents = await fs.readFile(path.join(entry.path, 'AGENTS.md'), 'utf8')
      assert.ok(agents.includes(preset.name), 'AGENTS.md 模板里带上打工人名')
    }

    // 再次种子：登记表非空，不再新增。
    const again = await seedPresetWorkers({ workersDir, file })
    assert.deepEqual(again.seeded, [])

    // 登记表损坏：拒绝写入，不覆盖文件。
    await fs.writeFile(file, '{broken')
    const corrupt = await seedPresetWorkers({ workersDir, file })
    assert.equal(corrupt.corrupt, true)
    assert.deepEqual(corrupt.seeded, [])
    assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  } finally {
    await removeRoot(root)
  }
})

test('登记表 version 1 → 3：读时迁移 driver/assistant，写时落盘新格式', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 旧表只有 name / path / createdAt：读时补 driver=agent、assistant=false。
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        robots: [
          {
            name: 'writer',
            path: path.join(workersDir, 'writer'),
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'panda',
            description: '写发布说明',
          },
        ],
      }),
    )
    const migrated = await readWorkerRegistry({ file })
    assert.equal(migrated.version, 3)
    assert.deepEqual(migrated.workers, [
      {
        name: 'writer',
        driver: 'agent',
        program: '',
        path: path.join(workersDir, 'writer'),
        createdAt: '2026-01-01T00:00:00.000Z',
        avatar: 'panda',
        description: '写发布说明',
        assistant: false,
      },
    ])

    // 任何一次写入都把迁移结果落盘：文件升 version 3，条目带新字段。
    await setWorkerAvatar({ file, name: 'writer', avatar: 'owl' })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 3)
    assert.deepEqual(raw.workers[0], {
      name: 'writer',
      driver: 'agent',
      path: path.join(workersDir, 'writer'),
      createdAt: '2026-01-01T00:00:00.000Z',
      avatar: 'owl',
      description: '写发布说明',
      assistant: false,
    })

    // 写入方给旧形状（没有 driver / assistant）时也按 agent / false 补齐。
    await writeWorkerRegistry({
      file,
      workers: [
        {
          name: 'painter',
          path: path.join(workersDir, 'painter'),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    const plain = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(plain.workers[0].driver, 'agent')
    assert.equal(plain.workers[0].assistant, false)
    assert.equal(plain.workers[0].program, undefined)
    assert.equal(plain.workers[0].path, path.join(workersDir, 'painter'))
  } finally {
    await removeRoot(root)
  }
})

test('内建机器人 clock：启动补写、幂等、不可创建/删除/改名/改字段', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 首次补写：clock 进表，文件升到 version 3，条目没有 path。
    const first = await ensureBuiltinWorkers({ file })
    assert.deepEqual(first, { added: [CLOCK_WORKER_NAME] })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 3)
    assert.deepEqual(raw.workers, [
      {
        name: 'clock',
        driver: 'robot',
        program: 'clock',
        createdAt: BUILTIN_WORKERS[0].createdAt,
        avatar: defaultAvatarFor(CLOCK_WORKER_NAME),
        description: BUILTIN_WORKERS[0].description,
        assistant: false,
      },
    ])

    // 幂等：第二次不再写。
    assert.deepEqual(await ensureBuiltinWorkers({ file }), { added: [] })

    // 不可创建、不可删除、不可改名、不可改头像 / 描述 / 助理标记。
    await assert.rejects(
      () => addWorker({ workersDir, file, name: 'clock' }),
      (error) => error.code === 'builtin-worker',
    )
    await assert.rejects(
      () => removeWorker({ file, name: 'clock' }),
      (error) => error.code === 'builtin-worker',
    )
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'clock', newName: 'timer' }),
      (error) => error.code === 'robot-worker',
    )
    await assert.rejects(
      () => setWorkerAvatar({ file, name: 'clock', avatar: 'owl' }),
      (error) => error.code === 'robot-worker',
    )
    await assert.rejects(
      () => setWorkerDescription({ file, name: 'clock', description: 'x' }),
      (error) => error.code === 'robot-worker',
    )
    await assert.rejects(
      () => setWorkerAssistant({ file, name: 'clock', assistant: true }),
      (error) => error.code === 'robot-worker',
    )

    // 改名到内建名字也被拒绝（不能占用 clock）。
    await addWorker({ workersDir, file, name: 'writer' })
    await assert.rejects(
      () => renameWorker({ workersDir, file, name: 'writer', newName: 'clock' }),
      (error) => error.code === 'builtin-worker',
    )

    // 损坏的登记表：补写拒绝、不覆盖原文件。
    await writeFile(file, '{broken')
    assert.deepEqual(await ensureBuiltinWorkers({ file }), { added: [], corrupt: true })
    assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  } finally {
    await removeRoot(root)
  }
})

test('setWorkerAssistant：只有智能体可以标记 / 取消助理', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    await addWorker({ workersDir, file, name: 'writer' })
    const marked = await setWorkerAssistant({ file, name: 'writer', assistant: true })
    assert.equal(marked.worker.assistant, true)
    assert.equal(marked.worker.driver, 'agent')
    assert.equal((await readWorkerRegistry({ file })).workers[0].assistant, true)

    const cleared = await setWorkerAssistant({ file, name: 'writer', assistant: false })
    assert.equal(cleared.worker.assistant, false)

    await assert.rejects(
      () => setWorkerAssistant({ file, name: 'writer', assistant: 'yes' }),
      (error) => error.code === 'invalid-assistant',
    )
    await assert.rejects(
      () => setWorkerAssistant({ file, name: 'nobody', assistant: true }),
      (error) => error.code === 'unknown-worker',
    )

    // 机器人不是 agent，不能是助理。
    await ensureBuiltinWorkers({ file })
    await assert.rejects(
      () => setWorkerAssistant({ file, name: 'clock', assistant: true }),
      (error) => error.code === 'robot-worker',
    )
    // 手工写坏的 program 条目即使带 assistant: true，读回来也归一成 false。
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        robots: [
          {
            name: 'clock',
            driver: 'robot',
            program: 'clock',
            createdAt: '2026-01-01T00:00:00.000Z',
            assistant: true,
          },
        ],
      }),
    )
    assert.equal((await readWorkerRegistry({ file })).workers[0].assistant, false)
  } finally {
    await removeRoot(root)
  }
})

test('预设打工人：已有内建 clock 时仍然补两个 agent 起点打工人', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 启动顺序：先补内建 clock，再做预设种子；clock 不算「已有打工人」。
    await ensureBuiltinWorkers({ file })
    const seeded = await seedPresetWorkers({ workersDir, file })
    assert.equal(seeded.corrupt, false)
    assert.deepEqual(seeded.seeded.sort(), PRESET_WORKERS.map((preset) => preset.name).sort())
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.name, worker.driver]).sort(),
      [...PRESET_WORKERS.map((preset) => [preset.name, 'agent']), ['clock', 'robot']].sort(),
    )

    // 再种一次：已经有智能体，不再新增。
    assert.deepEqual((await seedPresetWorkers({ workersDir, file })).seeded, [])
  } finally {
    await removeRoot(root)
  }
})

test('登记表 version 2 → 3：driver "program" 读成 "robot"，写回落盘新版本', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const file = path.join(pluginDir, 'workers.json')
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        robots: [
          {
            name: 'clock',
            driver: 'program',
            program: 'clock',
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'bee',
            description: '',
            assistant: false,
          },
        ],
      }),
    )

    const migrated = await readWorkerRegistry({ file })
    assert.equal(migrated.version, 3)
    assert.equal(migrated.workers[0].driver, 'robot')
    assert.equal(migrated.workers[0].program, 'clock')

    await writeWorkerRegistry({ file, workers: migrated.workers })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 3)
    assert.equal(raw.workers[0].driver, 'robot')
  } finally {
    await removeRoot(root)
  }
})

test('旧插件缓存迁移：目录、文件名、登记格式与路径一次搬到新位置', async () => {
  const root = await makeRoot()
  try {
    const cache = path.join(root, 'cache')
    const env = { XDG_CACHE_HOME: cache }
    const legacyDir = legacyPluginCacheDir(env)
    const legacyRoot = path.join(legacyDir, 'robots')
    const legacyWriter = path.join(legacyRoot, 'writer')

    await writeFile(path.join(legacyWriter, 'AGENTS.md'), '# writer\n')
    await writeFile(
      path.join(legacyDir, 'robots.json'),
      JSON.stringify({
        version: 2,
        robots: [
          {
            name: 'writer',
            driver: 'agent',
            path: legacyWriter,
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'panda',
            description: '旧记录',
            assistant: false,
          },
          {
            name: 'clock',
            driver: 'program',
            program: 'clock',
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'bee',
            description: '',
            assistant: false,
          },
        ],
      }),
    )

    const workersDir = defaultWorkersRoot(env)
    const registryFile = path.join(path.dirname(workersDir), 'workers.json')
    await migrateWorkerStore({ workersDir, registryFile, env })

    // 整个缓存目录搬走了，内部文件名也改了。
    assert.equal(
      await fs.access(legacyDir).then(
        () => true,
        () => false,
      ),
      false,
    )
    assert.equal(
      await fs.access(path.join(workersDir, 'writer', 'AGENTS.md')).then(
        () => true,
        () => false,
      ),
      true,
    )
    const raw = JSON.parse(await fs.readFile(registryFile, 'utf8'))
    assert.equal(raw.version, 3)
    assert.deepEqual(
      raw.workers.map((worker) => [worker.name, worker.driver]),
      [
        ['writer', 'agent'],
        ['clock', 'robot'],
      ],
    )
    // 登记表里的目录跟着搬到新根目录。
    assert.equal(raw.workers[0].path, path.join(workersDir, 'writer'))

    // 幂等：再跑一次不改数据。
    await migrateWorkerStore({ workersDir, registryFile, env })
    assert.deepEqual(JSON.parse(await fs.readFile(registryFile, 'utf8')), raw)
  } finally {
    await removeRoot(root)
  }
})

test('自定义 workersDir：同级 robots 目录与登记文件一起改名并升级', async () => {
  const root = await makeRoot()
  try {
    const custom = path.join(root, 'custom')
    const oldRoot = path.join(custom, 'robots')
    const workersDir = path.join(custom, 'workers')
    const oldWriter = path.join(oldRoot, 'writer')

    await writeFile(path.join(oldWriter, 'AGENTS.md'), '# writer\n')
    await writeFile(
      path.join(custom, 'robots.json'),
      JSON.stringify({
        version: 2,
        robots: [
          {
            name: 'writer',
            driver: 'agent',
            path: oldWriter,
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'panda',
            description: '',
            assistant: false,
          },
        ],
      }),
    )

    await migrateWorkerStore({
      workersDir,
      registryFile: path.join(custom, 'workers.json'),
      env: { XDG_CACHE_HOME: path.join(root, 'cache') },
    })

    assert.equal(
      await fs.access(oldRoot).then(
        () => true,
        () => false,
      ),
      false,
    )
    assert.equal(
      await fs.access(path.join(workersDir, 'writer', 'AGENTS.md')).then(
        () => true,
        () => false,
      ),
      true,
    )
    const raw = JSON.parse(await fs.readFile(path.join(custom, 'workers.json'), 'utf8'))
    assert.equal(raw.version, 3)
    assert.equal(raw.workers[0].path, path.join(workersDir, 'writer'))
  } finally {
    await removeRoot(root)
  }
})

test('智能体模型：setWorkerModel 保存 / 清除、形状校验与机器人只读', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')
    await addWorker({ workersDir, file, name: 'writer' })
    await ensureBuiltinWorkers({ file })

    const saved = await setWorkerModel({
      file,
      name: 'writer',
      model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    })
    assert.deepEqual(saved.worker.model, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
    assert.deepEqual((await readWorkerRegistry({ file })).workers[0].model, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })

    // 只动 model：其它字段与顺序不变。
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.name),
      ['writer', 'clock'],
    )

    // null 清除配置；读回来没有 model 字段。
    const cleared = await setWorkerModel({ file, name: 'writer', model: null })
    assert.equal('model' in cleared.worker, false)
    assert.equal('model' in (await readWorkerRegistry({ file })).workers[0], false)

    // 形状不对 / 未知 / 机器人。
    await assert.rejects(
      () => setWorkerModel({ file, name: 'writer', model: { provider: '', model: 'm' } }),
      (error) => error.code === 'invalid-model',
    )
    await assert.rejects(
      () => setWorkerModel({ file, name: 'nobody', model: { provider: 'p', model: 'm' } }),
      (error) => error.code === 'unknown-worker',
    )
    await assert.rejects(
      () => setWorkerModel({ file, name: 'clock', model: { provider: 'p', model: 'm' } }),
      (error) => error.code === 'robot-worker',
    )

    // 手工写坏的 model 被忽略，不会让整条打工人消失。
    await writeFile(
      file,
      JSON.stringify({
        version: 3,
        workers: [
          {
            name: 'writer',
            driver: 'agent',
            path: path.join(workersDir, 'writer'),
            createdAt: '2026-01-01T00:00:00.000Z',
            model: { provider: 42, model: 'm' },
          },
        ],
      }),
    )
    const broken = await readWorkerRegistry({ file })
    assert.equal(broken.corrupt, undefined)
    assert.equal(broken.workers[0].name, 'writer')
    assert.equal('model' in broken.workers[0], false)
  } finally {
    await removeRoot(root)
  }
})

test('模型目录：按提供方分组、带推理强度，单个提供方失败不影响其它', async () => {
  const ctx = {
    get(name) {
      if (name === 'llm') {
        return {
          listProviders: () => [
            { id: 'p1', name: 'Provider One' },
            { id: 'bad', name: 'Broken' },
          ],
          listModels: async (provider) => {
            if (provider === 'bad') throw new Error('provider unavailable')
            return [{ id: 'm1', name: 'Model One' }]
          },
          resolveModelInfo: async () => ({
            reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' },
          }),
        }
      }
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'p1', model: 'm1' }) }
      }
      return undefined
    },
  }

  const catalog = await buildWorkerModelCatalog(ctx)
  assert.equal(catalog.available, true)
  assert.deepEqual(catalog.default, { provider: 'p1', model: 'm1' })
  assert.deepEqual(catalog.groups, [
    {
      id: 'p1',
      name: 'Provider One',
      models: [
        {
          id: 'm1',
          name: 'Model One',
          reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' },
        },
      ],
    },
  ])
  assert.deepEqual(catalog.failures, [
    { id: 'bad', name: 'Broken', message: 'provider unavailable' },
  ])

  // 没有 ctx.llm：目录不可用，但默认选择仍然返回。
  const withoutLlm = await buildWorkerModelCatalog({
    get: (name) =>
      name === 'agentDefaultModel'
        ? { currentSelection: () => ({ provider: 'p1', model: 'm1' }) }
        : undefined,
  })
  assert.equal(withoutLlm.available, false)
  assert.deepEqual(withoutLlm.groups, [])
  assert.deepEqual(withoutLlm.default, { provider: 'p1', model: 'm1' })
})
