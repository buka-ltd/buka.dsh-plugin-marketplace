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
} from '../plugins/workflows/src/workers/avatar.ts'
import { buildWorkerModelCatalog } from '../plugins/workflows/src/workers/model-catalog.ts'
import { PRESET_WORKERS, seedPresetWorkers } from '../plugins/workflows/src/workers/presets.ts'
import { revealCommand, revealDirectory } from '../plugins/workflows/src/workers/reveal.ts'
import {
  AGENTS_MAX_READ_BYTES,
  addWorker,
  BUILTIN_WORKERS,
  CLAUDE_FILE,
  defaultWorkersRoot,
  emptyAgentsFile,
  ensureBuiltinWorkers,
  ensureClaudeLink,
  isLegacyWorkerId,
  isResolvableWorkerId,
  isValidWorkerDescription,
  isValidWorkerId,
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
  setWorkerAvatar,
  setWorkerDescription,
  setWorkerModel,
  WORKER_DESCRIPTION_MAX_LENGTH,
  workerDirectory,
  writeAgentsFile,
  writeWorkerRegistry,
} from '../plugins/workflows/src/workers/worker-store.ts'

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

test('执行者标识符校验与目录拼接：新格式严格、旧格式兼容', () => {
  // 新标识符：小写字母开头，后面可跟小写字母、数字、_ 与 -。
  for (const good of ['writer', 'a', 'a1', 'bot_1-2', 'x'.repeat(64)]) {
    assert.equal(isValidWorkerId(good), true, good)
    assert.equal(isResolvableWorkerId(good), true, good)
  }
  for (const bad of [
    '',
    '   ',
    'Writer',
    'A1',
    '1writer',
    '_writer',
    '写作-bot',
    'bot_1.2',
    'a b',
    'a/b',
    'a\b',
    'a\u0000b',
    'x'.repeat(65),
  ]) {
    assert.equal(isValidWorkerId(bad), false, JSON.stringify(bad))
  }
  assert.equal(isValidWorkerId(null), false)
  assert.equal(isValidWorkerId('  writer  '), true, '首尾空白先 trim')

  // 迁移来的旧标识符（旧登记表里的 name）不受新字符集约束，但仍必须能当目录名。
  for (const legacy of ['A1', '写作-bot', 'bot_1.2', 'x'.repeat(64), '  writer  ']) {
    assert.equal(isLegacyWorkerId(legacy), true, legacy)
    assert.equal(isResolvableWorkerId(legacy), true, legacy)
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
    assert.equal(isLegacyWorkerId(bad), false, JSON.stringify(bad))
    assert.equal(isResolvableWorkerId(bad), false, JSON.stringify(bad))
  }
  assert.equal(isLegacyWorkerId(null), false)

  const root = path.resolve(path.join(tmpdir(), 'workers-root'))
  assert.equal(workerDirectory(root, 'writer'), path.join(root, 'writer'))
  assert.equal(workerDirectory(root, '  writer  '), path.join(root, 'writer'))
  // 更新 / 改名 / 删除已有执行者时仍接受旧标识符。
  assert.equal(workerDirectory(root, '写作-bot'), path.join(root, '写作-bot'))
  assert.equal(workerDirectory(root, '.'), null)
  assert.equal(workerDirectory(root, '..'), null)
  assert.equal(workerDirectory(root, '../escape'), null)
  assert.equal(workerDirectory(root, 'a/b'), null)
  assert.equal(workerDirectory('', 'writer'), null)
})

