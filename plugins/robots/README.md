# @buka/dsh-plugin-robots

在侧边栏管理**机器人**：有明确职责、能独立处理任务的主体。

机器人分两类：

- **agent 型**：有目录、AGENTS.md、项目 skills，以 DSH 会话执行任务；由本插件创建、登记并挂载成工作区。
- **program 型**：固定程序，接收输入 → 产出输出，不建会话；v1 只有内建的 `clock`（到点完成定时任务），只读、不可创建 / 删除。

带 `assistant: true` 标记的 **agent 型机器人是助理**：工作流里的人任务点名某个助理后，只有该助理能认领并代人沟通。

## 页面

侧边栏「机器人」：

- **列表**：卡片显示头像、名称、driver（agent / program）、挂载状态、项目 skills 数、是否有 AGENTS.md、是否为助理、职责。agent 型可「新会话 / 挂载 / 删除 / 重命名」，program 型只读；列表可按「只看助理」筛选。
- **配置页**（agent 型）：职责、AGENTS.md、项目 skills、头像、重命名、设 / 取消助理。
- **创建**：对话框填名称与职责，创建目录、写 AGENTS.md 模板、登记、挂载成工作区；新机器人 `driver=agent`、`assistant=false`。
- **机器人构建模式**：安装插件后新增的 preset；agent 会问清机器人要做什么，起草 AGENTS.md，再调用 `buka_robot_build` 创建 / 改名 / 更新。不能创建 program 型机器人。

## 登记表 `robots.json`（version 2）

路径默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots/robots.json`，机器人目录默认同级的 `robots/`。

```jsonc
{
  "version": 2,
  "robots": [
    {
      "name": "软件工程师",
      "driver": "agent",
      "path": "/abs/.../robots/软件工程师",
      "createdAt": "…",
      "avatar": "rocket",
      "description": "负责软件功能的设计与实现",
      "assistant": false
    },
    {
      "name": "clock",
      "driver": "program",
      "program": "clock",
      "createdAt": "…",
      "description": "到点完成任务的定时机器人",
      "assistant": false
    }
  ]
}
```

- 读 v1 旧表时自动补 `driver: "agent"`、`assistant: false`，下次写入落盘 v2；机器人目录、AGENTS.md、skills 不动。
- 写入原子（临时文件 + rename，0600），新建 / 删除 / 改名串行。
- 文件缺失按空表处理；损坏时页面提示并拒绝写入。
- `clock` 由插件启动时幂等补进登记表；不可创建、删除、改名或改字段。

## 机器人构建模式

bundle 补丁插入 `robot-builder` preset（显示名「机器人构建」）。`buka_robot_build` 只对 `builderPresets`（默认 `['robot-builder']`）点名的 preset 根会话可见：

- 参数：`name` / `newName` / `avatar` / `description` / `agents` / `update`；`newName` 改名需要 `update: true`，会移动目录并重建工作区，旧会话保留但不再挂在机器人下。
- 创建 agent 机器人，`assistant` 默认 false；program 机器人只读，拒绝修改。
- 挂载失败不算构建失败：返回 `mounted: false` 与 `mountError`。

## 助理

- 只有 agent 型机器人可以设 / 取消 `assistant`；新增路由 `POST /buka-robots/assistant`。
- 人任务类型声明 `assistant: "<机器人名>" | null`；workflows 只会启动被点名的助理，也只有该助理能认领那条人任务。
- 助理用机器人自己的目录、AGENTS.md、skills 去与人沟通，最后提交任务结果。

## `ctx.bukaRobots` 服务

其他插件（如 Buka Workflows）通过它使用机器人：

```ts
const { robots } = await ctx.bukaRobots.list()
// [{ name, driver: 'agent' | 'program', assistant, program?, description, avatar, mounted, ... }]

