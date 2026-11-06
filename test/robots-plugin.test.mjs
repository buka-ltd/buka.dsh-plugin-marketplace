/**
 * @buka/dsh-plugin-robots Host 一半的单测。
 *
 * 全部用 `fs.mkdtemp(tmpdir())` 的临时目录，不联网、不读真实 home、不启动
 * webServer。覆盖：名称/路径校验、登记表（缺失、原子写 0600、损坏拒绝写入、
 * 坏条目过滤）、addRobot / removeRobot、listRobots 的挂载 join 与容错、
 * 项目级 skills 扫描、AGENTS.md 上限、npx 输出清理。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cleanOutput, parseSkillList } from '../plugins/robots/lib/npx.js'
import { revealCommand, revealDirectory } from '../plugins/robots/lib/reveal.js'
import {
  AGENTS_MAX_READ_BYTES,
  CLAUDE_FILE,
  addRobot,
  defaultRobotsRoot,
  emptyAgentsFile,
  ensureClaudeLink,
  isValidRobotName,
  listRobots,
  parseFrontmatter,
  pluginCacheDir,
  readAgentsFile,
  readClaudeLink,
  readRobotRegistry,
  removeRobot,
  resolveRobotRegistryFile,
  resolveRobotsDir,
  robotDirectory,
  scanProjectSkills,
  writeAgentsFile,
  writeRobotRegistry,
} from '../plugins/robots/lib/robot-store.js'

/**
 * 建一个临时根目录。
 *
 * @returns {Promise<string>}
 */
async function makeRoot() {
  return await fs.mkdtemp(path.join(tmpdir(), 'buka-robots-'))
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

test('机器人名称校验与目录拼接', () => {
  for (const good of ['writer', 'a', 'A1', '写作-bot', 'bot_1.2', 'x'.repeat(64)]) {
    assert.equal(isValidRobotName(good), true, good)
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
    assert.equal(isValidRobotName(bad), false, JSON.stringify(bad))
  }
  assert.equal(isValidRobotName(null), false)
  // 首尾空白会先 trim，再校验。
  assert.equal(isValidRobotName('  writer  '), true)

  const root = path.resolve(path.join(tmpdir(), 'robots-root'))
  assert.equal(robotDirectory(root, 'writer'), path.join(root, 'writer'))
  assert.equal(robotDirectory(root, '  writer  '), path.join(root, 'writer'))
  assert.equal(robotDirectory(root, '.'), null)
  assert.equal(robotDirectory(root, '..'), null)
  assert.equal(robotDirectory(root, '../escape'), null)
  assert.equal(robotDirectory(root, 'a/b'), null)
  assert.equal(robotDirectory('', 'writer'), null)
})

test('插件全局目录、机器人根目录与登记文件路径', async () => {
  const root = await makeRoot()
  try {
    const cache = path.join(root, 'cache')
    const home = path.join(root, 'home')

    assert.equal(pluginCacheDir({ XDG_CACHE_HOME: cache }), path.join(cache, 'dsh-plugin-robots'))
    assert.equal(
      defaultRobotsRoot({ XDG_CACHE_HOME: cache }),
      path.join(cache, 'dsh-plugin-robots', 'robots'),
    )
    // 注入的 env 完全决定默认值，不读真实 home。
    assert.equal(
      resolveRobotsDir(undefined, { XDG_CACHE_HOME: cache }),
      path.join(cache, 'dsh-plugin-robots', 'robots'),
    )
    assert.equal(
      resolveRobotsDir('   ', { XDG_CACHE_HOME: cache }),
      path.join(cache, 'dsh-plugin-robots', 'robots'),
    )
    // 没有 XDG_CACHE_HOME 时回退 <HOME>/.cache。
    assert.equal(
      resolveRobotsDir(undefined, { HOME: home }),
      path.join(home, '.cache', 'dsh-plugin-robots', 'robots'),
    )
    assert.equal(resolveRobotsDir('~/robots', { HOME: home }), path.join(home, 'robots'))
    assert.equal(
      resolveRobotsDir('relative/dir', { XDG_CACHE_HOME: cache }),
      path.resolve('relative/dir'),
    )

    const pluginDir = path.join(cache, 'dsh-plugin-robots')
    assert.equal(resolveRobotRegistryFile(path.join(pluginDir, 'robots')), path.join(pluginDir, 'robots.json'))
    assert.equal(resolveRobotRegistryFile(path.join(root, 'custom')), path.join(root, 'robots.json'))
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
    const workspace = path.join(root, 'robot')
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
    await fs.symlink(path.join(workspace, 'missing-target'), path.join(workspace, '.agents', 'skills', 'dangling'))

    const { skills } = await scanProjectSkills(workspace)
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ['bar', 'baz', 'flat-skill', 'foo'],
    )
    const byName = new Map(skills.map((skill) => [skill.name, skill]))
    assert.deepEqual(byName.get('foo'), { name: 'foo', description: 'does foo things', source: 'owner/repo' })
    assert.deepEqual(byName.get('bar'), { name: 'bar', description: '', source: 'https://github.com/owner/bar' })
    assert.deepEqual(byName.get('baz'), { name: 'baz', description: 'claude code copy', source: null })
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
    const workspace = path.join(root, 'robot')
    await fs.mkdir(workspace, { recursive: true })

    assert.deepEqual(await readAgentsFile(workspace), {
      exists: false,
      bytes: 0,
      modifiedAt: null,
      content: '',
      tooLarge: false,
    })

    const text = '# AGENTS.md\n\n你好，机器人。\n'
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

test('机器人登记表：缺失按空表、原子写 0600', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-robots')
    const robotsDir = path.join(pluginDir, 'robots')
    const file = path.join(pluginDir, 'robots.json')

    assert.deepEqual(await readRobotRegistry({ file }), { version: 1, robots: [], file })

    const entries = [
      { name: 'writer', path: path.join(robotsDir, 'writer'), createdAt: '2026-01-02T03:04:05.000Z' },
      { name: 'painter', path: path.join(robotsDir, 'painter'), createdAt: '2026-02-03T04:05:06.000Z' },
    ]
    await writeRobotRegistry({ file, robots: entries })
    assert.deepEqual(await readRobotRegistry({ file }), { version: 1, robots: entries, file })

    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    }

    // 覆盖写之后权限仍然收紧，且不残留临时文件。
    await writeRobotRegistry({ file, robots: entries.slice(0, 1) })
    assert.deepEqual(await readRobotRegistry({ file }), { version: 1, robots: entries.slice(0, 1), file })
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    }
    assert.deepEqual(await fs.readdir(pluginDir), ['robots.json'])
  } finally {
    await removeRoot(root)
  }
})

