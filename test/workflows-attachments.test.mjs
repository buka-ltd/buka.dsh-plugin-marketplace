/**
 * 工作流节点附件的纯逻辑与落盘复制：输入规范化、文件名清洗、路径边界、
 * 文本/二进制识别与分段读取。
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  attachmentPreviewInfo,
  DEFAULT_PREVIEW_TEXT_BYTES,
  normalizeAttachmentRequests,
  readAttachmentRange,
  readInlineText,
  sanitizeAttachmentName,
  writeAttachments,
} from '../plugins/workflows/src/attachments.ts'

/**
 * @returns {Promise<{ root: string, workspace: string, run: string, destination: string }>}
 */
async function makePaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-attachments-'))
  const workspace = path.join(root, 'workspace')
  const run = path.join(root, 'run')
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(run, { recursive: true })
  return { root, workspace, run, destination: path.join(run, 'nodes', '1-dev', 'attachments') }
}

test('attachments: normalize accepts strings and objects and rejects malformed input', () => {
  assert.deepEqual(
    normalizeAttachmentRequests([
      'notes/a.md',
      { path: 'notes/b.pdf', name: ' report.pdf ', description: '  details  ' },
    ]),
    [{ path: 'notes/a.md' }, { path: 'notes/b.pdf', name: 'report.pdf', description: 'details' }],
  )
  assert.deepEqual(normalizeAttachmentRequests(undefined), [])
  assert.throws(() => normalizeAttachmentRequests({ path: 'a' }), /must be an array/)
  assert.throws(() => normalizeAttachmentRequests([null]), /attachments\[0\]/)
  assert.throws(() => normalizeAttachmentRequests(['']), /non-empty file path/)
  assert.throws(
    () => normalizeAttachmentRequests([{ path: 'a', name: 3 }]),
    /name must be a string/,
  )
  assert.throws(() => normalizeAttachmentRequests(['a', 'b', 'c'], { maxCount: 2 }), /at most 2/)
})

test('attachments: names are sanitized to a single safe segment', () => {
  assert.equal(sanitizeAttachmentName('../报告.md'), '报告.md')
  assert.equal(sanitizeAttachmentName('..'), 'attachment')
  assert.equal(sanitizeAttachmentName('a/b\\c.txt'), 'c.txt')
  assert.equal(sanitizeAttachmentName('  '), 'attachment')
  assert.equal(sanitizeAttachmentName('report.md', '/tmp/fallback.txt'), 'report.md')
  assert.equal(sanitizeAttachmentName('', '/tmp/fallback.txt'), 'fallback.txt')
})

test('attachments: copies files, dedupes names and records sizes', async () => {
  const paths = await makePaths()
  try {
    await fs.mkdir(path.join(paths.workspace, 'notes'), { recursive: true })
    await fs.writeFile(path.join(paths.workspace, 'notes', 'a.md'), 'A', 'utf8')
    await fs.writeFile(path.join(paths.workspace, 'notes', 'b.bin'), Buffer.from([0, 1, 2]))
    const manifest = await writeAttachments({
      raw: ['notes/a.md', { path: 'notes/b.bin', name: 'a.md', description: 'collision' }],
      workspace: paths.workspace,
      runDirectory: paths.run,
      destination: paths.destination,
    })
    assert.deepEqual(manifest, [
      { index: 0, name: 'a.md', bytes: 1 },
      { index: 1, name: 'a-2.md', bytes: 3, description: 'collision' },
    ])
    assert.equal(await fs.readFile(path.join(paths.destination, 'a.md'), 'utf8'), 'A')
    assert.equal((await fs.stat(path.join(paths.destination, 'a-2.md'))).size, 3)
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true })
  }
})

