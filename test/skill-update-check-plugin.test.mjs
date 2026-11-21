/**
 * `@buka/dsh-plugin-skill-update-check` 的检查逻辑与接线测试。
 *
 * 覆盖容易回归的几件事：
 * - `skills check` 输出解析（ANSI、更新行、失败来源）；
 * - 只有 `skills-lock.json` 里由 npx 管理的项目技能才触发 CLI；
 * - 退出码 0 / 1 是正常结论，其它退出码与坏 lock 明确失败；
 * - 同一工作区的 5 分钟缓存与手动刷新；
 * - 会话 → 当前工作区的解析规则（sessionIds 优先、cwd 包含关系兜底）；
 * - 浏览器一半挂在输入框下方的统计行最右端，文案、样式与 bundle 清单齐全。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  checkProjectSkills,
  parseCheckOutput,
  readProjectLock,
  SkillChecker,
} from '../plugins/skill-update-check/src/check.ts'
import { CHECK_ROUTE, registerRoutes } from '../plugins/skill-update-check/src/routes.ts'
import { resolveWorkspaceDir } from '../plugins/skill-update-check/src/workspace.ts'

const PLUGIN_DIR = new URL('../plugins/skill-update-check/', import.meta.url)
const CLIENT_DIR = new URL('src/client/', PLUGIN_DIR)

/** 临时目录，测试结束删除。 */
async function tempDir(t, prefix = 'buka-skill-update-check-') {
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

test('parseCheckOutput：去掉 ANSI，只认「有更新」与失败来源', () => {
  const output = [
    '\u001b[38;5;145mChecking for skill updates…\u001b[0m',
    '\u001b[38;5;145m↑ alpha has an update\u001b[0m',
    '\u001b[38;5;145m✎ beta has local changes\u001b[0m',
    '✗ Failed to check skills from https://github.com/acme/broken',
  ].join('\n')
  const parsed = parseCheckOutput(output)
  assert.deepEqual([...parsed.updates], ['alpha'])
  assert.deepEqual(parsed.failedSources, ['https://github.com/acme/broken'])
  assert.deepEqual(parseCheckOutput('nothing to see'), {
    updates: new Set(),
    failedSources: [],
  })
})

test('readProjectLock：缺失是空，坏 JSON / 不支持的版本是失败', async (t) => {
  const root = await tempDir(t)
  assert.deepEqual(await readProjectLock(root), { ok: true, names: [] })

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
  assert.equal(checked.checkedAt, 1234)
  assert.deepEqual(fake.calls, [{ args: ['check', '-p', '-y'], options: { cwd: root } }])
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

test('浏览器一半注册在输入框下方统计行，Host 与浏览器共用检查路由', async () => {
  assert.equal(CHECK_ROUTE, '/buka-skill-update-check/status')
  const api = await source('api.ts', CLIENT_DIR)
  assert.ok(api.includes(`'${CHECK_ROUTE}'`), 'api.ts 的路由与 Host 不一致')

  const client = await source('index.ts', CLIENT_DIR)
  assert.ok(client.includes("'conversation.composer.dock'"), '没有注册到输入框下方的统计行')
  assert.ok(client.includes("id: 'buka-skill-update-check'"))
  assert.ok(client.includes('locale: NS'))
  const styles = await source('styles.ts', CLIENT_DIR)
  assert.ok(styles.includes('--dsw-alias-state-warn-primary'), '提示没有使用 warn 色 token')
  assert.match(
    styles,
    /\.buka-skill-update-check-badge\{order:1;/,
    '提示没有排到「上下文已用」圆环之后',
  )
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

test('路由：只按会话 id 解析工作区，refresh=1 透传给检查器', async () => {
  const routes = []
  const calls = []
  const webCtx = {
    connection: { requestRejection: () => undefined },
    sessions: { get: () => ({ header: { cwd: '/work/ws/sub' } }) },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    effect: (fn) => fn(),
    get: (name) =>
      name === 'workspaceRegistry'
        ? { list: () => [{ path: '/work/ws', sessionIds: ['session-1'] }] }
        : undefined,
  }
  const checker = {
    check: async (dir, options) => {
      calls.push({ dir, options })
      return {
        ok: true,
        status: 'updates',
        dir,
        total: 1,
        updates: ['alpha'],
        checkedAt: 1,
      }
    },
  }
  const ctx = {
    inject: (_names, callback) => callback(webCtx),
    effect: (fn) => fn(),
  }

  registerRoutes(ctx, { checker })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, CHECK_ROUTE)

  const req = {
    method: 'GET',
    url: `${CHECK_ROUTE}?sessionId=session-1&refresh=1`,
  }
  const res = {
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
  await routes[0].handler(req, res)

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.status, 'updates')
  assert.deepEqual(body.updates, ['alpha'])
  assert.deepEqual(calls, [{ dir: '/work/ws', options: { refresh: true } }])
})