test('损坏的登记表：读返回 corrupt，写操作拒绝且不覆盖', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-robots')
    const robotsDir = path.join(pluginDir, 'robots')
    const file = path.join(pluginDir, 'robots.json')

    const cases = [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ version: 2, robots: [] }),
      JSON.stringify({ version: 1, robots: 'nope' }),
    ]
    for (const bad of cases) {
      await writeFile(file, bad)
      const registry = await readRobotRegistry({ file })
      assert.equal(registry.corrupt, true, bad)
      assert.deepEqual(registry.robots, [], bad)
      await assert.rejects(
        () => addRobot({ robotsDir, file, name: 'writer' }),
        (error) => error.code === 'registry-unreadable',
        bad,
      )
      await assert.rejects(
        () => removeRobot({ file, name: 'writer' }),
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
        robots: [
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
    const filtered = await readRobotRegistry({ file })
    assert.equal(filtered.corrupt, undefined)
    assert.deepEqual(filtered.robots, [{ name: 'ok', path: '/abs/ok', createdAt: '2026-01-01T00:00:00.000Z' }])
  } finally {
    await removeRoot(root)
  }
})

test('addRobot / removeRobot：目录、模板、插到最前、同名复用、只删登记', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-robots')
    const robotsDir = path.join(pluginDir, 'robots')
    const file = path.join(pluginDir, 'robots.json')

    const writer = await addRobot({ robotsDir, file, name: 'writer' })
    assert.equal(writer.created, true)
    assert.equal(writer.robot.name, 'writer')
    assert.equal(writer.robot.path, await realpathOr(path.join(robotsDir, 'writer')))
    assert.ok(!Number.isNaN(Date.parse(writer.robot.createdAt)))
    assert.equal((await fs.stat(writer.robot.path)).isDirectory(), true)

    const template = await fs.readFile(path.join(writer.robot.path, 'AGENTS.md'), 'utf8')
    assert.ok(template.startsWith('# AGENTS.md\n'))
    assert.ok(template.includes('这是「writer」机器人的协作说明'))
    assert.ok(template.includes(`- 路径：\`${writer.robot.path}\``))

    // 创建机器人时自动把 CLAUDE.md 做成指向 AGENTS.md 的软链接。
    const claudeLink = path.join(writer.robot.path, CLAUDE_FILE)
    assert.equal((await fs.lstat(claudeLink)).isSymbolicLink(), true)
    assert.equal(path.resolve(writer.robot.path, await fs.readlink(claudeLink)), path.join(writer.robot.path, 'AGENTS.md'))
    assert.deepEqual(await readClaudeLink(writer.robot.path), {
      exists: true,
      symlink: true,
      mode: 'symlink',
      target: 'AGENTS.md',
    })

    // 新机器人插到数组最前（页面最新在上）。
    const painter = await addRobot({ robotsDir, file, name: 'painter' })
    let registry = await readRobotRegistry({ file })
    assert.deepEqual(
      registry.robots.map((robot) => robot.name),
      ['painter', 'writer'],
    )

    // 同名复用：created=false，条目与 createdAt 不变，已有 AGENTS.md 不被覆盖。
    // 用户自己的 CLAUDE.md 也不能被覆盖。
    await fs.rm(claudeLink)
    await fs.writeFile(claudeLink, 'my own notes\n')
    await fs.writeFile(path.join(writer.robot.path, 'AGENTS.md'), '# custom\n')
    const again = await addRobot({ robotsDir, file, name: 'writer' })
    assert.equal(again.created, false)
    assert.deepEqual(again.robot, writer.robot)
    assert.equal(await fs.readFile(path.join(writer.robot.path, 'AGENTS.md'), 'utf8'), '# custom\n')
    assert.equal(await fs.readFile(claudeLink, 'utf8'), 'my own notes\n')
    registry = await readRobotRegistry({ file })
    assert.equal(registry.robots.length, 2)

    // 目录被外部删掉后，同名再登记会重新建目录与模板，但沿用原条目。
    await fs.rm(painter.robot.path, { recursive: true, force: true })
    const restored = await addRobot({ robotsDir, file, name: 'painter' })
    assert.equal(restored.created, false)
    assert.deepEqual(restored.robot, painter.robot)
    assert.equal((await fs.stat(restored.robot.path)).isDirectory(), true)
    assert.ok((await fs.readFile(path.join(restored.robot.path, 'AGENTS.md'), 'utf8')).startsWith('# AGENTS.md'))

    // 非法名字：抛 code=invalid-name。
    await assert.rejects(
      () => addRobot({ robotsDir, file, name: '../escape' }),
      (error) => error.code === 'invalid-name',
    )

    // 移除只删登记，目录保留。
    const removed = await removeRobot({ file, name: 'writer' })
    assert.deepEqual(removed, { removed: true })
    assert.equal((await fs.stat(writer.robot.path)).isDirectory(), true)
    registry = await readRobotRegistry({ file })
    assert.deepEqual(
      registry.robots.map((robot) => robot.name),
      ['painter'],
    )
    // 未知名字：不写文件，removed=false。
    assert.deepEqual(await removeRobot({ file, name: 'nobody' }), { removed: false })
    assert.deepEqual(
      (await readRobotRegistry({ file })).robots.map((robot) => robot.name),
      ['painter'],
    )
  } finally {
    await removeRoot(root)
  }
})