test('插件全局目录、执行者根目录与登记文件路径', async () => {
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

    const text = '# AGENTS.md\n\n你好，执行者。\n'
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

test('执行者登记表：缺失按空表、原子写 0600', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    assert.deepEqual(await readWorkerRegistry({ file }), { version: 4, workers: [], file })

    const entries = [
      {
        id: 'writer',
        name: '写作助手',
        path: path.join(workersDir, 'writer'),
        createdAt: '2026-01-02T03:04:05.000Z',
      },
      {
        id: 'painter',
        name: '',
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
      avatar: defaultAvatarFor(entry.id),
      description: '',
    }))
    assert.deepEqual(await readWorkerRegistry({ file }), { version: 4, workers: written, file })

    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    }

    // 覆盖写之后权限仍然收紧，且不残留临时文件。
    await writeWorkerRegistry({ file, workers: entries.slice(0, 1) })
    assert.deepEqual(await readWorkerRegistry({ file }), {
      version: 4,
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
      JSON.stringify({ version: 5, workers: [] }),
      JSON.stringify({ version: 1, workers: 'nope' }),
    ]
    for (const bad of cases) {
      await writeFile(file, bad)
      const registry = await readWorkerRegistry({ file })
      assert.equal(registry.corrupt, true, bad)
      assert.deepEqual(registry.workers, [], bad)
      await assert.rejects(
        () => addWorker({ workersDir, file, id: 'writer' }),
        (error) => error.code === 'registry-unreadable',
        bad,
      )
      await assert.rejects(
        () => removeWorker({ file, id: 'writer' }),
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
        id: 'ok',
        name: '',
        driver: 'agent',
        program: '',
        path: '/abs/ok',
        createdAt: '2026-01-01T00:00:00.000Z',
        avatar: '',
        description: '',
      },
    ])
  } finally {
    await removeRoot(root)
  }
})

test('addWorker / removeWorker：按标识符建目录、id 冲突拒绝、只删登记', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({ workersDir, file, id: 'writer', name: '写作助手' })
    assert.equal(writer.created, true)
    assert.equal(writer.worker.id, 'writer')
    assert.equal(writer.worker.name, '写作助手')
    assert.equal(writer.worker.path, await realpathOr(path.join(workersDir, 'writer')))
    assert.ok(!Number.isNaN(Date.parse(writer.worker.createdAt)))
    assert.equal((await fs.stat(writer.worker.path)).isDirectory(), true)

    const template = await fs.readFile(path.join(writer.worker.path, 'AGENTS.md'), 'utf8')
    assert.ok(template.startsWith('# AGENTS.md\n'))
    assert.ok(template.includes('这是「写作助手」执行者的协作说明'))
    assert.ok(template.includes(`- 路径：\`${writer.worker.path}\``))

    // 创建执行者时自动把 CLAUDE.md 做成指向 AGENTS.md 的软链接。
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

    // 新执行者插到数组最前（页面最新在上）。
    const painter = await addWorker({ workersDir, file, id: 'painter' })
    assert.equal(painter.worker.name, '', '展示名可留空')
    let registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.id),
      ['painter', 'writer'],
    )

    // 标识符冲突必须拒绝（不会静默复用已有条目），且不覆盖用户文件。
    await fs.rm(claudeLink)
    await fs.writeFile(claudeLink, 'my own notes\n')
    await fs.writeFile(path.join(writer.worker.path, 'AGENTS.md'), '# custom\n')
    await assert.rejects(
      () => addWorker({ workersDir, file, id: 'writer', name: '另一个名字' }),
      (error) => error.code === 'id-taken',
    )
    assert.equal(
      await fs.readFile(path.join(writer.worker.path, 'AGENTS.md'), 'utf8'),
      '# custom\n',
    )
    assert.equal(await fs.readFile(claudeLink, 'utf8'), 'my own notes\n')
    registry = await readWorkerRegistry({ file })
    assert.equal(registry.workers.length, 2)
    assert.equal(registry.workers.find((worker) => worker.id === 'writer').name, '写作助手')

    // 非法标识符：抛 code=invalid-id；内建 clock 的标识符不可创建。
    await assert.rejects(
      () => addWorker({ workersDir, file, id: '../escape' }),
      (error) => error.code === 'invalid-id',
    )
    await assert.rejects(
      () => addWorker({ workersDir, file, id: 'Writer' }),
      (error) => error.code === 'invalid-id',
    )
    await assert.rejects(
      () => addWorker({ workersDir, file, id: 'clock' }),
      (error) => error.code === 'builtin-worker',
    )

    // 移除只删登记，目录保留。
    const removed = await removeWorker({ file, id: 'writer' })
    assert.deepEqual(removed, { removed: true })
    assert.equal((await fs.stat(writer.worker.path)).isDirectory(), true)
    registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => worker.id),
      ['painter'],
    )
    // 未知标识符：不写文件，removed=false。
    assert.deepEqual(await removeWorker({ file, id: 'nobody' }), { removed: false })
    assert.deepEqual(
      (await readWorkerRegistry({ file })).workers.map((worker) => worker.id),
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

    // 没有任何用户登记时，视图里只有内建机器人，不抛错。
    const empty = await listWorkers({ file, workersDir })
    assert.equal(empty.root, workersDir)
    assert.equal(empty.registry, file)
    assert.equal(empty.corrupt, false)
    assert.deepEqual(
      empty.workers.map((worker) => worker.id),
      ['clock', 'engine'],
    )
    assert.equal(empty.workers[0].driver, 'robot')
    assert.equal(empty.workers[0].program, 'clock')
    assert.equal(empty.workers[0].exists, false)
    assert.deepEqual(empty.workers[0].skills, [])

    const writer = await addWorker({ workersDir, file, id: 'writer' })
    const painter = await addWorker({ workersDir, file, id: 'painter' })
    const _ghost = await addWorker({ workersDir, file, id: 'ghost' })

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
      snapshot.workers.map((worker) => worker.id),
      ['ghost', 'painter', 'writer', 'clock', 'engine'],
    )

    const byName = new Map(snapshot.workers.map((worker) => [worker.id, worker]))

    assert.equal(byName.get('writer').driver, 'agent')
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

    // 旧执行者没有 CLAUDE.md 链接：列清单时自动补一份（目录与 AGENTS.md 都在）。
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

