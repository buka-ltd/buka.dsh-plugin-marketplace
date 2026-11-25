/**
 * `@buka/dsh-plugin-skill-update-check` 的检查逻辑与接线测试。
 *
 * 覆盖容易回归的几件事：
 * - `skills check` 输出解析（ANSI、更新行、本地修改、失败来源）；
 * - 只有 `skills-lock.json` 里由 npx 管理的项目技能才触发 CLI；
 * - 退出码 0 / 1 是正常结论，其它退出码与坏 lock 明确失败；
 * - 同一工作区的 5 分钟缓存与手动刷新；
 * - 更新只跑检查确认过的名字、串行执行，并返回更新后的快照；
 * - 会话 → 当前工作区的解析规则（sessionIds 优先、cwd 包含关系兜底）；
 * - 检查 / 更新两条路由的入参校验与响应；
 * - 浏览器一半挂在输入框下方的统计行最右端，点击弹出带「更新 / 全部更新」的
 *   弹窗；弹窗复用提示已有的快照，打开时不重新检查。更新交给页面级 store，
 *   关闭弹窗后继续在后台跑，提示条显示「正在更新 N 个技能」。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applySkillUpdates,
  checkProjectSkills,
  parseCheckOutput,
  readProjectLock,
  SkillChecker,
} from '../plugins/skill-update-check/src/check.ts'
import { SkillUpdateJobs } from '../plugins/skill-update-check/src/client/update-jobs.ts'
import {
  CHECK_ROUTE,
  registerRoutes,
  UPDATE_ROUTE,
} from '../plugins/skill-update-check/src/routes.ts'
import { resolveWorkspaceDir } from '../plugins/skill-update-check/src/workspace.ts'

const PLUGIN_DIR = new URL('../plugins/skill-update-check/', import.meta.url)
const CLIENT_DIR = new URL('src/client/', PLUGIN_DIR)

/** 临时目录，测试结束删除。 */
async function tempDir(t, prefix = 'skill-update-check-') {
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

/** 读插件里某个文件的文本。 */
function source(name, base = PLUGIN_DIR) {
  return fs.readFile(new URL(name, base), 'utf8')
}

/** 读一份 JSON。 */
async function json(name) {
  return JSON.parse(await source(name))
}

/** 记录调用的假 CLI；`result` 是固定返回值。 */
function fakeRunner(result) {
  const calls = []
  return {
    calls,
    runner: async (args, options) => {
      calls.push({ args: [...args], options })
      return result
    },
  }
}

/** 写一份项目 lock。 */
function lockBody(skills) {
  return JSON.stringify({ version: 2, skills })
}

test('parseCheckOutput：去掉 ANSI，认「有更新」「本地修改」与失败来源', () => {
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

test('readProjectLock：缺失是空，坏 JSON / 不支持的版本是失败', async (t) => {
  const root = await tempDir(t)
  assert.deepEqual(await readProjectLock(root), { ok: true, names: [], sources: {} })

  await writeRel(root, 'skills-lock.json', 'not json')
  const broken = await readProjectLock(root)
  assert.equal(broken.ok, false)
  assert.equal(broken.code, 'lock-unreadable')

  await writeRel(root, 'skills-lock.json', JSON.stringify({ version: 99, skills: {} }))
  const unsupported = await readProjectLock(root)
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'lock-unreadable')
})

test('checkProjectSkills：只统计 lock 里的项目技能，并传工作区 cwd', async (t) => {
  const root = await tempDir(t)
  await writeRel(
    root,
    'skills-lock.json',
    lockBody({
      alpha: { source: 'acme/alpha' },
      beta: { source: 'acme/beta' },
      manual: { source: '' },
    }),
  )
  const fake = fakeRunner({
    exitCode: 1,
    stdout: '\u001b[33m↑ beta has an update\u001b[0m\n✎ alpha has local changes\n',
    stderr: '',
  })

  const checked = await checkProjectSkills({
    dir: root,
    runner: fake.runner,
    now: () => 1234,
  })
  assert.equal(checked.ok, true)
  if (!checked.ok) return
  assert.equal(checked.status, 'updates')
  assert.equal(checked.total, 2, '没有来源的 lock 条目不参与')
  assert.deepEqual(checked.updates, ['beta'])
  assert.deepEqual(checked.modified, ['alpha'])
  assert.deepEqual(checked.sources, { beta: 'acme/beta' }, '只给待更新的 skill 带来源')
  assert.equal(checked.checkedAt, 1234)
  assert.deepEqual(fake.calls, [{ args: ['check', '-p', '-y'], options: { cwd: root } }])
})

test('checkProjectSkills：既有更新又有本地修改时不算可更新', async (t) => {
  const root = await tempDir(t)
  await writeRel(root, 'skills-lock.json', lockBody({ alpha: { source: 'acme/alpha' } }))
  const checked = await checkProjectSkills({
    dir: root,
    runner: fakeRunner({
      exitCode: 1,
      stdout: '↑ alpha has an update\n✎ alpha has local changes\n',
      stderr: '',
    }).runner,
  })
  assert.equal(checked.ok, true)
  if (!checked.ok) return
  assert.equal(checked.status, 'up-to-date', '不能把会覆盖本地修改的更新列出来')
  assert.deepEqual(checked.updates, [])
  assert.deepEqual(checked.modified, ['alpha'])
})

test('checkProjectSkills：没有 lock 时直接结束，不启动 CLI', async (t) => {
  const root = await tempDir(t)
  const fake = fakeRunner({ exitCode: 0, stdout: '', stderr: '' })
  const checked = await checkProjectSkills({ dir: root, runner: fake.runner })
  assert.equal(checked.ok, true)
  if (!checked.ok) return
  assert.equal(checked.status, 'no-project-skills')
  assert.equal(fake.calls.length, 0)
})

test('checkProjectSkills：全部最新是 up-to-date，退出码 >1 是失败', async (t) => {
  const root = await tempDir(t)
  await writeRel(root, 'skills-lock.json', lockBody({ alpha: { source: 'acme/alpha' } }))

  const clean = await checkProjectSkills({
    dir: root,
    runner: fakeRunner({ exitCode: 0, stdout: '✓ All project skills are up to date', stderr: '' })
      .runner,
  })
  assert.equal(clean.ok, true)
  if (clean.ok) {
    assert.equal(clean.status, 'up-to-date')
    assert.deepEqual(clean.updates, [])
  }

  const failed = await checkProjectSkills({
    dir: root,
    runner: fakeRunner({ exitCode: 2, stdout: '', stderr: 'network down' }).runner,
  })
  assert.equal(failed.ok, false)
  if (failed.ok) return
  assert.equal(failed.code, 'check-failed')
  assert.match(String(failed.output), /network down/u)
})

test('SkillChecker：同一目录 5 分钟内复用结果，refresh 与过期会重跑', async (t) => {
  const root = await tempDir(t)
  await writeRel(root, 'skills-lock.json', lockBody({ alpha: { source: 'acme/alpha' } }))

  let now = 1_000
  let calls = 0
  const runner = async () => {
    calls += 1
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const checker = new SkillChecker({ runner, ttlMs: 60_000, now: () => now })

  await checker.check(root)
  await checker.check(root)
  assert.equal(calls, 1, '缓存期内不重复跑 CLI')

  now += 60_001
  await checker.check(root)
  assert.equal(calls, 2, '缓存过期后重跑')

  await checker.check(root, { refresh: true })
  assert.equal(calls, 3, '刷新绕过缓存')
})

test('applySkillUpdates：逐个跑 update，失败项带输出尾部', async (t) => {
  const root = await tempDir(t)
  const calls = []
  const runner = async (args, options) => {
    calls.push({ args: [...args], options })
    if (args[1] === 'alpha') return { exitCode: 2, stdout: '', stderr: 'network down\n' }
    return { exitCode: 0, stdout: '✓ Updated 1 skill(s)', stderr: '' }
  }
  const applied = await applySkillUpdates({ dir: root, names: ['alpha', 'beta'], runner })
  assert.deepEqual(applied.updated, ['beta'])
  assert.equal(applied.failed.length, 1)
  assert.equal(applied.failed[0].name, 'alpha')
  assert.match(applied.failed[0].message, /退出码 2/u)
  assert.match(applied.failed[0].message, /network down/u)
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ['update', 'alpha', '-p', '-y'],
      ['update', 'beta', '-p', '-y'],
    ],
  )
  assert.deepEqual(calls[0].options, { cwd: root })
})

test('SkillChecker.update：只更新检查确认过的名字，更新后重查并替换缓存', async (t) => {
  const root = await tempDir(t)
  await writeRel(
    root,
    'skills-lock.json',
    lockBody({ alpha: { source: 'acme/alpha' }, beta: { source: 'acme/beta' } }),
  )
  const calls = []
  let checks = 0
  const runner = async (args) => {
    calls.push([...args])
    if (args[0] === 'check') {
      checks += 1
      return {
        exitCode: 1,
        stdout:
          checks === 1 ? '↑ alpha has an update\n↑ beta has an update\n' : '↑ beta has an update\n',
        stderr: '',
      }
    }
    return { exitCode: 0, stdout: '✓ Updated 1 skill(s)', stderr: '' }
  }
  const checker = new SkillChecker({ runner, ttlMs: 60_000, now: () => 5 })

  const report = await checker.update(root, { skills: ['alpha', 'missing'] })
  assert.equal(report.ok, true)
  if (!report.ok) return
  assert.deepEqual(report.updated, ['alpha'])
  assert.deepEqual(report.failed, [])
  assert.deepEqual(calls, [
    ['check', '-p', '-y'],
    ['update', 'alpha', '-p', '-y'],
    ['check', '-p', '-y'],
  ])
  assert.deepEqual(report.snapshot.updates, ['beta'], '快照是更新之后重新检查的结果')

  const cached = await checker.check(root)
  assert.equal(cached.ok, true)
  if (!cached.ok) return
  assert.deepEqual(cached.updates, ['beta'])
  assert.equal(calls.length, 3, '更新后的检查结果已写入缓存')
})

test('SkillChecker.update：单项失败不中断整批，失败的 skill 留在列表里', async (t) => {
  const root = await tempDir(t)
  await writeRel(
    root,
    'skills-lock.json',
    lockBody({ alpha: { source: 'acme/alpha' }, beta: { source: 'acme/beta' } }),
  )
  let betaUpdated = false
  const runner = async (args) => {
    if (args[0] === 'check') {
      const stdout = betaUpdated
        ? '↑ alpha has an update\n'
        : '↑ alpha has an update\n↑ beta has an update\n'
      return { exitCode: 1, stdout, stderr: '' }
    }
    if (args[1] === 'alpha') return { exitCode: 2, stdout: '', stderr: 'boom\n' }
    betaUpdated = true
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const checker = new SkillChecker({ runner })
  const report = await checker.update(root)
  assert.equal(report.ok, true)
  if (!report.ok) return
  assert.deepEqual(report.updated, ['beta'])
  assert.equal(report.failed.length, 1)
  assert.equal(report.failed[0].name, 'alpha')
  assert.deepEqual(report.snapshot.updates, ['alpha'])
})

test('SkillChecker.update：同一实例的更新串行执行', async (t) => {
  const root = await tempDir(t)
  await writeRel(root, 'skills-lock.json', lockBody({ alpha: { source: 'acme/alpha' } }))

  let active = 0
  let maxActive = 0
  const runner = async (args) => {
    if (args[0] === 'check') {
      return { exitCode: 1, stdout: '↑ alpha has an update\n', stderr: '' }
    }
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const checker = new SkillChecker({ runner })
  await Promise.all([
    checker.update(root, { skills: ['alpha'] }),
    checker.update(root, { skills: ['alpha'] }),
  ])
  assert.equal(maxActive, 1, '更新会整份重写 lockfile，不能并发')
})

test('update-jobs：关闭弹窗不影响后台更新，重复点击被忽略，完成后回传快照', async () => {
  const calls = []
  let finish = () => {}
  const store = new SkillUpdateJobs({
    run: (sessionId, names) => {
      calls.push({ sessionId, names })
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    now: () => 99,
  })
  const seen = []
  store.subscribe((job) => seen.push(job.status))

  store.start('session-1', ['alpha', 'beta'])
  store.start('session-1', ['alpha', 'beta'])
  assert.deepEqual(
    calls,
    [{ sessionId: 'session-1', names: ['alpha', 'beta'] }],
    '运行中重复点击不重复发起',
  )
  assert.equal(store.jobOf('session-1').status, 'running', '弹窗关闭后仍能读到进行中的任务')

  finish({
    ok: true,
    updated: ['alpha'],
    failed: [],
    snapshot: { ok: true, status: 'updates', total: 2, updates: ['beta'], checkedAt: 5 },
  })
  await new Promise((resolve) => setImmediate(resolve))
  const done = store.jobOf('session-1')
  assert.equal(done.status, 'done')
  assert.deepEqual(done.updated, ['alpha'])
  assert.deepEqual(done.snapshot.updates, ['beta'], '完成后带回新快照')
  assert.equal(done.finishedAt, 99)
  assert.deepEqual(seen, ['running', 'done'], '状态变化通知订阅者')
  assert.equal(store.jobOf('session-2'), undefined)
})

test('update-jobs：整次请求失败时保留失败原因，不改动列表', async () => {
  const store = new SkillUpdateJobs({
    run: async () => {
      throw new Error('network down')
    },
    describe: (error) => (error instanceof Error ? error.message : String(error)),
    now: () => 1,
  })
  store.start('session-1', ['alpha'])
  await new Promise((resolve) => setImmediate(resolve))
  const job = store.jobOf('session-1')
  assert.equal(job.status, 'failed')
  assert.equal(job.failure, 'network down')
  assert.equal(job.snapshot, null, '失败时没有新快照，列表保持原样')
})

test('resolveWorkspaceDir：sessionIds 优先，其次 cwd 包含关系，最后 cwd', () => {
  const attached = resolveWorkspaceDir({
    sessionId: 'session-1',
    session: { header: { cwd: '/work/a/sub/deeper' } },
    registry: {
      list: () => [
        { path: '/work/a', sessionIds: ['session-1'] },
        { path: '/work/a/sub', sessionIds: [] },
      ],
    },
  })
  assert.equal(attached, '/work/a')

  const contained = resolveWorkspaceDir({
    sessionId: 'session-2',
    session: { header: { cwd: '/work/a/sub' } },
    registry: {
      list: () => [
        { path: '/work/a', sessionIds: [] },
        { path: '/work/a/sub', sessionIds: [] },
      ],
    },
  })
  assert.equal(contained, '/work/a/sub', '取包含 cwd 的最长路径')

  assert.equal(
    resolveWorkspaceDir({
      sessionId: 'session-3',
      session: { header: { cwd: '/work/other' } },
      registry: { list: () => [{ path: '/work/a', sessionIds: [] }] },
    }),
    '/work/other',
  )

  assert.equal(
    resolveWorkspaceDir({ sessionId: 'session-4', session: {}, registry: { list: () => [] } }),
    undefined,
  )
})

test('浏览器一半注册在输入框下方统计行，点击提示打开更新弹窗', async () => {
  assert.equal(CHECK_ROUTE, '/skill-update-check/status')
  assert.equal(UPDATE_ROUTE, '/skill-update-check/update')
  const api = await source('api.ts', CLIENT_DIR)
  assert.ok(api.includes(`'${CHECK_ROUTE}'`), 'api.ts 的检查路由与 Host 不一致')
  assert.ok(api.includes(`'${UPDATE_ROUTE}'`), 'api.ts 的更新路由与 Host 不一致')

  const client = await source('index.ts', CLIENT_DIR)
  assert.ok(client.includes("'conversation.composer.dock'"), '没有注册到输入框下方的统计行')
  assert.ok(client.includes("id: 'skill-update-check'"))
  assert.ok(client.includes('locale: NS'))

  const badge = await source('badge.ts', CLIENT_DIR)
  assert.ok(badge.includes('SkillUpdatesDialog'), '点击提示没有打开弹窗')
  assert.ok(badge.includes("'aria-haspopup': 'dialog'"))
  assert.equal(
    badge.split("align: 'end'").length - 1,
    1,
    '所有状态的提示共用同一个右对齐 tooltip 外壳',
  )
  assert.ok(!badge.includes('Chevron'), '提示是状态标签，不应该带展开箭头')
  assert.ok(badge.includes('snapshot,'), '弹窗没有复用提示已经拿到的快照')
  assert.ok(badge.includes('failure,'), '弹窗没有拿到检查失败原因')
  assert.ok(badge.includes('updateStore.subscribe'), '提示没有订阅后台更新状态')
  assert.ok(badge.includes("t('updatingBadge'"), '提示没有显示「正在更新」')
  assert.ok(badge.includes("t('updatedBadge'"), '更新结束后提示没有反馈')

  const dialog = await source('dialog.ts', CLIENT_DIR)
  assert.ok(dialog.includes('Modal'), '弹窗没有复用 DSH 的 Modal')
  assert.ok(!dialog.includes('dialogDescription'), '弹窗不应再展示多余的说明文案')
  assert.ok(!dialog.includes('snapshot.dir'), '弹窗不应再展示工作区路径')
  assert.ok(dialog.includes('skill-update-check-source'), '每行没有显示技能来源')
  assert.ok(dialog.includes('snapshot?.sources?.[name]'), '来源没有按 skill 名取')
  assert.ok(dialog.includes('FRESH_MS'), '弹窗没有判断快照是否还新鲜')
  assert.ok(
    dialog.includes('readSkillUpdates(sessionId, refresh)'),
    '弹窗没有把「是否强制刷新」交给调用点决定',
  )
  assert.ok(dialog.includes('onClick: () => load(true)'), '「重新检查」应当强制跳过缓存')
  assert.ok(!dialog.includes('readSkillUpdates(sessionId, true)'), '打开弹窗不应强制重新检查')
  assert.ok(dialog.includes("t('update')"), '每一行缺少单个更新按钮')
  assert.ok(dialog.includes("t('updateAll')"), '缺少全部更新按钮')
  assert.ok(dialog.includes('update([name])'), '单个更新没有把名字交给后台 store')
  assert.ok(dialog.includes('update(updates)'), '全部更新没有把列表里的名字交给后台 store')
  assert.ok(dialog.includes('updateStore.start'), '更新没有交给页面级的后台 store')
  assert.ok(!dialog.includes('updateSkillUpdates('), '弹窗不应自己持有更新请求')
  assert.ok(dialog.includes('updatingHint'), '没有说明更新会在后台继续')
  assert.ok(!dialog.includes('if (updating !== null) return'), '更新中不应阻止关闭弹窗')

  const store = await source('update-store.ts', CLIENT_DIR)
  assert.ok(store.includes('updateSkillUpdates'), '后台 store 没有真正发起更新请求')
  assert.ok(store.includes('new SkillUpdateJobs'), '后台 store 没有用状态机装配')

  const jobs = await source('update-jobs.ts', CLIENT_DIR)
  assert.ok(jobs.includes("status: 'running'"), '状态机没有记录进行中的任务')
  assert.ok(jobs.includes("status: 'done'"), '状态机没有记录完成的任务')
  assert.ok(jobs.includes('subscribe'), '状态机没有提供订阅')
  assert.ok(jobs.includes('jobOf'), '状态机没有按会话保存任务')

  const dictionary = await source('dictionary.ts', CLIENT_DIR)
  assert.ok(!dictionary.includes('updatingAll'), '旧的「完成前不能关闭」文案还在')
  for (const key of [
    'updatingCount',
    'updatingHint',
    'updatingBadge',
    'updatingBadgeOne',
    'updatedBadge',
    'updatedBadgeOne',
  ]) {
    assert.ok(dictionary.includes(`${key}:`), `词典缺少 ${key}`)
  }

  const styles = await source('styles.ts', CLIENT_DIR)
  assert.ok(styles.includes('--dsw-alias-state-warn-primary'), '提示没有使用 warn 色 token')
  assert.match(styles, /\.skill-update-check-badge\{order:1;/, '提示没有排到「上下文已用」圆环之后')
  assert.ok(styles.includes('.skill-update-check-row{'), '弹窗没有逐行布局')
})

test('bundle 清单、locale 与详情文件齐全', async () => {
  const manifest = await json('package.json')
  assert.equal(manifest.name, '@buka/dsh-plugin-skill-update-check')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.equal(manifest.dependencies?.skills, '1.9.0')
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/cordis'], '~4.1.0')
  assert.ok((await source('cordis.patch.yml')).includes(manifest.name))

  for (const [file, detail] of [
    ['locale/en.json', 'docs/DETAIL.md'],
    ['locale/zh.json', 'docs/DETAIL.zh.md'],
  ]) {
    const { meta } = await json(file)
    assert.ok(typeof meta.title === 'string' && meta.title.length > 0, `${file} 缺标题`)
    assert.ok(typeof meta.description === 'string' && meta.description.length > 0, `${file} 缺简介`)
    assert.equal(meta.detail, detail)
    assert.ok((await source(detail)).length > 0, `${detail} 为空`)
  }
})

/** 造一个带响应缓冲的假 ServerResponse。 */
function responseBuffer() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(chunk) {
      this.body += chunk ?? ''
    },
  }
}

/** 造一条 JSON POST 请求；路由用异步迭代器读请求体。 */
function jsonRequest(url, body, method = 'POST') {
  const text = JSON.stringify(body)
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text)
    },
  }
}

