# AGENTS.md

本仓库是 DSH 插件市场：把 bundle 插件登记成一份 format 1 索引，DSH 用户在 **Plugins → Discover** 里添加索引地址即可浏览与安装。规则正文统一在 `docs/agent-rules/`；本文件只做索引，每条给出建议阅读时机。

- [项目结构](docs/agent-rules/project-structure.md)：新增插件、调整目录、判断某个文件该放哪前阅读。
- [索引格式](docs/agent-rules/index-format.md)：改 `market.json`、动发布地址、排查「Discover 里看不到 / 装不上」前阅读。
- [插件编写规范](docs/agent-rules/plugin-authoring.md)：新增或修改 `plugins/**` 前阅读。
- [常用命令](docs/agent-rules/commands.md)：构建、校验、本地预览前阅读。
- [Git 操作约束](docs/agent-rules/git.md)：执行任何 git 命令前阅读。

## 三条硬约束

- `dist/` 是产物：不手改、不提交，改插件后重新 `pnpm run build`
- 索引里的字段只有两个来源：插件目录的 `package.json` 与 `market.json`；不要在脚本里塞特例
- `publishTimestamp` 与 `source.commit` 由 git 推出，不要手写时间戳或凭记忆填 commit

提交与推送由用户发起，见 [Git 操作约束](docs/agent-rules/git.md)。