test('预设头像：id 唯一、确定性默认分配与新执行者一定带头像', async () => {
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
    const writer = await addWorker({ workersDir, file, id: 'writer' })
    assert.ok(AVATAR_IDS.includes(writer.worker.avatar))
    const painter = await addWorker({ workersDir, file, id: 'painter' })
    assert.ok(AVATAR_IDS.includes(painter.worker.avatar))
    assert.notEqual(painter.worker.avatar, writer.worker.avatar, '新建时优先挑没被占用的头像')

    // 指定头像：按传入 id 落盘；非法 id 退回默认分配。
    const panda = await addWorker({ workersDir, file, id: 'panda', avatar: 'panda' })
    assert.equal(panda.worker.avatar, 'panda')
    const invalid = await addWorker({ workersDir, file, id: 'invalid', avatar: 'dragon' })
    assert.ok(AVATAR_IDS.includes(invalid.worker.avatar))
    assert.notEqual(invalid.worker.avatar, 'dragon')

    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.id, worker.avatar]),
      [
        ['invalid', invalid.worker.avatar],
        ['panda', 'panda'],
        ['painter', painter.worker.avatar],
        ['writer', writer.worker.avatar],
      ],
    )

    // listWorkers 带出头像；同名复用时返回值也带头像。
    const listed = await listWorkers({ file, workersDir })
    assert.equal(listed.workers.find((worker) => worker.id === 'panda').avatar, 'panda')
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

    const writer = await addWorker({ workersDir, file, id: 'writer' })
    const changed = await setWorkerAvatar({ file, id: 'writer', avatar: 'owl' })
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
      () => setWorkerAvatar({ file, id: 'writer', avatar: 'dragon' }),
      (error) => error.code === 'invalid-avatar',
    )
    await assert.rejects(
      () => setWorkerAvatar({ file, id: 'nobody', avatar: 'owl' }),
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
    assert.equal(legacy.workers[0].id, 'legacy')
    assert.equal(legacy.workers[0].name, '')
    assert.equal(legacy.workers[0].avatar, '')
    const listed = await listWorkers({ file, workersDir: workersDir })
    assert.equal(listed.workers[0].avatar, defaultAvatarFor('legacy'))
    await setWorkerAvatar({ file, id: 'legacy', avatar: 'whale' })
    assert.equal((await readWorkerRegistry({ file })).workers[0].avatar, 'whale')

    // 登记表损坏：拒绝写入，错误码 registry-unreadable。
    await fs.writeFile(file, '{broken')
    await assert.rejects(
      () => setWorkerAvatar({ file, id: 'legacy', avatar: 'owl' }),
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

test('执行者描述：空白折叠、上限、登记表与列表读写', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 创建时带描述：空白折叠成一行。
    const writer = await addWorker({
      workersDir,
      file,
      id: 'writer',
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
    const changed = await setWorkerDescription({ file, id: 'writer', description: '写发布说明' })
    assert.equal(changed.worker.description, '写发布说明')
    await setWorkerAvatar({ file, id: 'writer', avatar: 'owl' })
    assert.equal((await readWorkerRegistry({ file })).workers[0].description, '写发布说明')

    // 空串 / 纯空白表示清空。
    await setWorkerDescription({ file, id: 'writer', description: '   ' })
    assert.equal((await readWorkerRegistry({ file })).workers[0].description, '')

    // 上限与非字符串都拒绝，未知执行者 404 语义。
    await assert.rejects(
      () =>
        setWorkerDescription({
          file,
          id: 'writer',
          description: 'x'.repeat(WORKER_DESCRIPTION_MAX_LENGTH + 1),
        }),
      (error) => error.code === 'invalid-description',
    )
    await assert.rejects(
      () => setWorkerDescription({ file, id: 'writer', description: 42 }),
      (error) => error.code === 'invalid-description',
    )
    await assert.rejects(
      () => setWorkerDescription({ file, id: 'nobody', description: 'x' }),
      (error) => error.code === 'unknown-worker',
    )

    // 新建时不传描述：空串；旧登记表缺字段读出来也是空串。
    const plain = await addWorker({ workersDir, file, id: 'plain' })
    assert.equal(plain.worker.description, '')
    await writeWorkerRegistry({
      file,
      workers: [
        {
          id: 'legacy',
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

test('renameWorker：只改展示名，保留标识符、目录、头像与条目字段', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({
      workersDir,
      file,
      id: 'writer',
      name: '写作助手',
      description: '写发布说明',
    })
    await addWorker({ workersDir, file, id: 'painter' })
    const before = (await readWorkerRegistry({ file })).workers.find(
      (worker) => worker.id === 'writer',
    )

    const renamed = await renameWorker({ file, id: 'writer', name: '发布说明作者' })
    assert.equal(renamed.renamed, true)
    assert.equal(renamed.previousName, '写作助手')
    assert.equal(renamed.worker.id, 'writer', '标识符不可变')
    assert.equal(renamed.worker.name, '发布说明作者')
    assert.equal(renamed.worker.path, writer.worker.path, '目录不移动')
    assert.equal(renamed.worker.avatar, before.avatar, '头像按标识符稳定')
    assert.equal(renamed.worker.description, '写发布说明')
    assert.equal(renamed.worker.createdAt, before.createdAt)
    assert.equal((await fs.stat(writer.worker.path)).isDirectory(), true)

    // 登记表：条目在原位置更新 name，其它条目不受影响。
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.id, worker.name]),
      [
        ['painter', ''],
        ['writer', '发布说明作者'],
      ],
    )
    assert.equal(registry.workers[1].path, writer.worker.path)
    assert.equal(registry.workers[1].createdAt, before.createdAt)
    assert.equal(registry.workers[1].description, '写发布说明')

    // AGENTS.md 与 CLAUDE.md 不因改展示名而改动。
    const template = await fs.readFile(path.join(writer.worker.path, 'AGENTS.md'), 'utf8')
    assert.ok(template.includes('这是「写作助手」执行者的协作说明'))
    assert.deepEqual(await readClaudeLink(writer.worker.path), {
      exists: true,
      symlink: true,
      mode: 'symlink',
      target: 'AGENTS.md',
    })

    // 清空展示名：id 不变，展示时回退到标识符。
    const cleared = await renameWorker({ file, id: 'writer', name: '' })
    assert.equal(cleared.renamed, true)
    assert.equal(cleared.worker.name, '')
    assert.equal(cleared.worker.id, 'writer')

    // 旧标识符（旧登记表里的 name）仍可用于改名。
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 3,
        workers: [
          {
            name: '软件工程师',
            driver: 'agent',
            path: await realpathOr(path.join(workersDir, '软件工程师')),
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'rocket',
            description: '写代码',
          },
        ],
      }),
    )
    const legacy = await renameWorker({ file, id: '软件工程师', name: '工程师' })
    assert.equal(legacy.renamed, true)
    assert.equal(legacy.worker.id, '软件工程师')
    assert.equal(legacy.worker.name, '工程师')
  } finally {
    await removeRoot(root)
  }
})

test('renameWorker：同名 no-op、展示名可重复、旧标识符兼容、未知与损坏登记表', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    const writer = await addWorker({ workersDir, file, id: 'writer', name: '写手' })
    await addWorker({ workersDir, file, id: 'painter', name: '画家' })

    // 同名：不落盘、不碰目录，返回 renamed=false。
    const same = await renameWorker({ file, id: 'writer', name: '写手' })
    assert.equal(same.renamed, false)
    assert.equal(same.previousName, '写手')
    assert.equal(same.worker.path, writer.worker.path)

    // 展示名不要求唯一。
    const duplicate = await renameWorker({ file, id: 'writer', name: '画家' })
    assert.equal(duplicate.renamed, true)
    assert.equal(duplicate.worker.name, '画家')

    // 非法展示名 / 未知标识符。
    await assert.rejects(
      () => renameWorker({ file, id: 'writer', name: 'x'.repeat(65) }),
      (error) => error.code === 'invalid-name',
    )
    await assert.rejects(
      () => renameWorker({ file, id: 'writer', name: 42 }),
      (error) => error.code === 'invalid-name',
    )
    await assert.rejects(
      () => renameWorker({ file, id: 'nobody', name: '作者' }),
      (error) => error.code === 'unknown-worker',
    )

    // 目录被外部删掉不影响改展示名。
    await fs.rm(writer.worker.path, { recursive: true, force: true })
    const noDirectory = await renameWorker({ file, id: 'writer', name: '作者' })
    assert.equal(noDirectory.renamed, true)
    assert.equal(noDirectory.worker.name, '作者')

    // 机器人只读；内建 clock 不可改。
    await writeWorkerRegistry({
      file,
      workers: [
        {
          id: 'timer',
          name: '定时器',
          driver: 'robot',
          program: 'clock',
          createdAt: '2026-01-01T00:00:00.000Z',
          description: '',
        },
      ],
    })
    await assert.rejects(
      () => renameWorker({ file, id: 'timer', name: '新定时器' }),
      (error) => error.code === 'robot-worker',
    )
    await assert.rejects(
      () => renameWorker({ file, id: 'clock', name: '时钟' }),
      (error) => error.code === 'builtin-worker' || error.code === 'unknown-worker',
    )

    // 登记表损坏：拒绝改名，不覆盖文件。
    await fs.writeFile(file, '{broken')
    await assert.rejects(
      () => renameWorker({ file, id: 'painter', name: '作者' }),
      (error) => error.code === 'registry-unreadable',
    )
    assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  } finally {
    await removeRoot(root)
  }
})

