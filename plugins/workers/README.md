# @buka/dsh-plugin-workers

在侧边栏管理**打工人**：有明确职责、能独立处理任务的主体。

打工人分两类：

- **智能体**：有目录、AGENTS.md、项目 skills，以 DSH 会话执行任务；由本插件创建、登记并挂载成工作区。
- **机器人**：固定程序，接收输入 → 产出输出，不建会话；v1 只有内建的 `clock`（到点完成定时任务），只读、不可创建 / 删除。

带 `assistant: true` 标记的智能体是**助理**：工作流里的人任务点名某个助理后，只有该助理能认领并代人沟通。

## 页面

侧边栏「打工人」：

- **列表**：卡片显示头像、名称、driver（agent / robot）、挂载状态、项目 skills 数、是否为助理、职责。智能体可「新会话 / 挂载 / 删除 / 重命名」，机器人只读；列表可按「只看助理」筛选。
- **配置页**（智能体）：职责、模型、AGENTS.md、项目 skills、头像、重命名、设 / 取消助理。
- **创建**：对话框填名称与职责，创建目录、写 AGENTS.md 模板、登记、挂载成工作区；新打工人 `driver=agent`、`assistant=false`。
- **模型**：在「模型」页签给智能体选新会话使用的模型；不选时跟随宿主默认模型。只影响之后新开的会话，已有会话保留自己的模型（可在会话里用 `/model` 切换）。
- **打工人 preset**：安装插件后新增的 preset（显示名「打工人」）；智能体会问清打工人要做什么，起草 AGENTS.md，再调用 `buka_worker_build` 创建 / 改名 / 更新。不能创建机器人。

## 登记表 `workers.json`（version 3）

路径默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workers/workers.json`，打工人目录默认同级的 `workers/`。

```jsonc
{
  "version": 3,
  "workers": [
    {
      "name": "软件工程师",
      "driver": "agent",
      "path": "/abs/.../workers/软件工程师",
      "createdAt": "…",
      "avatar": "rocket",
      "description": "负责软件功能的设计与实现",
      "assistant": false,
      "model": { "provider": "deepseek", "model": "deepseek-chat" }
    },
    {
      "name": "clock",
      "driver": "robot",
      "program": "clock",
      "createdAt": "…",
      "description": "到点完成任务的定时打工人",
      "assistant": false
    }
  ]
}
```

- `model` 可选，只对智能体生效：写 `{ provider, model, reasoningEffort? }` 表示新会话使用它，不写表示跟随宿主默认模型；模型目录里暂时找不到也保留已存的选择。
- 读 v1 旧表时自动补 `driver: "agent"`、`assistant: false`；v2 的 `driver: "program"` 读成 `"robot"`，下次写入落盘 v3；打工人目录、AGENTS.md、skills 不动。
- 写入原子（临时文件 + rename，0600），新建 / 删除 / 改名串行。
- 文件缺失按空表处理；损坏时页面提示并拒绝写入。
- `clock` 由插件启动时幂等补进登记表；不可创建、删除、改名或改字段。
- **从旧插件迁移**：默认布局下启动时把 `~/.cache/dsh-plugin-robots` 搬到 `~/.cache/dsh-plugin-workers`，把 `robots/` / `robots.json` 改成 `workers/` / `workers.json`，平移登记表里的目录路径，并把 v1 / v2 登记表升到 v3；自定义 `workersDir` 时：指向旧目录（`.../robots`）就只改登记文件名并升级格式，指向同级 `.../workers` 则连同目录一起改名。旧包是独立插件，新插件挂好之后可以卸载；旧的 DSH 工作区挂载会因目录移动失效，迁移后在页面上重新挂载一次。

## 打工人 preset

bundle 补丁插入 `worker-builder` preset（显示名「打工人」）。`buka_worker_build` 只对 `builderPresets`（默认 `['worker-builder']`）点名的 preset 根会话可见：

- 参数：`name` / `newName` / `avatar` / `description` / `agents` / `update`；`newName` 改名需要 `update: true`，会移动目录并重建工作区，旧会话保留但不再挂在打工人下。
- 创建智能体，`assistant` 默认 false；机器人只读，拒绝修改。
- 挂载失败不算构建失败：返回 `mounted: false` 与 `mountError`。

## 助理

- 只有智能体可以设 / 取消 `assistant`；新增路由 `POST /buka-workers/assistant`。
- 人任务类型声明 `assistant: "<打工人名>" | null`；workflows 只会启动被点名的助理，也只有该助理能认领那条人任务。
- 助理用打工人自己的目录、AGENTS.md、skills 去与人沟通，最后提交任务结果。

## `ctx.bukaWorkers` 服务

其他插件（如 Buka Workflows）通过它使用打工人：

```ts
const { workers } = await ctx.bukaWorkers.list()
// [{ name, driver: 'agent' | 'robot', assistant, program?, model?, description, avatar, mounted, ... }]

