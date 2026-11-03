---
description: 索引 format 1 的字段、硬规则与托管要求
paths:
  - market.json
  - scripts/**
  - schemas/**
---

# 索引格式（format 1）

索引就是一个 JSON 文件，DSH 的 `pluginMarket` 服务拉取它、校验它，Discover 页与 `plugin_market` 工具都读它。格式的权威定义在 DSH 自带的 `@deepseek-ai/dsh-plugin-market-index`（`parseMarketIndex`），本仓库的 `scripts/lib/format.mjs` 是逐条对齐的副本：本地 `check` 先过一遍，发布后 DSH 再用官方实现过一遍。

## 托管要求

- 只接受 `http:`/`https:`，不能带账号密码、`?query`、`#fragment`
- **拒绝重定向**：`raw.githubusercontent.com` 的直链可以，需要 302 的地址不行
- 索引整体上限 128 MiB；单次请求超时 15 s；成功结果缓存 10 分钟
- 相对图标按**索引地址**解析，所以索引与 `icons/` 必须同源同目录发布

本仓库的发布地址写在根 `market.json` 的 `publicUrl`，默认：

```text
https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json
```

改地址时同时改 GitHub Pages 的站点路径，二者不一致会让图标 404。

## 顶层

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `format` | 是 | 固定 `1` |
| `title` | 是 | 索引标题，本地化文本 |
| `description` | 否 | 索引简介，本地化文本 |
| `metadata.categories` | 否 | `id → { title }`，插件用 `metadata.category` 引用 |
| `metadata.labels` | 否 | `id → { title }`，插件用 `metadata.labels` 引用 |
| `metadata.sortKeys` | 否 | `id → { title, order: asc｜desc }`，插件用 `metadata.sortKeys` 给数值 |
| `plugins` | 是 | 插件数组，包名不得重复 |

## 插件条目

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | npm 包名格式，全索引唯一 |
| `title` | 否 | 展示标题，本地化文本 |
| `description` | 否 | 展示简介，本地化文本 |
| `icon` | 否 | https 地址、索引同源的相对地址，或 ≤32 KiB 的 base64 data URL（SVG/PNG/JPEG/WebP） |
| `author` | 否 | 作者字符串 |
| `homepage` | 否 | http(s) 绝对地址，允许带 `#readme` |
| `repository` | 否 | `{ url, directory? }`，`directory` 是包在仓库里的相对目录 |
| `metadata.category` | 否 | 必须是已声明的分类 id |
| `metadata.labels` | 否 | 已声明的标签 id，不得重复 |
| `metadata.keywords` | 否 | 字符串数组，参与搜索加权 |
| `metadata.sortKeys` | 否 | `id → number`，id 必须已声明 |
| `versions` | 是 | 非空数组，版本号不得重复 |

## 版本条目

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 是 | 精确 SemVer（三段式，可带 prerelease/build） |
| `publishTimestamp` | 是 | Unix **秒**，整数，`[0, 10^11)` |
| `source` | 是 | `{ type: "npm", registry? }` 或 `{ type: "git", url, commit, path? }` |
| `engines.dsh` | 否 | 兼容的 DSH 版本 SemVer 范围，不接受 `workspace:` |

`source` 的细节：

- `npm` 的 `registry` 必须是规范的 http(s) 地址（不带凭据、query、fragment）
- `git` 的 `url` 必须是**规范**的 https 仓库地址（不能带 `.git` 之外的多余字符、不能是 tarball、至少两段路径），`commit` 是 40 位小写十六进制
- `path` 是仓库内的相对目录，不允许 `.`/`..` 段

## 会被直接拒绝的写法

- 语言 id 用了大写：`zh-CN` 不行，要写 `zh-cn`；对象形式必须含 `en`
- 同一索引里包名重复，或同一插件里版本号重复
- `publishTimestamp` 用毫秒、浮点数或 ISO 字符串
- `commit` 用了短 SHA 或大写
- 分类 / 标签 / `sortKeys` 引用了没声明的 id
- 图标指向非同源的 http 地址，或 inline 图标解码后超过 32 KiB
- `engines.dsh` 写成 `workspace:*`、`latest` 这类非范围

## 安装地址怎么拼

DSH 安装时用 `marketInstallTarget(name, version)` 生成 pnpm spec：

```text
npm：  @buka/dsh-plugin-hello@0.1.0
git：  git+https://github.com/buka-ltd/buka.dsh-plugin-marketplace.git#<40 位 commit>&path:/plugins/hello
```

所以本仓库的索引不需要先把插件发到 npm：`source` 指向本仓库的提交即可，`path` 指向包目录。

## 本仓库怎么生成

`scripts/lib/market.mjs` 逐插件读取，任何一栏都不是手写的：

| 索引字段 | 来源 |
| --- | --- |
| `name`、`version`、`engines.dsh` | `plugins/<dir>/package.json` |
| `title`、`description`、`icon`、`category`、`labels`、`keywords`、`author`、`homepage` | `plugins/<dir>/market.json` |
| `source.commit` | 该目录最后一次提交 `git log -1 --format=%H -- plugins/<dir>` |
| `publishTimestamp` | 同一次提交的 committer 时间（秒） |
| `repository` | `source.url` + `plugins/<dir>`，或在 `market.json` 覆盖 |
| `icon` 相对路径 | 复制到 `dist/icons/<dir>.<ext>`，索引里写相对地址 |

由此得到两条推论：

- 改完插件要**先提交再构建**，否则索引钉住的还是上一次提交
- 只想把插件留在仓库里不挂牌，在它的 `market.json` 写 `"listed": false`

## 交叉验证

本机装了 DSH 时，可以用**官方校验器**复核生成结果（`app.asar` 里的包只有 Electron 的 node 能读）：

```bash
pnpm run build
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals scripts/official-check.mjs dist/index.json
```

它读根 `market.json` 的 `publicUrl` 作为索引地址，打印官方实现算出的安装 spec。路径不同用 `DSH_APP_ASAR` 覆盖。

## 排查

| 现象 | 先看 |
| --- | --- |
| Discover 里加不上索引 | 地址是否 `https`、是否被重定向、有没有带 `?`/`#` |
| 列表是空的 | `format` 是否 `1`；`plugins` 是否为空；插件是否 `listed: false` |
| 装不上 | `source.commit` 是否真含该目录（`git cat-file -e <sha>:plugins/<dir>/package.json`）；`engines.dsh` 是否覆盖当前 DSH |
| 图标不显示 | `publicUrl` 与实际发布路径是否一致；图标是否被 `dist/icons/` 复制到 |
| 版本显示旧值 | 索引缓存 10 分钟；或插件目录的提交之后忘了重新构建发布 |