test('renameWorker：登记表写失败时展示名保持原值，目录不受影响', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')
    const writer = await addWorker({ workersDir, file, id: 'writer', name: '写作助手' })

    // 收掉登记文件所在目录的写权限：原子写的临时文件创建失败。
    await fs.chmod(pluginDir, 0o500)
    try {
      await assert.rejects(
        () => renameWorker({ file, id: 'writer', name: '发布说明作者' }),
        (error) => error.code === 'EACCES' || error.code === 'EPERM',
      )
    } finally {
      await fs.chmod(pluginDir, 0o700)
    }

    // 目录仍在原位，登记表仍是旧展示名。
    assert.equal((await fs.stat(path.join(workersDir, 'writer'))).isDirectory(), true)
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.id, worker.name]),
      [['writer', '写作助手']],
    )
    assert.equal(registry.workers[0].path, writer.worker.path)
  } finally {
    await fs.chmod(path.join(root, 'cache', 'dsh-plugin-workers'), 0o700).catch(() => {})
    await removeRoot(root)
  }
})

test('预设执行者：只在登记表为空时种子一次，非空 / 损坏都不动', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 空登记表：补上两个预设，每个都有目录、AGENTS.md 与登记条目。
    const seeded = await seedPresetWorkers({ workersDir, file })
    assert.equal(seeded.corrupt, false)
    assert.deepEqual(seeded.seeded.sort(), PRESET_WORKERS.map((preset) => preset.id).sort())
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.id, worker.name]).sort(),
      PRESET_WORKERS.map((preset) => [preset.id, preset.name]).sort(),
    )
    for (const preset of PRESET_WORKERS) {
      const entry = registry.workers.find((worker) => worker.id === preset.id)
      assert.ok(entry, `预设 ${preset.id} 应已登记`)
      assert.equal(entry.avatar, preset.avatar)
      assert.ok((await fs.stat(entry.path)).isDirectory())
      const agents = await fs.readFile(path.join(entry.path, 'AGENTS.md'), 'utf8')
      assert.ok(agents.includes(preset.name), 'AGENTS.md 模板里带上展示名')
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

test('登记表 version 1 → 4：读时迁移 driver 与 id/name，写时落盘新格式', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 旧表只有 name / path / createdAt：读时补 driver=agent。
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
    assert.equal(migrated.version, 4)
    assert.deepEqual(migrated.workers, [
      {
        id: 'writer',
        name: '',
        driver: 'agent',
        program: '',
        path: path.join(workersDir, 'writer'),
        createdAt: '2026-01-01T00:00:00.000Z',
        avatar: 'panda',
        description: '写发布说明',
      },
    ])

    // 任何一次写入都把迁移结果落盘：文件升 version 4，旧名字成为标识符。
    await setWorkerAvatar({ file, id: 'writer', avatar: 'owl' })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 4)
    assert.deepEqual(raw.workers[0], {
      id: 'writer',
      name: '',
      driver: 'agent',
      path: path.join(workersDir, 'writer'),
      createdAt: '2026-01-01T00:00:00.000Z',
      avatar: 'owl',
      description: '写发布说明',
    })

    // 写入方给旧形状（没有 driver）时也按 agent 补齐。
    await writeWorkerRegistry({
      file,
      workers: [
        {
          id: 'painter',
          path: path.join(workersDir, 'painter'),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    const plain = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(plain.workers[0].driver, 'agent')
    assert.equal(plain.workers[0].program, undefined)
    assert.equal(plain.workers[0].path, path.join(workersDir, 'painter'))
    assert.equal(plain.workers[0].assistant, undefined, 'assistant is not written back')
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

    // 首次补写：内建机器人进表，文件升到 version 4，条目没有 path。
    const first = await ensureBuiltinWorkers({ file })
    assert.deepEqual(first, { added: ['clock', 'engine'] })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 4)
    assert.deepEqual(
      raw.workers,
      BUILTIN_WORKERS.map((worker) => ({
        id: worker.id,
        name: worker.name,
        driver: 'robot',
        program: worker.program,
        createdAt: worker.createdAt,
        avatar: defaultAvatarFor(worker.id),
        description: worker.description,
      })),
    )

    // 幂等：第二次不再写。
    assert.deepEqual(await ensureBuiltinWorkers({ file }), { added: [] })

    // 不可创建、不可删除、不可改名、不可改头像 / 描述 / 助理标记。
    await assert.rejects(
      () => addWorker({ workersDir, file, id: 'clock' }),
      (error) => error.code === 'builtin-worker',
    )
    await assert.rejects(
      () => removeWorker({ file, id: 'clock' }),
      (error) => error.code === 'builtin-worker',
    )
    await assert.rejects(
      () => renameWorker({ file, id: 'clock', name: 'timer' }),
      (error) => error.code === 'builtin-worker',
    )
    await assert.rejects(
      () => setWorkerAvatar({ file, id: 'clock', avatar: 'owl' }),
      (error) => error.code === 'robot-worker',
    )
    await assert.rejects(
      () => setWorkerDescription({ file, id: 'clock', description: 'x' }),
      (error) => error.code === 'robot-worker',
    )
    // 展示名可以叫 clock；标识符不能变成 clock。
    await addWorker({ workersDir, file, id: 'writer' })
    const sameDisplayName = await renameWorker({ file, id: 'writer', name: 'clock' })
    assert.equal(sameDisplayName.worker.id, 'writer')
    assert.equal(sameDisplayName.worker.name, 'clock')

    // 损坏的登记表：补写拒绝、不覆盖原文件。
    await writeFile(file, '{broken')
    assert.deepEqual(await ensureBuiltinWorkers({ file }), { added: [], corrupt: true })
    assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  } finally {
    await removeRoot(root)
  }
})

test('登记表：旧记录里的 assistant 字段读取时丢弃、写回时消失', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // v4 旧记录带 assistant 字段：读出来的记录里没有它。
    await writeFile(
      file,
      JSON.stringify({
        version: 4,
        workers: [
          {
            id: 'writer',
            name: '',
            driver: 'agent',
            path: path.join(workersDir, 'writer'),
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'panda',
            description: '写发布说明',
            assistant: true,
          },
        ],
      }),
    )
    const before = await readWorkerRegistry({ file })
    assert.equal(before.workers.length, 1)
    assert.equal('assistant' in before.workers[0], false, 'the field is dropped on read')

    // 任意写入都落成不含 assistant 的 v4。
    await setWorkerAvatar({ file, id: 'writer', avatar: 'owl' })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 4)
    assert.equal(raw.workers[0].avatar, 'owl')
    assert.equal('assistant' in raw.workers[0], false, 'the field is not written back')

    // v2 机器人记录同样丢弃该字段（即使值写坏）。
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
    const robot = (await readWorkerRegistry({ file })).workers[0]
    assert.equal(robot.driver, 'robot')
    assert.equal('assistant' in robot, false)
  } finally {
    await removeRoot(root)
  }
})