/** 注册两条路由，返回按路径索引的路由表与调用记录。 */
function registerFakeRoutes() {
  const routes = new Map()
  const checks = []
  const updates = []
  const webCtx = {
    connection: { requestRejection: () => undefined },
    sessions: { get: () => ({ header: { cwd: '/work/ws/sub' } }) },
    webServer: {
      register: (route) => {
        routes.set(route.path, route)
        return () => {}
      },
    },
    effect: (fn) => fn(),
    get: (name) =>
      name === 'workspaceRegistry'
        ? { list: () => [{ path: '/work/ws', sessionIds: ['session-1'] }] }
        : undefined,
  }
  const ctx = {
    inject: (_names, callback) => callback(webCtx),
    effect: (fn) => fn(),
  }
  const checker = {
    check: async (dir, options) => {
      checks.push({ dir, options })
      return { ok: true, status: 'updates', dir, total: 1, updates: ['alpha'], checkedAt: 1 }
    },
    update: async (dir, options) => {
      updates.push({ dir, options })
      return {
        ok: true,
        updated: ['alpha'],
        failed: [],
        snapshot: { ok: true, status: 'up-to-date', dir, total: 1, updates: [], checkedAt: 2 },
      }
    },
  }
  registerRoutes(ctx, { checker })
  return { routes, checks, updates }
}

