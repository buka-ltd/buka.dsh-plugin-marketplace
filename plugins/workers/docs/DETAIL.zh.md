# Buka 打工人

在侧边栏管理打工人：有明确职责、能独立处理任务的主体。打工人分两类：**智能体**（有目录、AGENTS.md、项目 skills，以 DSH 会话执行任务；由本插件创建、登记并挂载成工作区）与 **机器人**（固定程序，接收输入 → 产出输出，不建会话；v1 只有内建的 `clock`，只读、不可创建 / 删除）。带 `assistant: true` 标记的智能体是**助理**：工作流里的人任务点名某个助理后，只有该助理能认领并代人沟通。

每个打工人都有不可变标识符（`id`）与可选展示名（`name`）。标识符是工作流的引用键，也是目录名（`workers/<id>`）：创建时指定、之后不可修改。名称只用于展示，可随时改、不要求唯一；为空时显示标识符。列表、详情与对话框同时显示「名称 · id」，用来区分同名打工人。

页面列出打工人卡片（头像、名称 · id、driver、挂载状态、项目 skills、助理、职责）。智能体可新开会话、挂载、改名（只改展示名）、删除、安装 / 移除项目 skills、编辑 AGENTS.md、设 / 取消助理、在「模型」页签选新会话使用的模型、换头像；机器人只读。列表可按「只看助理」筛选。新建打工人要求填必填的标识符与可选的展示名，会按标识符建目录、写 AGENTS.md 模板、登记并挂载成工作区；安装插件还会多出显示名为「打工人」的 preset（id `worker-builder`），智能体问清职责后调用 `buka_worker_build`，用批准过的标识符创建或更新打工人。

登记表 `workers.json` 为 version 4：每条打工人有不可变 `id`、可选 `name`（空串表示未设置）、`driver: "agent" | "robot"` 与 `assistant`，机器人另有 `program` id，智能体可带可选的 `model`（`{ provider, model, reasoningEffort? }`）。新标识符匹配 `^[a-z][a-z0-9_-]{0,63}$`。读 v1 / v2 / v3 旧表时在内存里迁移：`id` 取旧 `name`、`name` 置空，所以迁移来的旧标识符（可能含汉字、大写或 `.`）仍可用于更新、改名与删除；v2 的 `driver: "program"` 读成 `"robot"`，v1 条目自动补 `driver: "agent"`、`assistant: false`。下次写入落盘 version 4，打工人目录、AGENTS.md、skills 不动。`model` 只影响之后在这个打工人目录里新开的会话（页面「新会话」、从侧边栏打开工作区、工作流派发）；已有会话保留自己的模型选择，可以在会话里用 `/model` 切换。模型目录里暂时找不到的已保存选择会保留，等目录恢复后再显示。

插件本身从 `@buka/dsh-plugin-robots` 改名为 `@buka/dsh-plugin-workers`。启动时默认布局会把 `~/.cache/dsh-plugin-robots` 搬到 `~/.cache/dsh-plugin-workers`，把 `robots/` / `robots.json` 改成 `workers/` / `workers.json`，平移登记表里的目录路径，并把登记表升到 version 4（迁移后的标识符就是原来的名字，展示名先为空）；自定义 `workersDir` 时：把它指向旧的自定义目录（`.../robots`）就只把登记文件改名为 `workers.json` 并升级格式；指向同级的 `.../workers` 则连 `robots/` 与 `robots.json` 一起改名。它不知道别的旧目录在哪，也不该猜。旧插件是独立包：新插件挂好之后即可卸载旧插件。已经挂到 DSH 工作区的旧路径会随目录移动失效，迁移后在页面上重新点一次「挂载」即可；旧会话日志留在旧工作区历史里。

其他插件通过 `ctx.bukaWorkers` 服务使用打工人：`list()` 每条摘要都带 `id` 与 `name`（以及 driver / assistant / program），消费方按标识符引用打工人；`avatarMap()` 按标识符给出头像，`dispatchSession()` 只开新会话、`openSession()` 只 resume 同一会话，句柄提供 `readResult` / `send` / `cancel` / `dispose` / `getPlanMode` / `setPlanMode`。一个任务一条新会话；不再有压缩、阻塞式 `startSession`、`outputSchema` / `routes` / `abortable` / 结果追问，任务结果由工作流的 `buka_task_complete` 收口。`planMode: true` 在投递第一轮 prompt 前对目标 agent 执行 `/plan`。

全新安装（登记表为空）时补两个可编辑的预设智能体：`software-engineer`（软件工程师）与 `qa-engineer`（质量保障工程师）。头像 id 是跨插件契约；项目 skills 落在 `<打工人目录>/.agents/skills` 与 `.claude/skills`；AGENTS.md 读取上限 256 KiB、保存上限 512 KiB，`CLAUDE.md` 自动做成指向它的相对符号链接。重命名只改展示名：目录不移动、DSH 工作区注册保留（只同步工作区标题），引用该标识符的工作流不受影响。