test('attachments: rejects missing, directory, outside and symlink-escape sources', async () => {
  const paths = await makePaths()
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'buka-workflows-attachments-outside-'))
  try {
    await fs.mkdir(path.join(paths.workspace, 'dir'), { recursive: true })
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8')
    await fs.writeFile(path.join(paths.root, 'secret.txt'), 'secret', 'utf8')
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(paths.workspace, 'link.txt'))
    const options = {
      workspace: paths.workspace,
      runDirectory: paths.run,
      destination: paths.destination,
    }
    await assert.rejects(
      () => writeAttachments({ ...options, raw: ['missing.txt'] }),
      /not readable/,
    )
    await assert.rejects(() => writeAttachments({ ...options, raw: ['dir'] }), /not a regular file/)
    await assert.rejects(
      () => writeAttachments({ ...options, raw: [path.join(outside, 'secret.txt')] }),
      /outside the robot workspace/,
    )
    await assert.rejects(
      () => writeAttachments({ ...options, raw: ['link.txt'] }),
      /outside the robot workspace/,
    )
    await assert.rejects(
      () => writeAttachments({ ...options, raw: ['../secret.txt'] }),
      /outside the robot workspace/,
    )
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('attachments: enforces per-file, total and count limits and cleans partial output', async () => {
  const paths = await makePaths()
  try {
    await fs.writeFile(path.join(paths.workspace, 'big.bin'), Buffer.alloc(10))
    const options = {
      workspace: paths.workspace,
      runDirectory: paths.run,
      destination: paths.destination,
      maxBytes: 4,
    }
    await assert.rejects(() => writeAttachments({ ...options, raw: ['big.bin'] }), /too large/)
    assert.equal(
      await fs.stat(paths.destination).then(
        () => true,
        () => false,
      ),
      false,
    )
    await assert.rejects(
      () =>
        writeAttachments({
          ...options,
          maxBytes: 20,
          maxTotalBytes: 4,
          raw: ['big.bin'],
        }),
      /total size limit/,
    )
    await assert.rejects(
      () =>
        writeAttachments({
          ...options,
          maxBytes: 20,
          maxCount: 1,
          raw: ['big.bin', 'big.bin'],
        }),
      /at most 1/,
    )
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true })
  }
})

test('attachments: text reads detect UTF-8, binary, truncation and offsets', async () => {
  const paths = await makePaths()
  try {
    await fs.writeFile(path.join(paths.workspace, 'text.txt'), '你好世界', 'utf8')
    await fs.writeFile(path.join(paths.workspace, 'binary.bin'), Buffer.from([0, 1, 2, 255]))
    const text = path.join(paths.workspace, 'text.txt')
    const binary = path.join(paths.workspace, 'binary.bin')
    assert.deepEqual(await readInlineText(text, 64), {
      available: true,
      text: '你好世界',
      bytes: Buffer.byteLength('你好世界'),
    })
    assert.equal((await readInlineText(text, 2)).available, false)
    assert.equal((await readInlineText(binary, 64)).available, false)
    const range = await readAttachmentRange(text, { maxBytes: 3 })
    assert.equal(range.text, '你')
    assert.equal(range.truncated, true)
    assert.equal(range.read, 3)
    const binaryRange = await readAttachmentRange(binary)
    assert.equal(binaryRange.binary, true)
    assert.equal(binaryRange.text, null)
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true })
  }
})

test('attachments: preview info maps only whitelisted image/pdf extensions inline', () => {
  assert.equal(DEFAULT_PREVIEW_TEXT_BYTES, 64 * 1024)
  assert.deepEqual(attachmentPreviewInfo('photo.PNG'), { kind: 'image', mime: 'image/png' })
  assert.deepEqual(attachmentPreviewInfo('scan.jpeg'), { kind: 'image', mime: 'image/jpeg' })
  assert.deepEqual(attachmentPreviewInfo('anim.gif'), { kind: 'image', mime: 'image/gif' })
  assert.deepEqual(attachmentPreviewInfo('pixel.webp'), { kind: 'image', mime: 'image/webp' })
  assert.deepEqual(attachmentPreviewInfo('icon.svg'), { kind: 'image', mime: 'image/svg+xml' })
  assert.deepEqual(attachmentPreviewInfo('doc.pdf'), { kind: 'pdf', mime: 'application/pdf' })
  // 大小写、无扩展名与其它扩展名都退回文本嗅探。
  assert.deepEqual(attachmentPreviewInfo('README.MD'), { kind: 'text', mime: 'text/plain' })
  assert.deepEqual(attachmentPreviewInfo('no-extension'), { kind: 'text', mime: 'text/plain' })
  assert.deepEqual(attachmentPreviewInfo('archive.zip'), { kind: 'text', mime: 'text/plain' })
  assert.deepEqual(attachmentPreviewInfo(undefined), { kind: 'text', mime: 'text/plain' })
})