test('路由：GET 只按会话 id 解析工作区，refresh=1 透传给检查器', async () => {
  const { routes, checks } = registerFakeRoutes()
  const route = routes.get(CHECK_ROUTE)
  assert.ok(route, '没有注册检查路由')

  const res = responseBuffer()
  await route.handler({ method: 'GET', url: `${CHECK_ROUTE}?sessionId=session-1&refresh=1` }, res)
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.status, 'updates')
  assert.deepEqual(body.updates, ['alpha'])
  assert.deepEqual(checks, [{ dir: '/work/ws', options: { refresh: true } }])
})

test('路由：POST 更新校验请求体，只把名字交给检查器', async () => {
  const { routes, updates } = registerFakeRoutes()
  const route = routes.get(UPDATE_ROUTE)
  assert.ok(route, '没有注册更新路由')

  // 指定名字。
  const one = responseBuffer()
  await route.handler(jsonRequest(UPDATE_ROUTE, { sessionId: 'session-1', skills: ['alpha'] }), one)
  assert.equal(one.statusCode, 200)
  assert.equal(JSON.parse(one.body).ok, true)
  assert.deepEqual(updates, [{ dir: '/work/ws', options: { skills: ['alpha'] } }])

  // 省略 skills = 全部。
  const all = responseBuffer()
  await route.handler(jsonRequest(UPDATE_ROUTE, { sessionId: 'session-1' }), all)
  assert.deepEqual(updates.at(-1), { dir: '/work/ws', options: {} })

  // skills 不是字符串数组。
  const bad = responseBuffer()
  await route.handler(jsonRequest(UPDATE_ROUTE, { sessionId: 'session-1', skills: 'alpha' }), bad)
  assert.equal(bad.statusCode, 400)
  assert.equal(JSON.parse(bad.body).code, 'invalid-request')

  // 缺 sessionId。
  const noSession = responseBuffer()
  await route.handler(jsonRequest(UPDATE_ROUTE, { skills: ['alpha'] }), noSession)
  assert.equal(noSession.statusCode, 400)
  assert.equal(JSON.parse(noSession.body).code, 'invalid-session')

  // 方法不对。
  const wrongMethod = responseBuffer()
  await route.handler({ method: 'GET', url: UPDATE_ROUTE }, wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.headers.allow, 'POST')
})
