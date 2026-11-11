/**
 * `GET /buka-workflows/attachment` 的路由级单测。
 *
 * `lib/index.js` 顶层 import 了 DSH 运行时包（`@deepseek-ai/dsh-tools` 与
 * `@deepseek-ai/schemastery`），仓库里没有这些依赖。这里用 `module.registerHooks`
 * 把两个包替换成最小桩，再用假的 `webServer` / `connection` 注册路由，直接调用
 * handler 检查三种 mode 的状态码、响应头、MIME 与正文——不启动 DSH、不联网。
 *
 * 覆盖：默认下载回归、preview 的 text/截断/image/pdf/binary/404/400、
 * inline 的 content-type / inline disposition / SVG CSP / 非图片 415。
 */

import assert from 'node:assert/strict'
import { promises as fs, mkdtempSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_PREVIEW_TEXT_BYTES,
} from '../plugins/workflows/src/attachments.ts'

/** 桩文件目录：必须在 import 插件入口之前落盘。 */
const stubRoot = mkdtempSync(path.join(os.tmpdir(), 'buka-workflows-route-stubs-'))
const toolsStub = path.join(stubRoot, 'dsh-tools.mjs')
const schemasteryStub = path.join(stubRoot, 'schemastery.mjs')
writeFileSync(toolsStub, 'export const defineTool = (definition) => definition\n')
writeFileSync(
  schemasteryStub,
  [
    '// Config 只需要可链式调用的占位：z.object({...}) / z.string().default() 等。',
    'const chain = () => new Proxy(function () {}, {',
    '  get: () => () => chain(),',
    '  apply: () => chain(),',
    '})',
    'export default chain()',
    '',
  ].join('\n'),
)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: pathToFileURL(toolsStub).href, shortCircuit: true }
    }
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: pathToFileURL(schemasteryStub).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const ATTACHMENT_ROUTE = '/buka-workflows/attachment'
const RUN_ID = 'wf-attachment-route'
const NODE_ID = 'report'
const SEQ = 1

const TEXT = '# 报告\n\n全部通过。\n'
const LARGE = `${'a'.repeat(DEFAULT_PREVIEW_TEXT_BYTES + 32)}\n`
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const BINARY = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00])

/**
 * 建临时 runs 目录，预置一次 format 3 运行与四个附件，再加载插件注册路由。
 *
 * @returns {Promise<{ routes: Map<string, { handler: Function }>, runsDir: string, cleanup: () => Promise<void> }>}
 */