const handle = await ctx.bukaWorkers.dispatchSession({
  worker: '软件工程师',
  prompt: '…',
  title: '作业 #3 · 研发 · 开发',
  agentPreset: 'standard',
  planMode: false,
})
// { sessionId, startSeq, readResult(), send(), cancel(), dispose(), getPlanMode(), setPlanMode() }

const resumed = await ctx.bukaWorkers.openSession({ worker: '软件工程师', sessionId })
```

- `dispatchSession` **只开新会话**；传 `sessionId` 会明确报错并提示用 `openSession`。新会话的模型取打工人登记的 `model`，没配置时回落到宿主默认模型。
- `openSession` 只 resume / attach 同一会话，不发 prompt、不压缩。
- 一个任务一条新会话；不再有 `outputSchema` / `routes` / `abortable` / `resultRetries` / `retryReport` / 结构化结果追问。
- 句柄 `readResult({ sinceSeq })` 返回这一轮的文本、stopReason 与 turn 边界；任务结果由 workflows 的 `buka_task_complete` 收口。
- `planMode: true` 在投递第一轮 prompt 前对目标 agent 执行 `/plan`；`setPlanMode(false)` 尽力退出。
- 机器人不建会话，`dispatchSession` / `openSession` 直接拒绝。

## 预设与种子

- 全新安装（登记表为空）时补两个可编辑的智能体「软件工程师」「质量保障工程师」。
- 每次启动确保 `clock` 在登记表中（幂等）。
- 预设打工人就是普通打工人，可改、可删。

## 头像、技能与 AGENTS.md

- 头像只存预设 id，id 是跨插件契约（workers 页面与 workflows 节点图各自维护 emoji / 底色映射）。
- 项目 skills 落在 `<打工人目录>/.agents/skills` 与 `.claude/skills`；页面用 `npx skills` 列出 / 安装 / 移除。
- AGENTS.md 读取上限 256 KiB、保存上限 512 KiB；`CLAUDE.md` 自动做成指向它的相对符号链接。
- 重命名会移动目录并重建 DSH 工作区；旧会话日志保留，但不再列在这个打工人下。

## 路由

| 路由                                                         | 作用                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /buka-workers/list`                                     | 打工人 + 挂载状态 + skills + AGENTS.md + driver / assistant / program |
| `POST /buka-workers/create`                                  | 创建智能体并挂载                                                      |
| `POST /buka-workers/rename`                                  | 改名并重建工作区                                                      |
| `POST /buka-workers/avatar`                                  | 改头像                                                                |
| `POST /buka-workers/description`                             | 改职责                                                                |
| `GET /buka-workers/models`                                   | 读可选模型目录（按提供方分组）                                        |
| `POST /buka-workers/model`                                   | 设置 / 清除智能体新会话的模型                                         |
| `POST /buka-workers/assistant`                               | 设 / 取消助理（仅智能体）                                             |
| `POST /buka-workers/remove`                                  | 只删登记（目录、文件保留）                                            |
| `POST /buka-workers/agents`                                  | 写 AGENTS.md                                                          |
| `POST /buka-workers/skills/available` / `install` / `remove` | 项目 skills                                                           |
| `POST /buka-workers/reveal`                                  | 打开打工人目录                                                        |

除 create / remove 外按 `name` 寻址；路径由 Host 从登记表读取。所有路由沿用 DSH 的信任栅栏。

## 模型工具

- `buka_workers`（只读）：返回登记表里的打工人，包含 `driver` / `assistant` / `program` / 职责；工作流编排 preset 调用时固定省略技能清单。
- `buka_worker_build`（写，只对 `builderPresets` 根会话可见）：创建 / 更新 / 改名智能体并挂载。

## 结构与测试

- `src/index.ts`：装配路由、工具、服务与种子。
- `src/worker-store.ts`、`src/store/**`：名称规则、登记表 v3、目录、AGENTS.md、skills、重命名、挂载、内建 clock。
- `src/service.ts`、`src/service/**`：`ctx.bukaWorkers` 会话服务（去压缩、一任务一会话）。
- `src/routes/**`、`src/client/**`：页面与路由。
- `test/workers-*.test.mjs`：登记表 / 服务 / 页面冒烟 / 构建工具 / 路由。
