# Buka 打工人

在侧边栏管理打工人：有明确职责、能独立处理任务的主体。打工人分两类：**智能体**（有目录、AGENTS.md、项目 skills，以 DSH 会话执行任务；由本插件创建、登记并挂载成工作区）与 **机器人**（固定程序，接收输入 → 产出输出，不建会话；v1 只有内建的 `clock`，只读、不可创建 / 删除）。带 `assistant: true` 标记的智能体是**助理**：工作流里的人任务点名某个助理后，只有该助理能认领并代人沟通。

页面列出打工人卡片（头像、名称、driver、挂载状态、项目 skills、助理、职责）。智能体可新开会话、挂载、重命名、删除、安装 / 移除项目 skills、编辑 AGENTS.md、设 / 取消助理、在「模型」页签选新会话使用的模型、换头像；机器人只读。列表可按「只看助理」筛选。新建打工人会建目录、写 AGENTS.md 模板、登记并挂载成工作区；安装插件还会多出显示名为「打工人」的 preset（id `worker-builder`），智能体问清职责后调用 `buka_worker_build` 创建或改名打工人。

登记表 `workers.json` 为 version 3：每条打工人有 `driver: "agent" | "robot"` 与 `assistant`，机器人另有 `program` id，智能体可带可选的 `model`（`{ provider, model, reasoningEffort? }`）。读 v1 旧表时自动补 `driver: "agent"`、`assistant: false`；v2 的 `driver: "program"` 读成 `"robot"`。下次写入落盘 version 3，打工人目录、AGENTS.md、skills 不动。`model` 只影响之后在这个打工人目录里新开的会话（页面「新会话」、从侧边栏打开工作区、工作流派发）；已有会话保留自己的模型选择，可以在会话里用 `/model` 切换。模型目录里暂时找不到的已保存选择会保留，等目录恢复后再显示。

插件本身从 `@buka/dsh-plugin-robots` 改名为 `@buka/dsh-plugin-workers`。启动时默认布局会把 `~/.cache/dsh-plugin-robots` 搬到 `~/.cache/dsh-plugin-workers`，把 `robots/` / `robots.json` 改成 `workers/` / `workers.json`，平移登记表里的目录路径，并把登记表升到 version 3；自定义 `workersDir` 时：把它指向旧的自定义目录（`.../robots`）就只把登记文件改名为 `workers.json` 并升级格式；指向同级的 `.../workers` 则连 `robots/` 与 `robots.json` 一起改名。它不知道别的旧目录在哪，也不该猜。旧插件是独立包：新插件挂好之后即可卸载旧插件。已经挂到 DSH 工作区的旧路径会随目录移动失效，迁移后在页面上重新点一次「挂载」即可；旧会话日志留在旧工作区历史里。

其他插件通过 `ctx.bukaWorkers` 服务使用打工人：`list()` 返回含 driver / assistant / program 的摘要，`avatarMap()` 返回头像，`dispatchSession()` 只开新会话、`openSession()` 只 resume 同一会话，句柄提供 `readResult` / `send` / `cancel` / `dispose` / `getPlanMode` / `setPlanMode`。一个任务一条新会话；不再有压缩、阻塞式 `startSession`、`outputSchema` / `routes` / `abortable` / 结果追问，任务结果由工作流的 `buka_task_complete` 收口。`planMode: true` 在投递第一轮 prompt 前对目标 agent 执行 `/plan`。

全新安装（登记表为空）时补两个可编辑的预设智能体「软件工程师」「质量保障工程师」。头像 id 是跨插件契约；项目 skills 落在 `<打工人目录>/.agents/skills` 与 `.claude/skills`；AGENTS.md 读取上限 256 KiB、保存上限 512 KiB，`CLAUDE.md` 自动做成指向它的相对符号链接。重命名会移动目录并重建 DSH 工作区，旧会话日志保留但不再列在这个打工人下。