async function makeHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-attachment-route-'))
  const runsDir = path.join(root, 'runs')
  const { WorkflowRunStore } = await import('../plugins/workflows/src/run-store.ts')
  const store = new WorkflowRunStore({ dir: runsDir })
  await store.init()
  const seq = await store.allocateSeq()
  const now = Date.now()
  const attachments = [
    { index: 0, name: 'report.md', bytes: Buffer.byteLength(TEXT), description: 'report' },
    { index: 1, name: 'large.txt', bytes: Buffer.byteLength(LARGE) },
    { index: 2, name: 'photo.png', bytes: PNG.length },
    { index: 3, name: 'doc.pdf', bytes: PDF.length },
    { index: 4, name: 'icon.svg', bytes: SVG.length },
    { index: 5, name: 'data.bin', bytes: BINARY.length },
  ]
  await store.create({
    run: {
      runId: RUN_ID,
      seq,
      goal: 'attachment route',
      status: 'completed',
      createdAt: now - 1000,
      updatedAt: now,
      finishedAt: now,
      createdBy: { sessionId: 'root' },
      steps: [
        {
          seq,
          nodeId: NODE_ID,
          visit: 1,
          type: 'robot',
          robot: 'tester',
          sessionId: 'session-1',
          status: 'completed',
          stopReason: 'completed',
          startedAt: now - 1000,
          finishedAt: now,
          attachments,
        },
      ],
    },
    definition: {
      start: NODE_ID,
      nodes: { [NODE_ID]: { type: 'robot', robot: 'tester' } },
    },
  })
  await store.saveNodeResult(RUN_ID, seq, NODE_ID, { text: 'done', attachments })
  const attachmentsDir = path.join(store.nodeDirectory(RUN_ID, seq, NODE_ID), 'attachments')
  await fs.mkdir(attachmentsDir, { recursive: true })
  await fs.writeFile(path.join(attachmentsDir, 'report.md'), TEXT, 'utf8')
  await fs.writeFile(path.join(attachmentsDir, 'large.txt'), LARGE, 'utf8')
  await fs.writeFile(path.join(attachmentsDir, 'photo.png'), PNG)
  await fs.writeFile(path.join(attachmentsDir, 'doc.pdf'), PDF)
  await fs.writeFile(path.join(attachmentsDir, 'icon.svg'), SVG)
  await fs.writeFile(path.join(attachmentsDir, 'data.bin'), BINARY)

  /** @type {Map<string, { handler: Function }>} */
  const routes = new Map()
  const logger = { info() {}, debug() {}, warn() {} }
  const webServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const connection = { requestRejection: () => undefined }
  const webCtx = {
    webServer,
    connection,
    logger,
    effect(fn) {
      fn()
    },
  }
  const ctx = {
    effect(fn) {
      fn()
    },
    inject(deps, callback) {
      if (deps.includes('webServer') && deps.includes('connection')) callback(webCtx)
    },
    // 有 robots 服务时观察者不会等待 5 秒；这里不需要真正 dispatch。
    get(name) {
      if (name === 'bukaRobots') return { dispatchSession() {} }
      return undefined
    },
    logger,
    tools: { register() {} },
  }

  const { apply } = await import(
    `${pathToFileURL(path.resolve('plugins/workflows/src/index.ts')).href}?route-test=${Date.now()}`
  )
  apply(ctx, { runsDir, maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES })

  return {
    routes,
    runsDir,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(stubRoot, { recursive: true, force: true })
    },
  }
}

/**
 * 发一个 GET 请求并收集状态码、响应头与正文。
 *
 * @param {Map<string, { handler: Function }>} routes
 * @param {string} url
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer }>}
 */
async function callRoute(routes, url) {
  const route = routes.get(ATTACHMENT_ROUTE)
  assert.ok(route, `${ATTACHMENT_ROUTE} 应已注册`)
  const chunks = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  res.statusCode = 200
  res.headers = {}
  res.setHeader = (key, value) => {
    res.headers[String(key).toLowerCase()] = String(value)
  }
  res.getHeader = (key) => res.headers[String(key).toLowerCase()]
  const finished = new Promise((resolve) => {
    res.on('finish', resolve)
    res.on('close', resolve)
  })
  await route.handler({ method: 'GET', url, headers: {} }, res)
  await finished
  return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }
}

/**
 * 拼附件路由的查询串。
 *
 * @param {{ name: string, mode?: string, seq?: number }} options
 * @returns {string}
 */
function attachmentUrl({ name, mode, seq = SEQ }) {
  const params = new URLSearchParams({
    runId: RUN_ID,
    seq: String(seq),
    nodeId: NODE_ID,
    name,
  })
  if (mode !== undefined) params.set('mode', mode)
  return `${ATTACHMENT_ROUTE}?${params.toString()}`
}

/**
 * @param {{ body: Buffer }} response
 * @returns {Record<string, any>}
 */
function jsonBody(response) {
  return JSON.parse(response.body.toString('utf8'))
}

test('attachment route: default mode still downloads with attachment disposition', async () => {
  const harness = await makeHarness()
  try {
    const response = await callRoute(harness.routes, attachmentUrl({ name: 'report.md' }))
    assert.equal(response.status, 200)
    assert.equal(response.headers['content-type'], 'application/octet-stream')
    assert.match(response.headers['content-disposition'], /^attachment;/u)
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.equal(response.body.toString('utf8'), TEXT)
  } finally {
    await harness.cleanup()
  }
})