test('预设执行者：已有内建 clock 时仍然补两个 agent 起点执行者', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // 启动顺序：先补内建 clock，再做预设种子；clock 不算「已有执行者」。
    await ensureBuiltinWorkers({ file })
    const seeded = await seedPresetWorkers({ workersDir, file })
    assert.equal(seeded.corrupt, false)
    assert.deepEqual(seeded.seeded.sort(), PRESET_WORKERS.map((preset) => preset.id).sort())
    const registry = await readWorkerRegistry({ file })
    assert.deepEqual(
      registry.workers.map((worker) => [worker.id, worker.driver]).sort(),
      [
        ...PRESET_WORKERS.map((preset) => [preset.id, 'agent']),
        ['clock', 'robot'],
        ['engine', 'robot'],
      ].sort(),
    )

    // 再种一次：已经有智能体，不再新增。
    assert.deepEqual((await seedPresetWorkers({ workersDir, file })).seeded, [])
  } finally {
    await removeRoot(root)
  }
})

test('登记表 version 2 → 4：driver "program" 读成 "robot"，写回落盘新版本', async () => {
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
          },
        ],
      }),
    )

    const migrated = await readWorkerRegistry({ file })
    assert.equal(migrated.version, 4)
    assert.equal(migrated.workers[0].driver, 'robot')
    assert.equal(migrated.workers[0].program, 'clock')

    await writeWorkerRegistry({ file, workers: migrated.workers })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 4)
    assert.equal(raw.workers[0].driver, 'robot')
  } finally {
    await removeRoot(root)
  }
})

