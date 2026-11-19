# Buka Skills

在侧边栏新增「Skills」页面，顶部两个 Tab：已安装列出对所有会话生效的全局 skills，标出哪些由 `skills` 库管理，并可以检查更新、应用更新（只应用 `update`；`modified` 默认跳过，旧 Claude Code marketplace 安装显示 `unsupported-source`）；收藏用来记下常用的 skill 来源（owner/repo、GitHub/GitLab 链接、任意 git 地址、本地绝对路径、包名；包名可收藏但不能展开），点「刷新」旁边的「收藏」按钮填写仓库与备注，可删除收藏，并在卡片上标出「标准 npx 仓库」或「不可用」。

只有仓库根 `skills/` 下（允许任意层级子目录）的 `SKILL.md` 算可安装来源；根 `SKILL.md`、`.claude/skills` 等 agent 目录与 Claude Code marketplace 都不认。所有收藏来源（包括 GitHub）都读到本地浅克隆缓存再扫描，GitHub 不再调用 API 列树；刷新克隆失败时保留旧克隆并给出警告。

树里每个 skill、或目录行的「全部安装」，都能安装到全局（走 `skills` 库 API，lock 里保留原始来源）、某个执行者（`.agents/skills` 与 `.claude/skills`）或某个已注册工作区（`.agents/skills`）。安装 / 卸载 / 更新共用一条串行队列；`ctx.bukaSkills` Host 服务把收藏仓库、仓库里的 skills 与按目录检查 / 更新的能力开放给其他插件，workers 页面因此可以更新单个执行者或按顺序更新全部执行者。插件把 `skills@1.9.0` 固定为运行时依赖，全程不再 spawn `npx`，库与 CLI 调用都关闭遥测。