test('attachment route: preview returns text metadata and truncates a large text file', async () => {
  const harness = await makeHarness()
  try {
    const text = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'report.md', mode: 'preview' }),
    )
    assert.equal(text.status, 200)
    const textBody = jsonBody(text)
    assert.equal(textBody.ok, true)
    assert.equal(textBody.attachment.kind, 'text')
    assert.equal(textBody.attachment.mime, 'text/plain')
    assert.equal(textBody.attachment.text, TEXT)
    assert.equal(textBody.attachment.truncated, false)
    assert.equal(textBody.attachment.bytes, Buffer.byteLength(TEXT))

    const large = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'large.txt', mode: 'preview' }),
    )
    const largeBody = jsonBody(large)
    assert.equal(largeBody.attachment.kind, 'text')
    assert.equal(largeBody.attachment.truncated, true)
    assert.ok(largeBody.attachment.text.length <= DEFAULT_PREVIEW_TEXT_BYTES)
    assert.equal(largeBody.attachment.read, DEFAULT_PREVIEW_TEXT_BYTES)
    assert.ok(largeBody.attachment.bytes > DEFAULT_PREVIEW_TEXT_BYTES)
  } finally {
    await harness.cleanup()
  }
})

test('attachment route: preview classifies images, PDF and binary without reading bodies', async () => {
  const harness = await makeHarness()
  try {
    const image = jsonBody(
      await callRoute(harness.routes, attachmentUrl({ name: 'photo.png', mode: 'preview' })),
    )
    assert.deepEqual(image.attachment, {
      name: 'photo.png',
      bytes: PNG.length,
      kind: 'image',
      mime: 'image/png',
    })

    const pdf = jsonBody(
      await callRoute(harness.routes, attachmentUrl({ name: 'doc.pdf', mode: 'preview' })),
    )
    assert.equal(pdf.attachment.kind, 'pdf')
    assert.equal(pdf.attachment.mime, 'application/pdf')

    const binary = jsonBody(
      await callRoute(harness.routes, attachmentUrl({ name: 'data.bin', mode: 'preview' })),
    )
    assert.equal(binary.attachment.kind, 'binary')
    assert.equal(binary.attachment.mime, null)
    assert.equal(binary.attachment.text, undefined)
  } finally {
    await harness.cleanup()
  }
})

test('attachment route: inline streams images and PDF with safe headers', async () => {
  const harness = await makeHarness()
  try {
    const png = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'photo.png', mode: 'inline' }),
    )
    assert.equal(png.status, 200)
    assert.equal(png.headers['content-type'], 'image/png')
    assert.match(png.headers['content-disposition'], /^inline;/u)
    assert.equal(png.headers['x-content-type-options'], 'nosniff')
    assert.deepEqual(png.body, PNG)

    const pdf = await callRoute(harness.routes, attachmentUrl({ name: 'doc.pdf', mode: 'inline' }))
    assert.equal(pdf.headers['content-type'], 'application/pdf')
    assert.match(pdf.headers['content-disposition'], /^inline;/u)
    assert.deepEqual(pdf.body, PDF)

    const svg = await callRoute(harness.routes, attachmentUrl({ name: 'icon.svg', mode: 'inline' }))
    assert.equal(svg.headers['content-type'], 'image/svg+xml')
    assert.match(svg.headers['content-security-policy'], /script-src 'none'/u)
    assert.match(svg.headers['content-security-policy'], /object-src 'none'/u)
    assert.deepEqual(svg.body, SVG)
  } finally {
    await harness.cleanup()
  }
})

test('attachment route: inline refuses non-image/PDF and invalid input; missing is 404', async () => {
  const harness = await makeHarness()
  try {
    const text = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'report.md', mode: 'inline' }),
    )
    assert.equal(text.status, 415)
    assert.equal(jsonBody(text).code, 'unsupported-preview')

    const binary = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'data.bin', mode: 'inline' }),
    )
    assert.equal(binary.status, 415)

    const missing = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'nope.txt', mode: 'preview' }),
    )
    assert.equal(missing.status, 404)
    assert.equal(jsonBody(missing).code, 'not-found')

    const badMode = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'report.md', mode: 'nope' }),
    )
    assert.equal(badMode.status, 400)
    assert.equal(jsonBody(badMode).code, 'invalid-mode')

    const badSeq = await callRoute(
      harness.routes,
      attachmentUrl({ name: 'report.md', mode: 'preview', seq: 0 }),
    )
    assert.equal(badSeq.status, 400)
    assert.equal(jsonBody(badSeq).code, 'invalid-seq')
  } finally {
    await harness.cleanup()
  }
})
