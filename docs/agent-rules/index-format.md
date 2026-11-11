---

description: 索引 format 1 的字段、硬规则与托管要求
paths:

- market.json
- plugins/*/market.json
- plugins/*/locale/**
- scripts/**
- schemas/**

---

# 索引格式（format 1）

索引就是一个 JSON 文件，DSH 的 `pluginMarket` 服务拉取它、校验它，Discover 页与 `plugin_market` 工具都读它。格式的权威定义在 DSH 自带的 `@deepseek-ai/dsh-plugin-market-index`（`parseMarketIndex`），本仓库的 [`scripts/lib/format.ts`](../../scripts/lib/format.ts) 是逐条对齐的副本：本地 `check` 先过一遍，发布后 DSH 再用官方实现过一遍。

## 托管要求

- 只接受 `http:` / `https:`，不能带账号密码、`?query`、`#fragment`
- DSH **拒绝重定向**：`raw.githubusercontent.com` 的直链可以，需要 302 的地址不行
- 索引整体上限 128 MiB；单次请求超时 15 s；成功结果缓存 10 分钟
- 相对图标按**索引地址**解析，所以索引与 `icons/` 必须同源同目录发布

本仓库的发布地址写在根 `market.json` 的 `publicUrl`，默认：

```text
https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json
```

改地址时同时改 GitHub Pages 的站点路径，二者不一致会让图标 404。

## 顶层

| 字段                  | 必填 | 说明                                                                  |
| --------------------- | ---- | --------------------------------------------------------------------- |
| `format`              | 是   | 固定 `1`                                                              |
| `title`               | 是   | 索引标题，本地化文本；来自根 `market.json`                            |
| `description`         | 否   | 索引简介，本地化文本；来自根 `market.json`                            |
| `metadata.categories` | 否   | `id → { title }`，插件用 `metadata.category` 引用                     |
| `metadata.labels`     | 否   | `id → { title }`，插件用 `metadata.labels` 引用                       |
| `metadata.sortKeys`   | 否   | `id → { title, order: asc｜desc }`，插件用 `metadata.sortKeys` 给数值 |
| `plugins`             | 是   | 插件数组，包名不得重复                                                |

根 `market.json` 只允许这些字段：`title`、`description`、`publicUrl`、`packageScope`、`packagePrefix`、`metadata`。多写的字段 `check` 会报警告。

## 插件条目

| 字段                | 必填 | 说明                                                                                                       |
| ------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `name`              | 是   | npm 包名格式，全索引唯一；来自插件 `package.json`                                                          |
| `title`             | 否   | 展示标题，本地化文本；**由 `locale` 的 `meta.title` 生成**                                                 |
| `description`       | 否   | 展示简介，本地化文本；**由 `locale` 的 `meta.description` 生成**                                           |
| `icon`              | 否   | https 地址、索引同源的相对地址，或 ≤32 KiB 的 base64 data URL（SVG/PNG/JPEG/WebP）；来自插件 `market.json` |
| `author`            | 否   | 作者字符串；来自 `market.json`                                                                             |
| `homepage`          | 否   | http(s) 绝对地址，允许带 `#readme`；来自 `market.json`                                                     |
| `repository`        | 否   | `{ url, directory? }`；默认由 `source.url` + `plugins/<dir>` 生成，可在 `market.json` 覆盖                 |
| `metadata.category` | 否   | 必须是根 `market.json` 已声明的分类 id                                                                     |
| `metadata.labels`   | 否   | 已声明的标签 id，不得重复                                                                                  |
| `metadata.keywords` | 否   | 字符串数组，参与搜索加权                                                                                   |
| `metadata.sortKeys` | 否   | `id → number`，id 必须已声明                                                                               |
| `versions`          | 是   | 非空数组，版本号不得重复；当前每个插件只生成一个版本                                                       |

插件的 `title` / `description` 不在 `plugins/<dir>/market.json` 里维护；它们由该插件的 `locale/en.json` 与 `locale/zh.json` 生成（`zh` 在索引里写 `zh-cn`）。`check` 会拒绝挂牌文件里的 `title` / `description`，见 [ADR 0003](../adr/0003-locale-是文案唯一来源.md)。

## 版本条目

| 字段               | 必填 | 说明                                                                     |
| ------------------ | ---- | ------------------------------------------------------------------------ |
| `version`          | 是   | 精确 SemVer（三段式，可带 prerelease/build）；来自 `package.json`        |
| `publishTimestamp` | 是   | Unix **秒**，整数，`[0, 10^11)`；取插件目录最后一次提交的 committer 时间 |
| `source`           | 是   | `{ type: "npm", registry? }` 或 `{ type: "git", url, commit, path? }`    |
| `engines.dsh`      | 否   | 兼容的 DSH 版本 SemVer 范围，不接受 `workspace:`；来自 `package.json`    |

`source` 的细节：

- `npm` 的 `registry` 必须是规范的 http(s) 地址（不带凭据、query、fragment）
- `git` 的 `url` 必须是**规范**的 https 仓库地址（不能带 `.git` 之外的多余字符、不能是 tarball、至少两段路径），`commit` 是 40 位小写十六进制
- `path` 是仓库内的相对目录，不允许 `.` / `..` 段

本仓库的生成器目前只产出 `git` 来源：`url` 取 `origin`（或 `DSH_MARKET_SOURCE_URL` / `--source-url`），`commit` 取插件目录最后一次提交，`path` 是 `plugins/<dir>`。format 1 仍然接受 `npm`，只是本仓库不用。

## 会被直接拒绝的写法

- 语言 id 用了大写：`zh-CN` 不行，要写 `zh-cn`；对象形式必须含 `en`
- 同一索引里包名重复，或同一插件里版本号重复
- `publishTimestamp` 用毫秒、浮点数或 ISO 字符串
- `commit` 用了短 SHA 或大写
- 分类 / 标签 / `sortKeys` 引用了没声明的 id
- 图标指向非同源的 http 地址，或 inline 图标解码后超过 32 KiB
- `engines.dsh` 写成 `workspace:*`、`latest` 这类非范围
- 插件 `market.json` 里出现 `title` / `description`（展示文案只来自 `locale`）
- 插件缺少 `locale/{en,zh}.json`，或 `meta.title` / `meta.description` 为空
- `meta.detail` 指向的文件在插件目录里不存在

未定义的字段不会被校验器拒绝，但 `check` 会报警告：根 `market.json` 与插件 `market.json` 都有字段白名单，避免拼错后静默失效。

## 安装地址怎么拼

DSH 安装时用 `marketInstallTarget(name, version)` 生成 pnpm spec：

```text
npm：  @buka/dsh-plugin-bell@0.6.0
git：  git+https://github.com/buka-ltd/buka.dsh-plugin-marketplace.git#<40 位 commit>&path:/plugins/bell
```

所以本仓库的索引不需要先把插件发到 npm：`source` 指向本仓库的提交即可，`path` 指向包目录。

## 本仓库怎么生成

[`scripts/lib/market.ts`](../../scripts/lib/market.ts) 逐插件读取，任何一栏都不是手写的：

| 索引字段                                                                   | 来源                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `name`、`version`、`engines.dsh`                                           | `plugins/<dir>/package.json`                                    |
| `title`、`description`                                                     | `plugins/<dir>/locale/{en,zh}.json` 的 `meta`（`zh` → `zh-cn`） |
| `icon`、`author`、`homepage`、`category`、`labels`、`keywords`、`sortKeys` | `plugins/<dir>/market.json`                                     |
| `source.commit`                                                            | 该目录最后一次提交 `git log -1 --format=%H -- plugins/<dir>`    |
| `publishTimestamp`                                                         | 同一次提交的 committer 时间（秒）                               |
| `repository`                                                               | `source.url` + `plugins/<dir>`，或在 `market.json` 覆盖         |
| `icon` 相对路径                                                            | 复制到 `dist/icons/<dir>.<ext>`，索引里写相对地址               |

由此得到几条推论：

- 改完插件要**先提交再构建**，否则索引钉住的还是上一次提交。
- 只想把插件留在仓库里不挂牌，在它的 `market.json` 写 `"listed": false`；它不会进索引，但 `check` 仍会校验它的 `locale`。
- 改展示文案只改 `locale`（短文案）或 `docs/DETAIL*.md`（长文），不要改 `market.json` 的标题 / 简介。
- 根 `market.json` 的 `publicUrl` 决定索引地址与图标解析基准；改发布地址要同时改这里和 Pages 配置。

## `check.ts` 具体查什么

`pnpm run check` 会依次：

1. 用 `loadMarket` 生成索引，收集清单类问题：包名与目录名、`version` 是否精确 SemVer、`dsh.bundle.patch` 是否存在、`main` / `exports["."]` 入口是否存在、`engines.dsh` 是否合法、`files` 是否包含 `lib` 与 `cordis.patch.yml`、`market.json` 指向的本地 `icon` 是否存在、目录是否已提交。
2. 检查仓库文件：根 `market.json` 与 `schemas/index.schema.json` 是否存在、能否解析；根 `market.json` 是否有未定义字段。
3. 检查插件 `market.json` 的字段白名单；`title` / `description` 报错误，其他未定义字段报警告。
4. 检查每个插件的 `locale/{en,zh}.json`：`meta.title` / `meta.description` 必须是非空字符串；`meta.detail` 若存在，指向的文件必须存在。
5. 检查钉住的 `commit` 真的含 `plugins/<dir>/package.json`（浅克隆请用 `fetch-depth: 0`）。
6. 用 `parseMarketIndex` 再校验生成结果，并检查 inline 图标不超过 32 KiB。
7. 如果本地存在 `dist/index.json`，提示它是否与当前仓库一致（发布前重新 `pnpm run build`）。

## 交叉验证

本机装了 DSH 时，可以用**官方校验器**复核生成结果（`app.asar` 里的包只有 Electron 的 node 能读）：

```bash
pnpm run build
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals scripts/official-check.ts dist/index.json
```

它读根 `market.json` 的 `publicUrl` 作为索引地址，打印官方实现算出的安装 spec。路径不同用 `DSH_APP_ASAR` 覆盖，或用 `DSH_MARKET_INDEX_PACKAGE` 直接指定官方包入口。

## 排查

| 现象                    | 先看                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Discover 里加不上索引   | 地址是否 `https`、是否被重定向、有没有带 `?` / `#`                                                                   |
| 列表是空的              | `format` 是否 `1`；`plugins` 是否为空；插件是否 `listed: false`                                                      |
| 装不上                  | `source.commit` 是否真含该目录（`git cat-file -e <sha>:plugins/<dir>/package.json`）；`engines.dsh` 是否覆盖当前 DSH |
| 标题 / 简介是旧的或为空 | 改的是不是 `locale/{en,zh}.json`；`meta.title` / `meta.description` 是否非空；重新 `pnpm run build`                  |
| 详情页打不开            | `meta.detail` 指向的文件是否存在；`files` 是否包含 `docs`                                                            |
| 图标不显示              | `publicUrl` 与实际发布路径是否一致；图标是否被 `dist/icons/` 复制到                                                  |
| 版本显示旧值            | 索引缓存；或插件目录的提交之后忘了重新构建发布                                                                       |
