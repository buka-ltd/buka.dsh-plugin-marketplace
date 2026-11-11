#!/usr/bin/env node
/**
 * 把 `dist/` 以 http 服务器的方式暴露出来，供 DSH 的 Discover 页填写索引地址。
 * DSH 拒绝重定向与 file:，所以本地预览必须走 http。
 * 用法：pnpm run serve [--port 4180] [--dir dist]
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
}

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4180' },
    host: { type: 'string', default: '127.0.0.1' },
    dir: { type: 'string', default: 'dist' },
  },
  allowPositionals: false,
})

const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`--port 需要 1..65535 的整数，收到 ${values.port}`)
  process.exit(1)
}

const rootDir = path.resolve(values.dir)
if (!existsSync(path.join(rootDir, 'index.json'))) {
  console.error(`${path.relative(process.cwd(), rootDir)}/index.json 不存在，先跑 pnpm run build`)
  process.exit(1)
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const pathname = url.pathname === '/' ? '/index.json' : decodeURIComponent(url.pathname)
  const target = path.resolve(rootDir, `.${pathname}`)
  if (target !== rootDir && !target.startsWith(`${rootDir}${path.sep}`)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('forbidden')
    return
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`not found: ${pathname}`)
    return
  }
  response.writeHead(200, {
    'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  createReadStream(target).pipe(response)
})

server.listen(port, values.host, () => {
  const indexUrl = `http://${values.host}:${port}/index.json`
  console.log(`索引地址：${indexUrl}`)
  console.log(
    '在 DSH 里：Plugins → More（Experimental plugins）→ 打开 Custom plugin markets → Discover → 添加索引来源，粘贴上面的地址。',
  )
  console.log('预览的是 dist/，改完插件记得重新跑 pnpm run build。')
})
