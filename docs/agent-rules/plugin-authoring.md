---

description: 编写与发布 TypeScript 插件（bundle）
paths:

- plugins/**

---

# 插件编写规范

DSH 的插件就是 Cordis 插件；能被市场安装还要求它同时是一个 **bundle**——一个补丁层，声明自己往 composition 里插哪些行。本仓库只做登记与构建，不改 DSH 运行时。

插件用 TypeScript 写，源码在 `plugins/<dir>/src/`，编译产物在 `plugins/<dir>/lib/`。`lib/` 是随插件发布的运行文件，**必须提交进 git**；用户安装时机器上不会编译。

## 构建管线

```text
plugins/<dir>/src/**  --tsc -p-->  .build/<dir>/**  --tsdown-->  plugins/<dir>/lib/index.js
                                                                 └─ lib/client.js（套 ModuleLoader 外壳）
```

- `pnpm run build:code` 先编 `packages/*`、再编 `plugins/*`；中间产物在仓库根 `.build/`（gitignored）。顺序不能反：插件从公共包的 `lib/*.d.ts` 读类型。
- `pnpm run build:clients` 从 `.build/` 打包出 `plugins/<dir>/lib/index.js`（宿主一半，ESM）与 `lib/client.js`（界面一半，CJS + 外壳）。它每次清空并重建 `lib/`，不做增量。
- `pnpm run build` 只生成市场索引 `dist/`，**不编译插件**。改完源码不要只跑它。

## tsconfig

根 `tsconfig.base.json` 是基线：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`module` / `moduleResolution: NodeNext`、目标 `ES2024`、`allowImportingTsExtensions` 与 `rewriteRelativeImportExtensions`，并用 `paths` 把 `@deepseek-ai/*` 指到根 `node_modules`。TypeScript 7 已移除 `baseUrl`，`paths` 直接相对 `tsconfig.base.json` 解析。

插件自己的 `tsconfig.json` 只写差异：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "../../.build/<dir>",
    "tsBuildInfoFile": "../../.build/<dir>.tsbuildinfo"
  },
  "include": ["src", "../../types"]
}
```

- 插件源码里的相对导入写 `.ts` 后缀（例如 `./routes.ts`），`tsc` 会改写成 `.js`；`import type` 从 `types/dsh.js`（对应 `types/dsh.d.ts`）这类声明文件导入时沿用 `.js`。
- `include` 里的 `../../types` 让根 `types/dsh.d.ts` 参与编译；少了它，`ctx.slots` 之类的增强不存在。
- 不要给插件加 `paths` 或 `baseUrl` 的特例；公共类型统一从根解析。

## 入口：只装配

`plugins/<dir>/src/index.ts` 是宿主一半入口，只做装配：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { registerRoutes } from './routes.ts'

/** Cordis 插件名；与 cordis.patch.yml 的补丁行 id 保持一致。 */
export const name = 'tool-buka-example'

/** 依赖的 DSH 服务。 */
export const inject = ['webServer']

/** 装配：只连接模块，不写具体实现。 */
export function apply(ctx: Context): void {
  registerRoutes(ctx)
}
```

- `name` 与该插件补丁行的 `id` 保持一致；它出现在 composition 里。
- `inject` 只列真正依赖的服务；可选依赖在 `apply` / 工具调用时用 `ctx.get()` 取，取不到时按“收紧为不可用”处理。
- 需要可配置项时用 `@deepseek-ai/schemastery` 的 `z.object(...)` 导出 `Config`。只有 `.volatile()` 字段能被设置页热更新；普通字段改动会重载插件。参考 [plugins/bell](../../plugins/bell/src/index.ts)。
- 路由、服务、存储、工具定义都放旁边的模块（`routes.ts`、`service.ts`、`store.ts`、`tools.ts` 等）；入口只 import 与注册。
- `apply` 里不要做耗时初始化（网络、扫描大目录）；需要的话挂到事件或首次调用。

界面一半同理：`plugins/<dir>/src/client/index.ts` 只导出 `inject` 与 `apply`，页面、组件、状态、样式放 `src/client/` 下的模块。

## 界面一半与 ModuleLoader 外壳

只有 `package.json` 声明了 `dsh.client` 的插件才需要界面一半；没有声明时 `build-clients` 只产出 `lib/index.js`，跳过 `lib/client.js`。

源码里**不要**写 `window.__ModuleLoader__.load(...)`，也不要写死包名。`src/client/index.ts` 只导出：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  // 往插槽注册页面、注册词典与样式；具体组件从旁边模块导入。
}
```

构建时 `scripts/build-clients.ts` 把 tsdown 打出的 CJS 交给 [`scripts/lib/envelope.ts`](../../scripts/lib/envelope.ts)，生成：

