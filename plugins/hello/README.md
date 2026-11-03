# @buka/dsh-plugin-hello

市场里的第一个插件，也是新插件的模板：注册一个 `buka_hello` 工具，除了问候语只返回市场仓库地址，没有任何副作用。

它存在的意义是**冒烟**：能装上、能在 composition 里出现、能让模型调用成功，说明这条链路是通的：

```text
插件目录 → pnpm run build 生成 index.json → DSH 的 Discover 读取 → installBundle 安装
→ cordis.patch.yml 插入插件行 → apply() 注册工具
```

## 安装

在 DSH 里：**Plugins → More（Experimental plugins）→ 打开 Custom plugin markets → Discover → 添加索引来源**，填本仓库发布的索引地址（见根目录 README）。

装好后让模型调用 `buka_hello`，返回里带 `marketplace` 字段即成功。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch` 声明它是 bundle |
| `cordis.patch.yml` | bundle 层唯一的一行：把自己作为 `tool-buka-hello` 插入组成 |
| `lib/index.js` | Cordis 插件：导出 `name` / `inject` / `apply`，用 `defineTool` 注册工具 |
| `market.json` | 只在市场上挂牌用的展示信息，不随包发布 |
| `icon.svg` | Discover 页图标，构建时复制到 `dist/icons/` |

## 拷贝这份模板

1. `plugins/<dir>/` 换成新目录，`package.json` 的 `name` 改为 `@buka/dsh-plugin-<dir>`
2. `cordis.patch.yml` 的 `id` 与 `name` 同步改
3. 版本从 `0.1.0` 开始，`engines.dsh` 按当前 DSH 版本调整
4. `market.json` 补标题、简介、分类、标签、关键词、图标
5. `pnpm run check` 通过后再提交，详见 [插件编写规范](../../docs/agent-rules/plugin-authoring.md)
