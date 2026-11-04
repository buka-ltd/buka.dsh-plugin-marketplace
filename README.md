# Buka DSH Plugin Marketplace

Buka Ltd 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件市场：把公司自己的插件登记成一份 **format 1 索引**（`index.json`），DSH 用户在 **Plugins → Discover** 里填一次索引地址，就能浏览、安装、卸载这些插件。

仓库里没有服务端：索引是构建产物，交给 GitHub Pages 静态托管；安装由 DSH 自己的 `pluginManager` 完成，直接指向本仓库某个提交里的包目录。

## 使用（DSH 用户）

1. 打开 Web 侧边栏的 **Plugins**
2. **More（Experimental plugins）** → 打开 **Custom plugin markets**
3. 切到 **Discover** → 添加索引来源，填：

   ```text
   https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json
   ```

4. 在列表里选插件 → Install。装完的插件出现在 **Installed** 页，可以停用或卸载。

索引地址必须能直连（DSH 拒绝重定向），也不能带账号密码或 `?query`。索引默认缓存 10 分钟，看到旧列表就等一会儿或刷新。

## 已登记插件

| 目录 | 插件 | 用途 |
| --- | --- | --- |
| [plugins/hello](plugins/hello) | `@buka/dsh-plugin-hello` | 冒烟模板：注册 `buka_hello` 工具，验证市场 → 安装 → composition 链路 |
| [plugins/bell](plugins/bell) | `@buka/dsh-plugin-bell` | 任务结束、或 DSH 停下来等你输入时播放系统提示音；声音可在 设置 → 提示音 里选择 |

## 仓库结构

```text
market.json                 # 索引自身的标题、分类、标签表、发布地址
plugins/<dir>/              # 一个插件一个目录
  package.json              # 包身份、engines.dsh、dsh.bundle.patch
  market.json               # 挂牌信息：标题、简介、图标、分类、标签、关键词
  cordis.patch.yml          # bundle 层：把自己插进 composition
  lib/index.js              # Cordis 插件：导出 name / inject / apply
  client.js                 # 浏览器一半（可选）：Web UI 入口，dsh.client 声明
  icon.svg                  # Discover 页图标
scripts/                    # 生成与校验索引，无第三方依赖
schemas/index.schema.json   # format 1 的 JSON Schema（编辑期提示）
docs/agent-rules/           # 本仓库的协作规则
dist/                       # 构建产物：index.json + icons/，不进版本库
```

## 命令

需要 Node.js 22.20 及以上；仓库本身没有依赖，不需要 `pnpm install`。

```bash
pnpm run check    # 发布前自检：清单、format 1、钉住的提交是否真的含插件
pnpm test         # 校验器与生成器的单测（node --test）
pnpm run build    # 生成 dist/index.json + dist/icons/
pnpm run serve    # 本地起 http 服务预览 dist/，默认 127.0.0.1:4180
```

> 第一次在空仓库里跑 `pnpm run check` 会报「目录还没有提交」：索引要钉住插件目录的提交，先提交再校验。这是唯一必须在 `check` 之前做的动作。

本地预览：

```bash
pnpm run build && pnpm run serve
# 把 http://127.0.0.1:4180/index.json 填进 Discover
```

## 新增一个插件

```bash
mkdir -p plugins/<dir>/lib
```

按 [plugins/hello](plugins/hello) 抄一份，然后：

1. `package.json` 的 `name` 用 `@buka/dsh-plugin-<dir>`，`version` 从 `0.1.0` 起
2. `engines.dsh` 写当前 DSH 的兼容范围，`dsh.bundle.patch` 指到 `./cordis.patch.yml`
3. `cordis.patch.yml` 用一行 `insert` 把自己作为一行插件插进 composition
4. `market.json` 补标题（必须含 `en`）、简介、图标、分类、标签、关键词
5. `pnpm run check` 通过后提交

细则见 [插件编写规范](docs/agent-rules/plugin-authoring.md)。

## 发布

推送到 `main` 后，`.github/workflows/market.yml` 会：校验 → 跑测试 → 生成 `dist/` → 部署到 GitHub Pages。

一次性配置：仓库 **Settings → Pages → Source** 选 **GitHub Actions**。发布地址与 `market.json` 的 `publicUrl` 必须一致，否则图标与相对地址会解析到错误的位置。

## 文档

- [AGENTS.md](AGENTS.md) — 协作规则的索引，改任何东西前先看
- [索引格式](docs/agent-rules/index-format.md) — format 1 的字段与硬规则、托管与缓存行为
- [插件编写规范](docs/agent-rules/plugin-authoring.md)
- [常用命令](docs/agent-rules/commands.md)
- [Git 操作约束](docs/agent-rules/git.md)
