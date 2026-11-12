# Buka 机器人

在侧边栏管理机器人：有明确职责、能独立处理任务的主体。机器人分两类：**agent 型**（有目录、AGENTS.md、项目 skills，以 DSH 会话执行任务；由本插件创建、登记并挂载成工作区）与 **program 型**（固定程序，接收输入 → 产出输出，不建会话；v1 只有内建的 `clock`，只读、不可创建 / 删除）。带 `assistant: true` 标记的 agent 型机器人是**助理**：工作流里的人任务点名某个助理后，只有该助理能认领并代人沟通。

页面列出机器人卡片（头像、名称、driver、挂载状态、项目 skills、AGENTS.md、助理、职责）。agent 型可新开会话、挂载、重命名、删除、安装 / 移除项目 skills、编辑 AGENTS.md、设 / 取消助理、换头像；program 型只读。列表可按「只看助理」筛选。新建机器人会建目录、写 AGENTS.md 模板、登记并挂载成工作区；安装插件还会多出「机器人构建」模式，agent 问清职责后调用 `buka_robot_build` 创建或改名机器人。

登记表 `robots.json` 升级到 version 2：每条机器人新增 `driver: "agent" | "program"` 与 `assistant`，program 型另有 `program` id。读 v1 旧表时自动补 `driver: "agent"`、`assistant: false`，下次写入落盘；机器人目录、AGENTS.md、skills 不动。`clock` 由插件启动时幂等登记，不可创建、删除、改名或改字段。

其他插件通过 `ctx.bukaRobots` 服务使用机器人：`list()` 返回含 driver / assistant / program 的摘要，`avatarMap()` 返回头像，`dispatchSession()` 只开新会话、`openSession()` 只 resume 同一会话，句柄提供 `readResult` / `send` / `cancel` / `dispose` / `getPlanMode` / `setPlanMode`。一个任务一条新会话；不再有压缩、阻塞式 `startSession`、`outputSchema` / `routes` / `abortable` / 结果追问，任务结果由工作流的 `buka_task_complete` 收口。`planMode: true` 在投递第一轮 prompt 前对目标 agent 执行 `/plan`。

全新安装（登记表为空）时补两个可编辑的预设 agent 机器人「软件工程师」「质量保障工程师」。头像 id 是跨插件契约；项目 skills 落在 `<机器人目录>/.agents/skills` 与 `.claude/skills`；AGENTS.md 读取上限 256 KiB、保存上限 512 KiB，`CLAUDE.md` 自动做成指向它的相对符号链接。重命名会移动目录并重建 DSH 工作区，旧会话日志保留但不再列在这个机器人下。
