/**
 * `ctx.bukaSkills` 对外服务的单测。
 *
 * 服务是插件对其他插件的公开 ABI，所以直接构造实例（不经过 Host 入口）。
 * 收藏文件与缓存落在临时 DSH home，仓库来源用本地 fixture 目录，不联网：
 *
 * - `listRepositories()` 的分类、探测失败降级与缓存复用；
 * - `listSkills()` 摊平按物理目录分组的树；
 * - 同一来源的并发请求合并；
 * - `checkSkills()` / `updateSkills()` 的委托与串行队列。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { addSavedRepo } from '../plugins/skills/src/repo-store.ts'
import { SERVICE_NAME, SkillsCatalogService } from '../plugins/skills/src/service.ts'

/** 建一个临时 DSH home，并在测试结束后删除。 */
async function tempHomes(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'buka-skills-service-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { agentsHome: path.join(root, 'agents'), dshHome: path.join(root, 'dsh') }
}

/** 在 fixture 目录里按相对路径写文件，自动建父目录。 */
async function writeRel(root, relPath, content) {
  const abs = path.join(root, ...relPath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

/** 写一个最小 SKILL.md。 */
function skillFile(name, description = `${name} description`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

/** 建一个标准 npx 仓库 fixture。 */
async function makeRepo(root) {
  await writeRel(root, 'skills/alpha/SKILL.md', skillFile('alpha', 'Alpha skill'))
  await writeRel(root, 'skills/group/beta/SKILL.md', skillFile('beta', 'Beta skill'))
  await writeRel(root, 'SKILL.md', skillFile('root'))
  return root
}

test('listRepositories：分类、失败降级并沿用收藏顺序', async (t) => {
  const homes = await tempHomes(t)
  const repo = await makeRepo(path.join(homes.dshHome, '..', 'repo'))
  await addSavedRepo({ homes, source: repo })
  await addSavedRepo({ homes, source: path.join(homes.dshHome, '..', 'missing') })
  await addSavedRepo({ homes, source: 'notion' })

  const service = new SkillsCatalogService({ homes })
  const listed = await service.listRepositories()
  assert.equal(listed.corrupt, false)
  // 新收藏排在最前：notion（不可列出）、缺失的本地路径、标准仓库。
  assert.deepEqual(
    listed.repositories.map((one) => one.kind),
    ['unknown', 'unknown', 'npx-skills'],
  )
  assert.equal(listed.repositories[0].skills, null)
  assert.equal(listed.repositories[1].code, 'repo-not-found')
  assert.equal(listed.repositories[2].skills, 2)
})

test('listSkills：只摊平根 skills/ 下的树，保留完整路径', async (t) => {
  const homes = await tempHomes(t)
  const repo = await makeRepo(path.join(homes.dshHome, '..', 'repo'))
  const service = new SkillsCatalogService({ homes })

  const listed = await service.listSkills({ source: repo })
  assert.equal(listed.ok, true)
  if (!listed.ok) return
  assert.equal(listed.kind, 'npx-skills')
  assert.deepEqual(
    listed.skills.map((one) => ({ name: one.name, path: one.path })),
    [
      { name: 'alpha', path: 'skills/alpha/SKILL.md' },
      { name: 'beta', path: 'skills/group/beta/SKILL.md' },
    ],
  )
  assert.equal('plugin' in listed.skills[0], false, '不再有 marketplace 的插件分组字段')
})

test('同一来源的并发 listSkills 共用一次读取', async (t) => {
  const homes = await tempHomes(t)
  const repo = await makeRepo(path.join(homes.dshHome, '..', 'repo'))
  const service = new SkillsCatalogService({ homes })
  const first = service.listSkills({ source: repo })
  const second = service.listSkills({ source: repo })
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a, b)
})

test('runSerialized：对外暴露的入口与检查 / 更新共用同一条串行队列', async (t) => {
  const homes = await tempHomes(t)
  const order = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let queue = Promise.resolve()
  const serialize = (work) => {
    const run = queue.then(work, work)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  const service = new SkillsCatalogService({ homes, serialize })

  const first = service.runSerialized(async () => {
    order.push('start-1')
    await gate
    order.push('end-1')
  })
  const second = service.runSerialized(async () => {
    order.push('start-2')
  })
  release()
  await Promise.all([first, second])

  assert.deepEqual(order, ['start-1', 'end-1', 'start-2'], '第二段等第一段结束才执行')
})

test('checkSkills / updateSkills：经串行队列委托，dir 原样传给 CLI', async (t) => {
  const homes = await tempHomes(t)
  const target = path.join(homes.dshHome, '..', 'worker')
  await fs.mkdir(target, { recursive: true })
  await writeRel(target, '.agents/skills/demo/SKILL.md', skillFile('demo'))
  await writeRel(
    target,
    'skills-lock.json',
    JSON.stringify({
      version: 2,
      skills: {
        demo: { source: 'acme/demo', sourceType: 'github' },
      },
    }),
  )

  const calls = []
  const cli = async (args, options = {}) => {
    calls.push({ args, options })
    if (args[0] === 'check') {
      return { exitCode: 1, stdout: '↑ demo has an update\n', stderr: '' }
    }
    return { exitCode: 0, stdout: '✓ Updated 1 skill(s)\n', stderr: '' }
  }
  const catalog = {
    listSkills: async () => ({
      ok: true,
      skills: [{ name: 'demo', description: '', path: 'skills/demo/SKILL.md' }],
    }),
  }
  const service = new SkillsCatalogService({ homes, cli })
  // 让服务的仓库读取走测试桩：check 只关心来源能否解析出这个 skill。
  service.listSkills = catalog.listSkills

  const checked = await service.checkSkills({ dir: target })
  assert.equal(checked.ok, true)
  if (checked.ok) {
    assert.equal(checked.scope, 'project')
    assert.equal(checked.dir, target)
    assert.equal(checked.results[0].status, 'update')
  }
  assert.deepEqual(calls[0], { args: ['check', '-p', '-y'], options: { cwd: target } })

  const updated = await service.updateSkills({ dir: target })
  assert.equal(updated.ok, true)
  if (updated.ok) {
    assert.deepEqual(updated.updated, [{ name: 'demo' }])
    assert.equal(updated.message.includes('已更新 1'), true)
  }
  assert.deepEqual(calls.at(-1), {
    args: ['update', 'demo', '-p', '-y'],
    options: { cwd: target },
  })
  assert.equal(SERVICE_NAME, 'bukaSkills')
})