test('登记表 version 3 → 4：旧 name 变成 id，name 置空，旧 id 仍可定位', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-workers')
    const workersDir = path.join(pluginDir, 'workers')
    const file = path.join(pluginDir, 'workers.json')

    // v3 条目只有 name；迁移后 id = 旧 name，展示名清空。
    await writeFile(
      file,
      JSON.stringify({
        version: 3,
        workers: [
          {
            name: '软件工程师',
            driver: 'agent',
            path: path.join(workersDir, '软件工程师'),
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'rocket',
            description: '写代码',
          },
          {
            name: 'clock',
            driver: 'robot',
            program: 'clock',
            createdAt: '2026-11-12T00:00:00.000Z',
            avatar: 'bee',
            description: '',
          },
        ],
      }),
    )

    const migrated = await readWorkerRegistry({ file })
    assert.equal(migrated.version, 4)
    assert.deepEqual(
      migrated.workers.map((worker) => [worker.id, worker.name, worker.driver]),
      [
        ['软件工程师', '', 'agent'],
        ['clock', '', 'robot'],
      ],
    )

    // 旧标识符（含汉字）仍可用于更新 / 改名 / 删除。
    const renamed = await renameWorker({ file, id: '软件工程师', name: '工程师' })
    assert.equal(renamed.renamed, true)
    assert.equal(renamed.worker.id, '软件工程师')
    assert.equal(renamed.worker.name, '工程师')

    // 写入后落盘 version 4：id 保留旧标识符、name 是新的展示名。
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.version, 4)
    assert.deepEqual(
      raw.workers.map((worker) => [worker.id, worker.name]),
      [
        ['软件工程师', '工程师'],
        ['clock', ''],
      ],
    )
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
          },
          {
            name: 'clock',
            driver: 'program',
            program: 'clock',
            createdAt: '2026-01-01T00:00:00.000Z',
            avatar: 'bee',
            description: '',
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
    assert.equal(raw.version, 4)
    assert.deepEqual(
      raw.workers.map((worker) => [worker.id, worker.driver]),
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
    assert.equal(raw.version, 4)
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
    await addWorker({ workersDir, file, id: 'writer' })
    await ensureBuiltinWorkers({ file })

    const saved = await setWorkerModel({
      file,
      id: 'writer',
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
      registry.workers.map((worker) => worker.id),
      ['writer', 'clock', 'engine'],
    )

    // null 清除配置；读回来没有 model 字段。
    const cleared = await setWorkerModel({ file, id: 'writer', model: null })
    assert.equal('model' in cleared.worker, false)
    assert.equal('model' in (await readWorkerRegistry({ file })).workers[0], false)

    // 形状不对 / 未知 / 机器人。
    await assert.rejects(
      () => setWorkerModel({ file, id: 'writer', model: { provider: '', model: 'm' } }),
      (error) => error.code === 'invalid-model',
    )
    await assert.rejects(
      () => setWorkerModel({ file, id: 'nobody', model: { provider: 'p', model: 'm' } }),
      (error) => error.code === 'unknown-worker',
    )
    await assert.rejects(
      () => setWorkerModel({ file, id: 'clock', model: { provider: 'p', model: 'm' } }),
      (error) => error.code === 'robot-worker',
    )

    // 手工写坏的 model 被忽略，不会让整条执行者消失。
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
    assert.equal(broken.workers[0].id, 'writer')
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
