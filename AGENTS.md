# AGENTS.md

本仓库是 DSH 插件市场：把 bundle 插件登记成一份 format 1 索引，DSH 用户在 **Plugins → Discover** 里添加索引地址即可浏览与安装。规则正文统一在 `docs/agent-rules/`；本文件只做索引，每条给出建议阅读时机。

- [项目结构](docs/agent-rules/project-structure.md)：新增插件、调整目录、判断某个文件该放哪前阅读。
- [索引格式](docs/agent-rules/index-format.md)：改 `market.json` / `locale`、动发布地址、排查「Discover 里看不到 / 装不上」前阅读。
- [插件编写规范](docs/agent-rules/plugin-authoring.md)：新增或修改 `plugins/**` 的源码、清单、补丁层前阅读。
- [常用命令](docs/agent-rules/commands.md)：构建、类型检查、校验、本地预览前阅读。
- [Git 操作约束](docs/agent-rules/git.md)：执行任何 git 命令前阅读。

## 硬约束

- **源码在 `src/`，`lib/` 是编译产物。** 插件源码写在 `plugins/<dir>/src/`（TypeScript，`strict` 全开），`plugins/<dir>/lib/` 由 `pnpm run build:code && pnpm run build:clients` 生成；`lib/` **提交进 git**，安装时用户机器上不编译。`packages/*/lib` 是例外：它是构建时的中间产物，gitignored，不提交。不要手改 `plugins/*/lib`、`packages/*/lib` 或 `.build/`。
- **改源码必须重建并提交产物。** 改完 `plugins/*/src` 或 `packages/*/src` 后跑 `pnpm run build:code && pnpm run build:clients`，把 `plugins/*/lib` 的改动一起提交。CI 会重跑这两步，并用 `git diff` / `git ls-files --others` 检查 `plugins/*/lib` 是否与源码一致。注意 `pnpm run build` 只生成市场索引，不编译插件。
- **共享逻辑进公共包，插件之间不互相 import。** 宿主侧共享工具（HTTP 路由、错误文案、原子写、`npx` 包装）进 `packages/plugin-kit`；界面侧共享组件与请求封装进 `packages/plugin-ui`。两个包都只在构建时内联进插件产物，不随插件发布。
- **文案只有一个来源。** 展示标题、简介写在 `plugins/*/locale/{en,zh}.json` 的 `meta`；长文写 `plugins/*/docs/DETAIL.md`（英文）与 `DETAIL.zh.md`（中文），由对应 locale 的 `meta.detail` 指向。`package.json` 的 `description` 只作 npm 元数据；插件目录的 `market.json` 只放挂牌字段。
- **索引由脚本生成，不手写。** 索引字段来自 `plugins/<dir>/package.json`、该插件的 `locale` 与 `market.json`，以及 git；不要往 `dist/` 里手填内容。`dist/` 与 `.build/` 都不进版本库。
- **首次工作先安装依赖。** 仓库现在有构建依赖，先跑 `pnpm install`。Node.js 要求 `>=22.20`，pnpm 版本见根 `package.json` 的 `packageManager`。

提交与推送由用户发起，见 [Git 操作约束](docs/agent-rules/git.md)。

## Agent skills

> 本节的 `docs/agents/*.md` 是工程技能的配置（issue tracker、标签、领域文档位置），不同于 `docs/agent-rules/` 里的本仓库协作规则。

### Issue tracker

Issue 记在 GitHub Issues（`buka-ltd/buka.dsh-plugin-marketplace`），用 `gh` CLI 读写。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色沿用默认标签字符串。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：根 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。
