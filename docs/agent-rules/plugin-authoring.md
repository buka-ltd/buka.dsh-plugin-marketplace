---
description: 编写与发布 DSH 插件（bundle）
paths:
  - plugins/**
---

# 插件编写规范

DSH 的插件就是 Cordis 插件；能被市场安装还要求它同时是一个 **bundle**——一个补丁层，声明自己往 composition 里插哪些行。本仓库只做登记与构建，不改 DSH 运行时。

## 一个插件的最小构成

| 文件 | 必须 | 作用 |
| --- | --- | --- |
| `package.json` | 是 | 包身份；`dsh.bundle.patch` 让它成为 bundle |
| `cordis.patch.yml` | 是 | 补丁层：把自己（或依赖的插件）插进 composition |
| `lib/index.js` | 是 | 插件入口，导出 `name` / `inject` / `apply` |
| `market.json` | 是 | 挂牌信息，不随包发布 |
| `icon.svg` | 否 | Discover 页图标，构建时进 `dist/icons/` |

`package.json` 里与 DSH 相关的字段：

```jsonc
{
  "name": "@buka/dsh-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "engines": { "node": ">=22.20", "dsh": ">=0.2.1-rc.5 <0.3.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.5",
    "@deepseek-ai/dsh-tools": ">=0.2.1-rc.5 <0.3.0"
  },
  "dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- `engines.dsh` 是**安装前**的准入检查：不覆盖当前 DSH 版本会被拒绝，所以宁可写宽一点，不要写成精确版本
- `peerDependencies` 只声明运行时提供的包（`@deepseek-ai/*`），不要写进 `dependencies` 跟着发布
- `dsh.bundle.patch` 可以是单个路径，也可以是有序数组（多个补丁按顺序作为一个 bundle 层应用）
- 包名与目录名绑定：`plugins/<dir>` ↔ `@buka/dsh-plugin-<dir>`

## 补丁层

一个「既是 bundle 又是插件」的包只需要一行：

```yaml
- insert:
    - id: tool-buka-hello
      name: '@buka/dsh-plugin-hello'
```

- `id` 在整个 composition 里唯一，用 `<用途>-<插件>` 的形式，便于在 `--dump-config` 输出里检索
- `name` 必须是包名，由 profile 的依赖解析；不要写相对路径或 `link:`
- 需要改其他行的配置用 `config`；需要插多个插件就写多条（官方就是用一个 bundle 插 Host 服务与 UI 两行）
- 补丁层只能声明「有哪些行」，不能声明「依赖哪些包」；依赖仍由 `package.json` 表达

## 插件入口

```js
export const name = 'tool-buka-hello'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({ /* ... */ }))
}
```

注册工具用 `@deepseek-ai/dsh-tools` 的 `defineTool`，四个必填部分：

- `name`：工具名，全局唯一，用小写下划线（`buka_hello`）
- `description`：给模型看的说明，写清「做什么 + 什么时候用」
- `parameters`：属性名 → `{ type, description, required? }`；没有参数就写 `{}`
- `output`：`{ schema, render }`，`schema` 的 `required: true` 写在属性对象里，`render` 把结构化结果转成对话里的文本

`apply` 里不要做耗时初始化（网络、扫描大目录）；需要的话挂在事件或首次调用时做，避免拖慢 DSH 启动。

## market.json

```jsonc
{
  "title": { "en": "Buka Hello", "zh-cn": "Buka 问候" },
  "description": { "en": "...", "zh-cn": "..." },
  "icon": "./icon.svg",
  "author": "Buka Ltd",
  "homepage": "https://github.com/buka-ltd/buka.dsh-plugin-marketplace/tree/main/plugins/hello",
  "category": "tools",
  "labels": ["stable"],
  "keywords": ["hello", "example"]
}
```

- 语言 id 全小写，`en` 必须存在
- `category` 与 `labels` 只能引用根 `market.json` 里声明过的 id；新增分类先改根 `market.json`
- `keywords` 参与搜索加权，写用户会用来找的词（中英文都写）
- 只想把插件留在仓库、暂时不上架：`"listed": false`
- 这里**不写**版本、不写安装地址：它们由 `package.json` 与 git 推出

## 发布前

1. `pnpm run check` 通过（含包名、bundle 声明、入口文件、`engines.dsh`、提交是否含该目录）
2. `pnpm run build` 后用 `pnpm run serve` 在 Discover 里走一遍安装与卸载
3. 在插件里调用一次自己的工具，确认 `apply` 没有抛错
4. 提交插件目录（`dist/` 是产物，不进版本库），发布由 CI 在 `main` 上完成

版本号按改动类型递增：新增能力 `minor`，修 bug `patch`，改组合行为或配置语义 `major`。发布后不要改已发布版本的 `market.json` 而不改版本——索引按提交钉住，用户装到的就是那个提交。