const handle = await ctx.bukaRobots.dispatchSession({
  robot: '软件工程师',
  prompt: '…',
  title: '作业 #3 · 研发 · 开发',
  agentPreset: 'standard',
  planMode: false,
})
// { sessionId, startSeq, readResult(), send(), cancel(), dispose(), getPlanMode(), setPlanMode() }

const resumed = await ctx.bukaRobots.openSession({ robot: '软件工程师', sessionId })
```

- `dispatchSession` **只开新会话**；传 `sessionId` 会明确报错并提示用 `openSession`。
- `openSession` 只 resume / attach 同一会话，不发 prompt、不压缩。
- 一个任务一条新会话；不再有 `outputSchema` / `routes` / `abortable` / `resultRetries` / `retryReport` / 结构化结果追问。
- 句柄 `readResult({ sinceSeq })` 返回这一轮的文本、stopReason 与 turn 边界；任务结果由 workflows 的 `buka_task_complete` 收口。
- `planMode: true` 在投递第一轮 prompt 前对目标 agent 执行 `/plan`；`setPlanMode(false)` 尽力退出。
- program 机器人不建会话，`dispatchSession` / `openSession` 直接拒绝。

## 预设与种子

- 全新安装（登记表为空）时补两个可编辑的 agent 机器人「软件工程师」「质量保障工程师」。
- 每次启动确保 `clock` 在登记表中（幂等）。
- 预设机器人就是普通机器人，可改、可删。

## 头像、技能与 AGENTS.md

- 头像只存预设 id，id 是跨插件契约（robots 页面与 workflows 节点图各自维护 emoji / 底色映射）。
- 项目 skills 落在 `<机器人目录>/.agents/skills` 与 `.claude/skills`；页面用 `npx skills` 列出 / 安装 / 移除。
- AGENTS.md 读取上限 256 KiB、保存上限 512 KiB；`CLAUDE.md` 自动做成指向它的相对符号链接。
- 重命名会移动目录并重建 DSH 工作区；旧会话日志保留，但不再列在这个机器人下。

## 路由

| 路由                                                        | 作用                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /buka-robots/list`                                     | 机器人 + 挂载状态 + skills + AGENTS.md + driver / assistant / program |
| `POST /buka-robots/create`                                  | 创建 agent 机器人并挂载                                               |
| `POST /buka-robots/rename`                                  | 改名并重建工作区                                                      |
| `POST /buka-robots/avatar`                                  | 改头像                                                                |
| `POST /buka-robots/description`                             | 改职责                                                                |
| `POST /buka-robots/assistant`                               | 设 / 取消助理（仅 agent 型）                                          |
| `POST /buka-robots/remove`                                  | 只删登记（目录、文件保留）                                            |
| `POST /buka-robots/agents`                                  | 写 AGENTS.md                                                          |
| `POST /buka-robots/skills/available` / `install` / `remove` | 项目 skills                                                           |
| `POST /buka-robots/reveal`                                  | 打开机器人目录                                                        |

除 create / remove 外按 `name` 寻址；路径由 Host 从登记表读取。所有路由沿用 DSH 的信任栅栏。

## 模型工具

- `buka_robots`（只读）：返回登记表里的机器人，包含 `driver` / `assistant` / `program` / 职责；工作流编排 preset 调用时固定省略技能清单。
- `buka_robot_build`（写，只对 `builderPresets` 根会话可见）：创建 / 更新 / 改名 agent 机器人并挂载。

## 结构与测试

- `src/index.ts`：装配路由、工具、服务与种子。
- `src/robot-store.ts`、`src/store/**`：名称规则、登记表 v2、目录、AGENTS.md、skills、重命名、挂载、内建 clock。
- `src/service.ts`、`src/service/**`：`ctx.bukaRobots` 会话服务（去压缩、一任务一会话）。
- `src/routes/**`、`src/client/**`：页面与路由。
- `test/robots-*.test.mjs`：登记表 / 服务 / 页面冒烟 / 构建工具 / 路由。