```js
window.__ModuleLoader__.load({
  id: '<package.json 的 name>',
  factory: (require) => {
    /* CJS 产物；最后 return module.exports */
  },
})
```

- `id` 由构建脚本取 `package.json` 的 `name`，源码不感知。
- `factory` 收到的 `require` 只提供浏览器模块表里的基线模块。`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client` 与所有 `@deepseek-ai/*` 都保持 external，不打包进 `lib/client.js`。
- 浏览器一半通过 Cordis 服务拿能力：`ctx.slots` 注册插槽、`ctx.locale` 注册文案、`ctx.configForms` 读写 Host 的 volatile 配置。
- 模块顶层只放纯声明（常量、文案、样式、辅助函数）；注册插槽、发请求、碰 DOM 都放进 `apply(ctx)`。

## `package.json`

```jsonc
{
  "name": "@buka/dsh-plugin-<dir>",
  "version": "0.1.0",
  "description": "一句简短中文，仅作 npm 元数据。",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "icon": "./icon.svg",
  "files": ["lib", "cordis.patch.yml", "icon.svg", "locale/*.json", "docs"],
  "engines": {
    "node": ">=22.20",
    "dsh": ">=0.2.1-rc.5"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.1.0"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

- **包名与目录名绑定**：`plugins/<dir>` ↔ `@buka/dsh-plugin-<dir>`；`version` 必须是精确 SemVer。
- **`files` 用 `"lib"`**：一次覆盖 `lib/index.js` 与 `lib/client.js`；同时列上 `cordis.patch.yml`、`icon.svg`、`locale/*.json`、`docs`。有自带素材（例如 bell 的 `assets/voice.mp3`）时再加。
- **`dsh.bundle.patch` 必须存在**，否则 DSH 不会把它当 bundle 安装；值可以是单个路径，也可以是有序数组（多个补丁按顺序作为一个 bundle 层应用）。补丁路径与 `files` 都要能在发布包里找到。
- **`dsh.client` 决定有没有界面一半**：`platform: "web"` 表示浏览器模块；`immediately: true` 让界面一半随插件加载。没有界面一半就不要写这个字段。
- **`engines.dsh` 只写下限**，例如 `>=0.2.1-rc.5`。它单独决定兼容性；一旦声明，`peerDependencies` 里的 `@deepseek-ai/dsh*` 范围会被加载器忽略。不要写 `<0.3.0` 之类的上限（见 [ADR 0004](../adr/0004-兼容范围只写下限.md)）。
- **`@deepseek-ai/cordis` 的 peer 范围对齐 `~4.1.0`**（宿主实际是 4.1.0）。其他运行时 `@deepseek-ai/*`（例如 `dsh-tools`）按实际使用放进 `peerDependencies`，不要放进 `dependencies` 跟着发布。
- `dsh.manifestVersion: 1` 建议保留，但 DSH 不校验它；它只是自我说明，不能当兼容性依据。
- `dependencies` 只放插件真正需要、且 DSH 不提供的包（例如 `schemastery`）。开发依赖一律留在仓库根，不要写进插件清单，否则用户安装时会被迫装编译工具。

## 补丁层

一个“既是 bundle 又是插件”的包通常只需要一行：

```yaml
- insert:
    - id: tool-buka-example
      name: "@buka/dsh-plugin-example"
```

- `id` 在整个 composition 里唯一，建议用 `<用途>-<插件>`；插件入口的 `name` 与它保持一致，便于在 `--dump-config` 输出里检索。
- `name` 必须是包名，由 profile 的依赖解析；不要写相对路径或 `link:`。
- 需要改其他行的配置用 `config`；需要插多个插件就写多条。官方就是用同一个 bundle 同时插入 Host 服务与界面两行。
- 随插件发布 agent preset（新建会话时可选里的“模式”）时，再加一行 `name: '@deepseek-ai/dsh-agent-preset'`，`config.id` 是 preset 身份，`config.plugins` 列它挂的子插件，`config.name` / `config.description` 是界面上的名字与说明。参考 [plugins/robots](../../plugins/robots/cordis.patch.yml) 与 [plugins/workflows](../../plugins/workflows/cordis.patch.yml)。
- 补丁层只声明“有哪些行”，不声明“依赖哪些包”；依赖仍由 `package.json` 表达。

## 文案：locale 与 DETAIL

展示文案的唯一来源是 `plugins/<dir>/locale/{en,zh}.json` 的 `meta`：

```jsonc
{
  "meta": {
    "title": "Buka Example",
    "description": "一句到一段的市场简介。",
    "detail": "docs/DETAIL.md"
  }
}
```

- `en.json` 必须有；它是 format 1 索引强制要求的语言，也是缺省回退。
- 中文文件叫 `zh.json`，索引里映射成 `zh-cn`。两个文件都要有 `meta.title` 与 `meta.description`（非空字符串），`check` 会校验。
- `meta.detail` 指向插件包内的 Markdown 长文：英文写 `docs/DETAIL.md`，中文写 `docs/DETAIL.zh.md`，路径相对插件目录。`check` 会确认文件真实存在；`files` 要包含 `docs`，否则发布后详情页打不开。
- `package.json` 的 `description` 只作 npm 元数据，不参与市场展示；不要在这里重复长文案。
- 改文案只改 `locale`（短文案）或 `docs/DETAIL*.md`（长文），不要四处散写。

## market.json

`plugins/<dir>/market.json` 只放挂牌信息：

```jsonc
{
  "icon": "./icon.svg",
  "author": "Buka Ltd",
  "homepage": "https://github.com/buka-ltd/buka.dsh-plugin-marketplace/tree/main/plugins/<dir>",
  "category": "tools",
  "labels": ["beta"],
  "keywords": ["example", "示例"]
}
```

- 允许的字段：`listed`、`icon`、`author`、`homepage`、`repository`、`category`、`labels`、`keywords`、`sortKeys`。
- **不要写 `title` / `description`**：`check` 会把它们当作错误（展示文案只来自 locale，见 [ADR 0003](../adr/0003-locale-是文案唯一来源.md)）。
- `category` 与 `labels` 只能引用根 `market.json` 的 `metadata.categories` / `metadata.labels` 里声明过的 id；新增分类先改根 `market.json`。
- `keywords` 参与搜索加权，写用户会用来找的词（中英文都写）。
- 只想把插件留在仓库、暂时不上架：`"listed": false`。
- 这里不写版本、不写安装地址；它们由 `package.json` 与 git 推出。

## types/dsh.d.ts

DSH 官方包没有把全部宿主服务与客户端服务导出成类型，仓库根 `types/dsh.d.ts` 负责补：

- 给 `@deepseek-ai/cordis` 的 `Context` 增加 `webServer`、`connection`、`slots`、`locale`、`configForms`。
- 增加 `approval/request` 等本仓库实际监听的事件。
- 导出 `WebServerService`、`ConnectionService`、`SlotDefinition`、`ConfigFormsService`、`VolatileString` 等形状。

这个文件以**本仓库实际调用的 API** 为准，不追求覆盖上游全部字段；写错反而会掩盖问题。插件 `tsconfig.json` 的 `include` 已包含 `../../types`，增强自动生效；需要具体类型时按相对路径 `import type ... from '../../../types/dsh.js'`（从 `src/index.ts` 出发）或 `'../../../../types/dsh.js'`（从 `src/client/index.ts` 出发）。

只有某个插件独有的补充类型才放 `plugins/<dir>/src/dsh-extra.d.ts`；能在根 `types/dsh.d.ts` 覆盖的，不要复制到插件里。

## 模型工具

注册工具用 `@deepseek-ai/dsh-tools` 的 `defineTool`，四个必填部分：

- `name`：工具名，全局唯一，用小写下划线（`buka_example`）。
- `description`：给模型看的说明，写清“做什么 + 什么时候用”。
- `parameters`：属性名 → `{ type, description, required? }`；没有参数就写 `{}`。
- `output`：`{ schema, render }`；`schema` 的 `required: true` 写在属性对象里，`render` 把结构化结果转成对话里的文本。

要把工具只开放给随插件发布的 preset，用 `ctx.tools.register(tool, { when })`：`when` 收到 `{ agent }`，用 `ctx.get('sessions')` 拿到会话、再用 `ctx.get('agentPresets').presetForSession(session)` 读出它的 preset，只放行点名的 preset 根会话。写操作在 `sessions` / `agentPresets` 缺失时应**收紧为不可见**；`when` 之外还要在 `execute` 里再校验一次。参考 [plugins/workflows/src/access.ts](../../plugins/workflows/src/access.ts) 与 [plugins/robots/src/access.ts](../../plugins/robots/src/access.ts)。

## 发布前

1. `pnpm run build:code` 零错误、`pnpm run build:clients` 成功，`plugins/<dir>/lib/` 有更新并一起提交。
2. `pnpm test` 通过（`pretest` 会自动重跑 `build:code`）。
3. `pnpm run check` 通过（包名、bundle 声明、入口、`engines.dsh`、locale、钉住的提交等）。
4. `pnpm run build` 后用 `pnpm run serve` 在 Discover 里走一遍安装与卸载。
5. 在插件里调用一次自己的工具 / 打开一次页面，确认 `apply` 没有抛错。

版本号按改动类型递增：新增能力 `minor`，修 bug `patch`，改组合行为或配置语义 `major`。索引按提交钉住，发布后不要只改已发布版本的 `market.json` / `locale` 而不改版本——用户装到的就是那个提交。