test('listRobots：挂载 join、目录缺失、skills/agents 汇总与损坏容错', async () => {
  const root = await makeRoot()
  try {
    const pluginDir = path.join(root, 'cache', 'dsh-plugin-robots')
    const robotsDir = path.join(pluginDir, 'robots')
    const file = path.join(pluginDir, 'robots.json')

    // 没有任何登记时是空表，不抛错。
    assert.deepEqual(await listRobots({ file, robotsDir }), {
      root: robotsDir,
      registry: file,
      corrupt: false,
      robots: [],
    })

    const writer = await addRobot({ robotsDir, file, name: 'writer' })
    const painter = await addRobot({ robotsDir, file, name: 'painter' })
    const ghost = await addRobot({ robotsDir, file, name: 'ghost' })

    // writer 里装一个项目级 skill，并写一份 lockfile。
    await writeSkill(
      path.join(writer.robot.path, '.agents', 'skills', 'foo'),
      '---\nname: foo\ndescription: foo desc\n---\n',
    )
    await writeFile(
      path.join(writer.robot.path, 'skills-lock.json'),
      JSON.stringify({ version: 1, skills: { foo: { source: 'owner/repo' } } }),
    )

    // painter 的目录被外部删掉，但 DSH 里的工作区注册仍然存在。
    await fs.rm(painter.robot.path, { recursive: true, force: true })

    const workspaceRegistry = {
      list: () => [
        // 路径故意绕一下（含 `..`），验证按规范路径 join。
        { id: 'w-writer', path: path.join(robotsDir, '..', 'robots', 'writer') },
        { id: 'w-painter', path: painter.robot.path },
        { id: 'w-unrelated', path: path.join(root, 'elsewhere') },
      ],
    }

    const snapshot = await listRobots({ file, workspaceRegistry, robotsDir })
    assert.equal(snapshot.root, robotsDir)
    assert.equal(snapshot.registry, file)
    assert.equal(snapshot.corrupt, false)
    assert.deepEqual(
      snapshot.robots.map((robot) => robot.name),
      ['ghost', 'painter', 'writer'],
    )

    const byName = new Map(snapshot.robots.map((robot) => [robot.name, robot]))

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

    // 旧机器人没有 CLAUDE.md 链接：列清单时自动补一份（目录与 AGENTS.md 都在）。
    await fs.rm(path.join(writer.robot.path, CLAUDE_FILE))
    await listRobots({ file, robotsDir })
    assert.equal((await fs.lstat(path.join(writer.robot.path, CLAUDE_FILE))).isSymbolicLink(), true)

    // 未挂载：mounted=false、workspaceId=null。
    assert.equal(byName.get('ghost').exists, true)
    assert.equal(byName.get('ghost').mounted, false)
    assert.equal(byName.get('ghost').workspaceId, null)

    // 登记文件损坏：corrupt=true 且 robots 为空。
    await writeFile(file, '{broken')
    const corrupt = await listRobots({ file, workspaceRegistry, robotsDir })
    assert.equal(corrupt.corrupt, true)
    assert.deepEqual(corrupt.robots, [])
    assert.equal(corrupt.root, robotsDir)
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
