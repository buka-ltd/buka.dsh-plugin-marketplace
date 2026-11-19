/**
 * 已安装 skill 的检查 / 更新单测。
 *
 * 重点覆盖验收标准里的状态模型与更新策略：
 *
 * - CLI 文本解析（`↑ … has an update` / `✎ … has local changes` / 来源失败）；
 * - 内容哈希与 `skills` README 的测试向量一致；
 * - 五种状态：update / modified / up-to-date / unsupported-source / failed；
 * - 更新只应用 update，modified 默认跳过并说明，失败项带命令输出；
 * - 没有可更新项时返回「已是最新」；
 * - 全局作用域在 `DSH_AGENTS_HOME` 不一致时拒绝执行。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { computeSkillFolderHash } from '../plugins/skills/src/skill-hash.ts'
import { checkSkills, parseCheckOutput, updateSkills } from '../plugins/skills/src/skill-update.ts'

/** 临时目录，测试结束删除。 */
async function tempDir(t, prefix = 'buka-skills-update-') {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

/** 在目录里写文件，自动建父目录。 */
async function writeRel(root, relPath, content) {
  const abs = path.join(root, ...relPath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

/** 写一个最小 SKILL.md。 */
function skillFile(name, description = `${name} description`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

test('parseCheckOutput：去掉 ANSI 并识别有更新、本地修改与失败来源', () => {
  const output = [
    '\u001b[38;5;145mChecking for skill updates…\u001b[0m',
    '\u001b[38;5;145m↑ alpha has an update\u001b[0m',
    '\u001b[38;5;145m✎ beta has local changes\u001b[0m',
    '✗ Failed to check skills from https://github.com/acme/broken',
  ].join('\n')
  const parsed = parseCheckOutput(output)
  assert.deepEqual([...parsed.updates], ['alpha'])
  assert.deepEqual([...parsed.modified], ['beta'])
  assert.deepEqual(parsed.failedSources, ['https://github.com/acme/broken'])
  assert.deepEqual(parseCheckOutput('nothing to see'), {
    updates: new Set(),
    modified: new Set(),
    failedSources: [],
  })
})

test('computeSkillFolderHash：与 skills README 的测试向量一致', async (t) => {
  const empty = await tempDir(t)
  assert.equal(
    await computeSkillFolderHash(empty),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )

  const single = await tempDir(t)
  await writeRel(single, 'SKILL.md', '# hi\n')
  assert.equal(
    await computeSkillFolderHash(single),
    '93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55',
  )

  const nested = await tempDir(t)
  await writeRel(nested, 'SKILL.md', 'a\n')
  await writeRel(nested, 'docs/b.md', 'b\n')
  assert.equal(
    await computeSkillFolderHash(nested),
    'b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24',
  )

  // CRLF 文本按 LF 计算；metadata.json 与 .git 不参与。
  const lf = await tempDir(t)
  await writeRel(lf, 'SKILL.md', 'a\n')
  const normalized = await tempDir(t)
  await writeRel(normalized, 'SKILL.md', 'a\r\n')
  assert.equal(await computeSkillFolderHash(normalized), await computeSkillFolderHash(lf))
  await writeRel(normalized, 'metadata.json', '{}')
  await writeRel(normalized, '.git/HEAD', 'ref: refs/heads/main\n')
  assert.equal(await computeSkillFolderHash(normalized), await computeSkillFolderHash(lf))
})

/** 造一个 worker 目录：`.agents/skills/*` + `skills-lock.json`。 */
async function makeWorker(root) {
  await writeRel(root, '.agents/skills/update/SKILL.md', skillFile('update'))
  await writeRel(root, '.agents/skills/modified/SKILL.md', skillFile('modified'))
  await writeRel(root, '.agents/skills/legacy/SKILL.md', skillFile('legacy'))
  await writeRel(root, '.agents/skills/broken/SKILL.md', skillFile('broken'))
  await writeRel(root, '.agents/skills/manual/SKILL.md', skillFile('manual'))
  const updateHash = await computeSkillFolderHash(path.join(root, '.agents/skills/update'))
  await writeRel(
    root,
    'skills-lock.json',
    JSON.stringify({
      version: 2,
      skills: {
        update: { source: 'acme/update', sourceType: 'github', computedHash: updateHash },
        modified: { source: 'acme/update', sourceType: 'github', computedHash: 'not-the-hash' },
        legacy: { source: 'acme/legacy', sourceType: 'github' },
        broken: { source: 'acme/broken', sourceType: 'github' },
      },
    }),
  )
  return root
}

/** 假仓库：标准仓库里只有 update / modified 两个 skill。 */
const catalog = {
  listSkills: async ({ source }) => {
    if (source === 'acme/update') {
      return {
        ok: true,
        skills: [
          { name: 'update', description: '', path: 'skills/update' },
          { name: 'modified', description: '', path: 'skills/modified' },
        ],
      }
    }
    if (source === 'acme/legacy') {
      return { ok: false, code: 'repo-unavailable', message: '只有根 SKILL.md' }
    }
    return { ok: false, code: 'fetch-failed', message: 'network down' }
  },
}

/** 假 CLI：check 报告 update / modified，update 成功或失败由 options 决定。 */
function fakeCli({ failUpdate = false } = {}) {
  const calls = []
  const cli = async (args, options = {}) => {
    calls.push({ args, options })
    if (args[0] === 'check') {
      return {
        exitCode: 1,
        stdout: '↑ update has an update\n✎ modified has local changes\n',
        stderr: '',
      }
    }
    if (failUpdate) {
      return { exitCode: 1, stdout: '', stderr: 'fatal: network down' }
    }
    return { exitCode: 0, stdout: '✓ Updated 1 skill(s)\n', stderr: '' }
  }
  return { cli, calls }
}

test('checkSkills：覆盖五种状态，手工安装不参与', async (t) => {
  const root = await tempDir(t)
  const worker = await makeWorker(path.join(root, 'worker'))
  const fake = fakeCli()

  const checked = await checkSkills({
    homes: workerHomes(root),
    catalog,
    cli: fake.cli,
    dir: worker,
  })
  assert.equal(checked.ok, true)
  if (!checked.ok) return
  assert.equal(checked.scope, 'project')
  const byName = new Map(checked.results.map((one) => [one.name, one.status]))
  assert.equal(byName.get('update'), 'update')
  assert.equal(byName.get('modified'), 'modified')
  assert.equal(byName.get('legacy'), 'unsupported-source')
  assert.equal(byName.get('broken'), 'failed')
  assert.equal(byName.has('manual'), false, '不在 lock 里的手工安装不参与检查')
  assert.equal(checked.results.length, 4)
  assert.deepEqual(fake.calls[0], { args: ['check', '-p', '-y'], options: { cwd: worker } })
})

test('checkSkills：完全没有可检查的 skill 时给出说明而不是空结果', async (t) => {
  const root = await tempDir(t)
  const worker = path.join(root, 'worker')
  await fs.mkdir(worker, { recursive: true })
  const checked = await checkSkills({
    homes: workerHomes(root),
    catalog,
    cli: fakeCli().cli,
    dir: worker,
  })
  assert.equal(checked.ok, true)
  if (checked.ok) {
    assert.deepEqual(checked.results, [])
    assert.match(String(checked.message), /无需检查/u)
  }
})

test('updateSkills：只应用 update，modified / unsupported / failed 跳过并说明', async (t) => {
  const root = await tempDir(t)
  const worker = await makeWorker(path.join(root, 'worker'))
  const fake = fakeCli()

  const updated = await updateSkills({
    homes: workerHomes(root),
    catalog,
    cli: fake.cli,
    dir: worker,
  })
  assert.equal(updated.ok, true)
  if (!updated.ok) return
  assert.deepEqual(updated.updated, [{ name: 'update' }])
  assert.deepEqual(
    updated.skipped.map((one) => [one.name, one.status]),
    [
      ['modified', 'modified'],
      ['legacy', 'unsupported-source'],
    ],
  )
  assert.match(updated.skipped[0].reason, /本地/u)
  assert.deepEqual(
    updated.failed.map((one) => one.name),
    ['broken'],
  )
  assert.match(updated.message, /已更新 1 个 skill/u)

  const updateCalls = fake.calls.filter((one) => one.args[0] === 'update')
  assert.deepEqual(updateCalls, [
    { args: ['update', 'update', '-p', '-y'], options: { cwd: worker } },
  ])
})

test('updateSkills：skills 过滤只处理指定的一项', async (t) => {
  const root = await tempDir(t)
  const worker = await makeWorker(path.join(root, 'worker'))
  const fake = fakeCli()

  const updated = await updateSkills({
    homes: workerHomes(root),
    catalog,
    cli: fake.cli,
    dir: worker,
    skills: ['update'],
  })
  assert.equal(updated.ok, true)
  if (!updated.ok) return
  assert.deepEqual(updated.updated, [{ name: 'update' }])
  assert.deepEqual(updated.skipped, [], '过滤后不再报告别的 skill')
  assert.deepEqual(updated.failed, [])
  const updateCalls = fake.calls.filter((one) => one.args[0] === 'update')
  assert.deepEqual(updateCalls, [
    { args: ['update', 'update', '-p', '-y'], options: { cwd: worker } },
  ])
})

test('updateSkills：skills 过滤掉不可更新项时不跑 update', async (t) => {
  const root = await tempDir(t)
  const worker = await makeWorker(path.join(root, 'worker'))
  const fake = fakeCli()

  const updated = await updateSkills({
    homes: workerHomes(root),
    catalog,
    cli: fake.cli,
    dir: worker,
    skills: ['nope'],
  })
  assert.equal(updated.ok, true)
  if (!updated.ok) return
  assert.deepEqual(updated.updated, [])
  assert.match(updated.message, /没有要更新的 skill/u)
  assert.equal(
    fake.calls.filter((one) => one.args[0] === 'update').length,
    0,
    '没有匹配项就不执行 skills update',
  )
})

test('updateSkills：没有可更新项时明确返回「已是最新」', async (t) => {
  const root = await tempDir(t)
  const worker = await makeWorker(path.join(root, 'worker'))
  const cli = async (args) => {
    if (args[0] === 'check')
      return { exitCode: 0, stdout: 'Checking for skill updates…\n', stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const updated = await updateSkills({ homes: workerHomes(root), catalog, cli, dir: worker })
  assert.equal(updated.ok, true)
  if (!updated.ok) return
  assert.deepEqual(updated.updated, [])
  assert.match(updated.message, /已是最新/u)
})

test('updateSkills：单个更新失败带命令输出，不影响后续', async (t) => {
  const root = await tempDir(t)
  const worker = await makeWorker(path.join(root, 'worker'))
  const fake = fakeCli({ failUpdate: true })

  const updated = await updateSkills({
    homes: workerHomes(root),
    catalog,
    cli: fake.cli,
    dir: worker,
  })
  assert.equal(updated.ok, true)
  if (!updated.ok) return
  assert.deepEqual(updated.updated, [])
  assert.deepEqual(
    updated.failed.map((one) => one.name),
    ['update', 'broken'],
  )
  const updateFailure = updated.failed.find((one) => one.name === 'update')
  assert.match(String(updateFailure?.output), /network down/u)
})

test('项目 lock 损坏时检查整体失败，不猜测状态', async (t) => {
  const root = await tempDir(t)
  const worker = path.join(root, 'worker')
  await writeRel(worker, 'skills-lock.json', 'not json')
  const checked = await checkSkills({
    homes: workerHomes(root),
    catalog,
    cli: fakeCli().cli,
    dir: worker,
  })
  assert.equal(checked.ok, false)
  assert.equal(checked.code, 'lock-unreadable')
})

test('全局作用域：DSH_AGENTS_HOME 不一致时拒绝检查 / 更新', async (t) => {
  const root = await tempDir(t)
  const homes = {
    agentsHome: path.join(root, 'agents'),
    dshHome: path.join(root, 'dsh'),
  }
  await writeRel(homes.agentsHome, 'skills/demo/SKILL.md', skillFile('demo'))
  await writeRel(
    homes.agentsHome,
    '.skill-lock.json',
    JSON.stringify({
      version: 3,
      skills: { demo: { source: 'acme/demo' } },
    }),
  )
  const fake = fakeCli()
  const checked = await checkSkills({ homes, catalog, cli: fake.cli })
  assert.equal(checked.ok, false)
  assert.equal(checked.code, 'unsupported-home')

  const updated = await updateSkills({ homes, catalog, cli: fake.cli })
  assert.equal(updated.ok, false)
  assert.equal(updated.code, 'unsupported-home')
  assert.equal(fake.calls.length, 0)
})

/** 检查 / 更新只需要 homes，不碰 agentsHome；这里给一份临时值。 */
function workerHomes(root) {
  return {
    agentsHome: path.join(root, 'agents'),
    dshHome: path.join(root, 'dsh'),
  }
}
