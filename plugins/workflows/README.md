# @buka/dsh-plugin-workflows

由**编排 preset** 现场创建的一次性工作流：编排 agent 审视任务后写一份节点图，直接交给插件调度，跑到终止状态或异常为止。当前是**格式 v3**（`WORKFLOW_FORMAT_VERSION = 3`）：节点有 `start` / `robot` / `user` / `join` / `end` 五种（`join` 收集并发 fan-out 的分支，等这一波实际启动的输入全部完成才放行一次）；每个机器人节点都在定义里声明 `output`（节点结果 JSON 的 JSON Schema），交回 JSON 并用 JSON 里的 `next` 选择出边，或者在确实无法完成时用 `abort` 主动终止整个运行；`user` 是**用户介入节点**，流程暂停等待用户做决定、完成手动操作或查看结果后给反馈；定义校验阶段会按这些 schema 检查边 prompt 里的模板变量。会话中断只续接同一会话，续接失败直接终止运行；宿主重启后未完成的运行也能接着跑，含 user 节点的运行除外（提问卡无法重建），续接失败则标成 `interrupted`。

设计的边界：

- **创建入口收窄到一个 preset**：创建 / 启动 / 状态 / 取消工具只对配置点名的 agent preset（默认是随插件发布的 `workflow-orchestrator`）的**根会话**可见，其他会话连这些工具都看不到；由该 preset 会话 spawn 出来的子会话同样看不到，避免机器人节点自己再开工作流。机器人节点会话只额外获得四个只读观测工具（见上文「工具」），不能创建 / 启动 / 取消工作流。
- **不是流程市场**：没有可复用的可运行流程、编辑器或按流程生成的自定义工具。每次运行的定义都来自编排 agent 的那一次工具调用，侧边栏页面只是观测点；「模板」页签里的模板是**抽象参考**（角色名 + 无 `output`），不能直接启动，只是给编排 agent 设计真实工作流时参考结构。
- **一次性、无兼容包袱**：格式版本 `WORKFLOW_FORMAT_VERSION = 3`。格式 3 不接受旧 `gate` 节点：定义里出现 `type: "gate"` 会在校验阶段报迁移错误，请改用 `user` 节点。插件升级 / 启动时会把 `runs/` 下旧版本（或缺失 / 损坏）的运行目录整目录删除，编号重新从 `#1` 开始；`runs/` 同级的 `settings.json`（自动归档设置）保留。不提供迁移、兼容，也不回放旧定义。
- **运行数据落盘，执行交给观察者**：定义快照、运行状态、事件流、节点结果与节点附件都写到插件目录，既是回看的依据，也是重启后恢复的权威状态。后台运行**不 await** 机器人会话的 `result`：Host 侧的 [`src/supervisor.ts`](src/supervisor.ts) 订阅全局会话事件，`turn/end` 后读结果、写 step、按 JSON 的 `next` 路由并投下一个节点；会话中断会续接，宿主重启后未完成的运行会自动恢复（含 user 节点的运行在重启后无法重建提问卡，见下文「观察者、恢复与超时」）。
- **一个机器人一个会话，重复进入先 compact**：同一次运行里，同一个 `robot` 只在第一次进入时通过 `ctx.bukaRobots.dispatchSession()` 新开会话；之后任何节点再次进入这个机器人时都传回已记录的 `sessionId`，插件先对该会话执行一次 compact，再把这次边上的 prompt 发进同一个会话。这样机器人跨节点 / 循环保留上下文，又不会让会话无限膨胀。每次进入都会在 `run.sessions[].entries` 里留一条记录，运行页据此按节点展示会话。会话还会按「运行目标 · 机器人」显式命名（`title`），侧边栏里能直接认出是哪次运行的哪段对话。机器人会话显式落到普通工作 preset（Config `robotPreset`，默认 `standard`），不继承编排器的 persona 或创建类工具，只额外获得四个只读观测工具。
- **机器人是普通会话**：以运行时根会话创建 / 续接，走正常的审批策略（默认沿用部署策略；无头场景才显式 `approval: 'never'`），可以在自己的会话里请求工具审批或向用户提问。工作流**不注入任何行为提示词**，只给任务、定义的输出 schema 渲染出的结果契约与每条出边的含义；是否提问、是否请求审批由机器人按任务自己决定。机器人节点会话另外获得四个只读观测工具（运行总览 / 执行输入 / 执行输出 / 附件读取，见「工具」）。 唯一的模式例外是声明 `"mode": "plan"` 的节点：它让 DSH plan 模式接管这一轮的指引与原生审阅，见下文「机器人节点的 plan 模式」。
- **节点输出是声明式的**：robot 节点必须写 `output`（节点结果 JSON 的 JSON Schema 子集）。引擎把 `output`、`next` 与内置的附件能力合并成 `structured_output` 的参数，并在计划阶段按 schema 检查边 prompt 里的模板变量；运行期结果不符合 schema 时在同一会话追问，额度用尽后节点失败。
- **用户介入是独立节点**：`user` 节点不建会话，执行到它时把定义里的 `title` / `detail` 与出边的 `label` 变成一张原生提问卡（DSH 的 `userQuestions` 服务），由用户在创建者会话里作答；出边就是用户的选项，`questions` 收集到的额外答案也会随运行记录下来，供后续 prompt 用模板引用。它只在前台运行，因为提问卡需要创建者会话有活跃的 turn。
- **允许循环**：机器人用结果里的 `next`（出边的 `name`）选路，某条边可以指回前面的节点（或自己）。调度用 `maxSteps` 与机器人节点的 `maxVisits` 兜底，防止环不退出；页面上同层 / 并行分支的节点并排成一行，回边 / 自环走左右两侧的 lane、连线带箭头，重复进入的胶囊显示 `×N`。
- **图调度会话**：不含 `user` 节点的定义在后台运行——第一个节点 dispatch 完成后工具立刻返回 `runId`，之后由宿主级观察者按会话事件继续调度，不占编排器会话的 turn；含 `user` 节点的定义必须前台运行、在本次调用内跑到终止状态，因为原生提问卡要求创建者会话有活跃的 turn。
- **运行序号与自动归档**：每次运行按创建顺序分配持久递增的序号 `#N`（同一格式版本内删除旧记录不会回退编号；跨格式版本清理会从 `#1` 重新开始）；运行记录还会按页面上的「自动归档设置」自动归档 / 删除，详见下文「运行序号与自动归档」。

## 机器人节点的 plan 模式

`robot` 节点可以声明 `"mode": "plan"`，让这个机器人**先出计划、用户批准后再实施**。它仍然是普通机器人节点：一个会话、一份 `output`、`next` 路由与附件能力都不变；计划审阅是 DSH plan 模式提供的原生能力，不是 workflow 自己加的审批节点。

```jsonc
{
  "id": "implement",
  "type": "robot",
  "robot": "developer",
  "summary": "先审计划再实施",
  "mode": "plan",
  "output": { "type": "object", "properties": { "summary": { "type": "string" } } },
  "next": [{ "to": "done", "name": "完成" }]
}
```

一次进入的时间线：

1. supervisor 通过 `ctx.bukaRobots.dispatchSession()` / `openSession()` 传 `planMode: true`；
2. robots 在投递第一轮 prompt **之前**对目标 agent 执行 `/plan` 命令（与用户在会话里输入 `/plan` 相同；无需读取根作用域的 planMode 服务），机器人拿到 plan 指引与 `exit_plan_mode`；
3. 机器人先探索，调用 `exit_plan_mode(plan)`：批准 → 同一 turn 继续实施，最后交回结构化结果；继续计划 → 修订后再次提交；关闭审阅自己写回复 → 本轮结束，workflow 不抢答，等用户在机器人会话里的下一条消息继续这个节点；
4. 节点结束（完成 / abort / 超时 / 取消）时 supervisor 尽力退出 plan 模式（会话日志里仍为 active 时才执行 `/plan off`）；同一机器人下一次进入节点时按新节点的 `mode` 显式归一，不会把残留状态带过去。

注意：

- 这是**单节点**流程，不要再用 `user` 节点为同一份计划重复审批；需要用户在多个方案里选路时，`user` 节点仍然是正确工具。
- 审阅卡在**机器人自己的会话**里，运行页会显示「机器人正在等待你审阅计划」与「打开会话」入口；后台运行也可以，不需要创建者会话有活跃 turn。
- plan 模式是 DSH 的**软指引**，不是沙箱：工具仍可调用，写文件限制要靠沙箱 / 审批策略，本插件不改变这一点。
- plan 模式由 DSH 的 plan 插件以 `/plan` 命令提供（web/desktop 的组成把它 isolate 在会话 preset 内，根作用域看不到 planMode 服务）；工作流只检查 `commands` 命令服务、原生审阅卡需要的 `userQuestions`，以及支持命令入口的 `@buka/dsh-plugin-robots` 0.9.0+（`supportsPlanMode`）；缺任何一样 `buka_workflow_start` 会在创建运行前拒绝。
- `timeoutMs` 覆盖整个节点，包括等待审阅的时间；默认仍不设超时。
- 宿主重启恢复 plan 节点时保留会话日志里的 plan 状态（批准后可能已退出）；普通节点恢复时只有在日志仍显示 plan 模式 active 时才发 `/plan off` 清掉残留。
- 机器人自己停在计划阶段、既没有弹出审阅卡也没有交回结果时，观察者只发一次协议提示（要求先 `exit_plan_mode` 审阅），第二次仍如此则节点失败并写明原因。

## 工具

| 工具                      | 作用                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buka_workflow_plan`      | 只校验定义（含 robot 节点的 `output` schema 与边 prompt 的模板变量），返回规范化节点图或精确错误；建议在 `buka_workflow_start` 之前调用                                                                                                                                                              |
| `buka_workflow_start`     | 校验并启动一次运行。不含 `user` 节点时后台执行：第一个节点 dispatch 后立即返回 `runId`，观察者继续按图调度节点会话，返回值还额外带这次运行的持久序号 `seq`；含 `user` 节点时前台执行到终止状态（用户每作答一次流程继续）并返回逐节点摘要                                                             |
| `buka_workflow_status`    | 按 `run_id` 读一次运行（后台运行会持续前进；宿主重启后未完成的运行会被观察者接着跑；含 `user` 节点的运行在重启后标成 `interrupted`）；省略 `run_id` 时列出最近运行，列表里的每一项都带 `#N` 序号                                                                                                     |
| `buka_workflow_cancel`    | 取消仍在运行的后台运行（含 `user` 节点的前台运行靠用户停止这一轮 turn 取消）；已结束的运行是无操作                                                                                                                                                                                                   |
| `buka_workflow_templates` | 只读参考：列出抽象工作流模板目录（id / 名字 / 描述），或按 id 读一份模板的完整抽象流程。模板不是可运行定义——机器人节点是抽象角色名、没有 `output`；编排 agent 用它参考流程，再用 `buka_robots` 把角色替换成真实机器人、补上 `output` 与具体边 prompt。省略 `id` 时列目录，传 `id` 时返回那份模板全文 |

没有向模型暴露“替你作答”的工具：`user` 节点的选择与问题只能由用户在原生提问卡里回答，模型看不到、也不能代替。

### 机器人节点会话里的只读工具

每个由工作流创建的机器人节点会话还会看到四个只读工具。它们由 workflows 插件注册，但只对运行记录里出现过的机器人会话（`run.steps[].sessionId` / `run.sessions`）可见；运行结束或 DSH 重启后重新打开会话时，观察者会从落盘运行记录重建索引，工具仍然可用。手动机器人会话不属于任何运行，看不到这四个工具。

| 工具                                 | 作用                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buka_workflow_overview`             | 当前运行的总览：节点图、每个节点的概要/状态、执行序号列表与整体状态。只返回挑选后的紧凑字段，不含 prompt、最终文本、边的 prompt 或节点结果全文              |
| `buka_workflow_execution_input`      | 按执行序号 `seq` 读取那次执行实际收到的输入：机器人节点是渲染后的 prompt，user 节点是渲染后的 `detail`（没有时退回 `title`）                                |
| `buka_workflow_execution_output`     | 按执行序号 `seq` 读取那次执行的输出：机器人节点的正文、结构化 JSON、附件清单、route、停止原因与错误；user 节点返回你的答案文本、选中的 route 与整份 answers |
| `buka_workflow_execution_attachment` | 按执行序号 `seq` 列出附件清单；传 `name` 时分段读取一个附件（默认 64 KiB，可带 `offset` / `maxBytes`）。二进制只返回元数据与绝对路径                        |

执行序号来自总览的 `executions` 列表；每个执行都有独立序号，循环里重复进入同一节点也能精确区分。工具只读当前会话所属的那一次运行，不接受 `run_id`，也不写任何运行记录。运行中的机器人节点可以读输入，但输出要等这一轮结束；等待作答的 user 节点可以读说明，但输出要等用户回答。

### 节点附件

附件是每个机器人节点**内置的能力**，用来交回与答案相互独立的文件和 / 或数据（二进制产物、压缩包、trace、大数据集等）；它不是输出通道，答案本身写在节点最终文本与声明的 `output` 字段里。节点交回 JSON 时可以带一个可选的 `attachments` 数组，例如一个检查节点产生了失败用例的 trace：

```jsonc
{
  "next": "fix",
  "status": "blocked",
  "attachments": [
    {
      "path": "traces/playwright.zip",
      "name": "trace.zip",
      "description": "失败用例的 Playwright trace"
    }
  ]
}
```

- 路径相对机器人工作区（`handle.cwd`）；也允许当前运行目录内的绝对路径，便于把一个附件原样带到下一节点。插件把文件复制到该次执行的 `nodes/<seq>-<id>/attachments/`，机器人不需要直接写 runs 目录。
- 复制后生成稳定清单 `{ index, name, bytes, description? }`，写进节点结果、`run.steps[]` 和后续节点的模板上下文；同名文件自动加 `-2` 后缀。
- 后续节点的 prompt 可以按需引用：`{{nodes.<id>.attachments.<index>.text}}` 内联文本、`.path` 拿绝对路径、`.name` / `.bytes` / `.description` 拿元数据。`.text` 只对 UTF-8 文本且不超过内联上限的附件可用；二进制或超大附件请用 `.path` 或 `buka_workflow_execution_attachment` 读取，避免把大内容塞进 prompt。
- **不要把整份答案写成 markdown 再作为唯一附件交回**：运行页展示的是节点最终文本，附件只是补充材料；后续节点需要正文时请用 `{{nodes.<id>.text}}` 或声明的 data 字段。
- 只有正常完成的节点会复制附件。附件数组不合法、源文件缺失 / 越界 / 不是普通文件、超限时，节点以明确错误失败，运行终止，不会静默丢附件。
- 默认限制：单文件 8 MiB、每节点 20 个、每节点总量 64 MiB、prompt 内联单文件 32 KiB；都可通过配置调整。
- 运行页的每次执行会列出附件：点附件文件名会在运行页右侧打开预览抽屉（文本 / Markdown / 代码 / 图片 / PDF 可直接预览；Office、Excel、压缩包等二进制只提供下载），下载入口保留；最终输出只有附件、没有正文时也会展示附件，而不是显示“没有输出”。附件预览会叠在节点抽屉之上，关闭后回到节点抽屉。

## 谁能创建工作流

工具注册在 Host 上，但可见性由 [`src/access.ts`](src/access.ts) 按会话收窄：

1. 取调用者会话记录的 agent preset（`ctx.agentPresets.presetForSession`）；
2. 只有配置 `orchestratorPresets` 里点名的 preset **根会话**能看到创建 / 启动 / 状态 / 取消工具；
3. 子会话（机器人节点）、其他 preset 的会话看不到这些创建类工具；机器人节点会话只额外拥有上面四个只读观测工具。

随插件的 bundle 补丁会插入一个 `workflow-orchestrator` preset（`id: workflow-orchestrator`，显示为「工作流编排」）：它带一段编排 persona，以及 bash / fs / fs-search / ask-user 等基础工具，但**不做具体工作**，只负责计划节点图并启动。它本身没有技能，也看不到机器人装了哪些 skills：`buka_robots` 对随包发布的 `workflow-orchestrator` preset 固定省略 `skills` 字段，它只能按每个机器人的一句职责选人、按能力排流程（硬规则，不可配置；换成自定义编排 preset 后 `buka_robots` 仍会照常返回技能清单）。新建会话时选择这个 preset 即可创建工作流。想换成自己的 preset，把 `orchestratorPresets` 改成对应 id；留空表示不做收窄（所有会话可见，不推荐）。

## 定义格式

```jsonc
{
  "goal": "修复登录页空白屏并验证",
  "maxSteps": 32,
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "next": [
        {
          "to": "check",
          "name": "开始",
          "prompt": "目标：{{goal}}\n定位登录页空白屏的原因并修复，改完跑一遍相关测试。"
        }
      ]
    },
    {
      "id": "check",
      "type": "robot",
      "robot": "developer",
      "summary": "检查登录页并跑测试",
      "timeoutMs": 600000, // 可选硬超时；不写表示不超时
      "output": {
        // 必填：节点结果 JSON 的 JSON Schema
        "type": "object",
        "properties": {
          "status": { "type": "string", "enum": ["ok", "blocked"] },
          "reason": { "type": "string" },
          "summary": { "type": "string" }
        },
        "required": ["status"],
        "additionalProperties": false
      },
      "next": [
        {
          "to": "fix",
          "name": "fix",
          "tone": "failure",
          "prompt": "测试打回了，按失败信息继续修复，然后重新跑测试。"
        },
        { "to": "confirm", "name": "pass", "tone": "success" }
      ]
    },
    {
      "id": "fix",
      "type": "robot",
      "robot": "developer",
      "summary": "按失败信息修复",
      "output": {
        "type": "object",
        "properties": { "summary": { "type": "string" } },
        "required": ["summary"],
        "additionalProperties": false
      },
      "next": [{ "to": "check", "name": "retest", "prompt": "修复完成，重新检查并跑测试。" }]
    },
    {
      "id": "confirm",
      "type": "user",
      "title": "确认可以发布了",
      "detail": "检查已通过：{{nodes.check.text}}。请确认是否发布。",
      "next": [
        {
          "to": "done",
          "name": "approve",
          "label": "确认发布",
          "description": "直接结束这次运行",
          "tone": "success"
        },
        {
          "to": "fix",
          "name": "rework",
          "label": "还需要改",
          "description": "按你的意见回到修复节点",
          "tone": "failure",
          "prompt": "用户认为还需要修改：{{nodes.confirm.text}}。请按用户意见继续修复。"
        }
      ],
      "questions": [{ "id": "notes", "header": "补充说明", "question": "还有什么要告诉机器人的？" }]
    },
    { "id": "done", "type": "end", "status": "completed" }
  ]
}
```

`check` 节点交回的 JSON（`structured_output` 的参数；纯文本 JSON 也接受，并且同样校验）；字段必须匹配该节点的 `output`，`next`、`abort` 与 `attachments` 由引擎合并进实际 schema：

```jsonc
// 测试打回：next 必须是 check 的出边名之一
{ "next": "fix", "status": "blocked", "reason": "登录页仍然空白，快照显示渲染前抛错" }
// 测试通过（去 confirm 用户节点）：同样要交回 JSON；pass 边进入 user 节点，所以不带 prompt
{ "next": "pass", "status": "ok", "summary": "已修复，3 个测试全绿" }
// 节点确实无法完成：不选任何路径，直接终止整个运行并留下原因
{ "abort": "登录页仍然空白，且当前环境没有可用的浏览器快照；需要人工排查环境" }
// 用户在 confirm 节点选了「确认发布」：运行记录的 route 是 approve，答案文本从 {{nodes.confirm.text}} 读
```

`abort` 是每个机器人节点内置的**主动终止**能力：它不是一条出边、不产生 route、也不需要预先定义 `end` 节点。合法 `abort` 会把这次执行记成失败（`step.aborted = true`、`stopReason = "aborted"`），运行以 `failed` 结束并在 `run.error` / `error` 里留下节点 id 与原因；`run.result.aborted` 也是 `true`。不满足声明的 `output` 必填字段时仍然可以靠 `abort` 干净退出，所以不要为了“停住”而伪造一条路径。

`status` / `blocked` / `reason` 等只是机器人自己约定的**业务字段**，不是节点或运行状态——运行状态仍然只有 `completed` / `failed` / `cancelled` / `rejected` / `waiting` / `interrupted`；主动终止只是 `failed` 的一种带 `aborted` 标记的来源。

节点字段：

| 节点    | 字段                                                                                                                                                                                                                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` | `id`、`type: "start"`、`next`；恰好一个，不执行、不占步数。它只有一条出边，出边上的 `prompt` 就是真正的第一个机器人节点首次进入时的提示词                                                                                                                                                                                              |
| `robot` | `id`、`type: "robot"`、`robot`、`output`（**必填**，节点结果 JSON 的 JSON Schema）、`summary`（可选，创建者写的一行步骤概要）、`mode`（可选，目前只接受 `"plan"`，见「机器人节点的 plan 模式」）、`agentOptions`、`timeoutMs`（可选硬超时，毫秒，上限 24 小时；不写就不超时）、`maxVisits`、`next`；**没有 `prompt`，也没有 `report`** |
| `user`  | `id`、`type: "user"`、`title`（**必填**，≤ 200 字符，提问卡的 header）、`detail`（可选，≤ 4000 字符，展示给用户的说明，支持模板）、`next`（可选：用户能选的出边，见下）、`questions`（可选：追加问题，最多 4 条）；`next` 与 `questions` 至少要有一个；不接受 `output`，节点上也不写 `prompt`                                          |
| `end`   | `id`、`type: "end"`、`status`（`completed` / `rejected` / `failed`）；终止节点不写最终文本，它在页面上的「最终输出」取这次运行最后一次**有正文**的机器人执行                                                                                                                                                                           |

`next` 是**出边数组**：机器人节点的每条出边都是 `{ "to": "...", "name": "...", "prompt": "...", "tone"?: "success" | "failure" }`——`to` 是目标节点，`name` 是这条边的**路由名**（同一个机器人节点下必须唯一，最长 120 字符），`prompt` 是走到这条边时发给目标节点的提示词。进入机器人节点的边必须有非空 `prompt`，进入 user / 终止节点的边不能带 `prompt`。机器人没有 `when` 条件、也没有默认出口：走哪条边完全由机器人交回 JSON 里的 `next` 决定；机器人节点的 `next` 必须是边对象数组（格式 2 起不再支持字符串简写）。`user` 节点的出边是 `{ "to": "...", "name": "...", "label": "...", "description"?: "...", "prompt"?: "...", "tone"?: "success" | "failure" }`：`name` 仍是路由键（同一节点内唯一），`label` 是显示给用户的选项文字（同一节点内也必须唯一，回答按 label 反推边）；目标是机器人时 `prompt` 必填，目标是 user / 终止节点时禁止。

`tone` 是**可选的外观属性，对功能没有任何影响**：`success` 把运行页上这条线画成成功绿，`failure` 画成失败红，不参与路由、调度、结果校验或运行记录。它适合在一条出边的含义本身就是「成功 / 失败」时主动标注，尤其是同一个节点有两条出边、光看名字不容易分辨的时候（例如「通过 → 验收」与「不通过 → 修复」）。颜色只出现在图上；hover 仍只显示名字，点连线可在右侧抽屉看这条边的完整配置，节点详情与执行 Tab 都不变；指向同一目标的多条边合并成一条线时，取定义顺序里**第一条带 `tone` 的边**的颜色，没有 `tone` 的边保持原来的中性色。

`name` 既是路由键（机器人结果里的 `next` 必须等于它），也是运行页上机器人边的标签；user 边的标签是 `label`：鼠标悬停到连线上时显示名字，这条线变成实线、略粗一点、其余连线压暗；点击任意连线（包括没有名字的边）会从右侧抽屉展开这条边的配置——来源 → 目标、路由键、user 选项的 `label` / `description`、进入提示词（原始模板，走到这条边时才渲染）、外观色 `tone`、是否回边，运行页还标出是否走过、走过几次，模板页不显示运行状态行。user 节点的边显示 `label`（用户看到的选项文字）。指向同一目标的多条边可以并存（`name` 不同），图上合并为一条线、名字并列展示，抽屉里逐条列出这些规则。

**所有 prompt 都定义在边上**：每个进入机器人节点的边都必须有 `prompt`，包括 start 节点的第一条边、user 节点去机器人节点的出边和循环回边；节点本身不写 prompt。`prompt` 在**这条边被走到时**渲染，并成为目标节点这一次执行的完整提示词。于是同一个 `dev` 节点可以由 start 边给出“首次开发”的指令，由 `test → dev` 回边给出“测试打回、按以下问题修复”的指令，而图上仍然只有一个开发者节点、节点抽屉里按 `#1 / #2` 分开每次执行。边 prompt 进入 user / 终止节点没有意义，写了会在校验时报错；它按模板渲染：引用的节点 / 字段不存在的写法在计划阶段报错（见下方「模板引用校验」），运行期值确实缺失时该节点失败。

**所有节点都必须能从 start 节点走到**：走不到的节点没有任何入边，永远不会执行，画到运行图上还会被当成第二个起点。校验阶段直接报错（`buka_workflow_plan` 会指出具体是哪个节点）。边也不能指回 start 节点。

**格式校验是严格的**：`report` 与 `when` 都是校验错误（分别提示 report 已在格式 2 移除、when 已移除请用 JSON 的 `next` 选择出边）；机器人节点没有 `prompt`，但必须声明 `output`；start / user / end 声明 `output` 会报错；`user` 节点的 `title` 必填，`next` 与 `questions` 至少要有一个；定义里出现 `type: "gate"` 会报明确的迁移错误（`"gate" was replaced by the "user" node in workflow format 3; use { "type": "user", "title", "detail"?, "next"?, "questions"? }`），节点上的 `onApprove` / `onReject` 也报移除错误（把选项写成 `next` 里带 `label` 的边）；格式 3 不兼容旧格式（没有 start 节点、用顶层 `"start"` 指定入口、prompt 写在机器人节点上）的定义。

**输出契约与路由**：每个机器人节点必须声明 `output`——节点结果 JSON 的 JSON Schema。支持的关键字：`type`（必填：object / array / string / number / integer / boolean / null）、`description`、`properties`、`required`、`additionalProperties`（布尔）、`items`、`enum`、`const`、`oneOf`（独占）；属性名必须是 `[A-Za-z0-9_-]{1,64}`，方便模板寻址；顶层不能声明 `next` / `abort` / `attachments`。引擎把声明合并成 `structured_output` 的参数：有出边时加 `next` 枚举（不放进 `required`，因为 `abort` 可以替代它），总是加内置的 `abort` 字符串与内置的 `attachments` 数组；并把同一份契约追加到节点 prompt 末尾。

节点必须交回**一个 JSON 对象**（scoped 工具 `structured_output`；最后一条回复本身是 JSON、或用 ```json 代码块同样接受，并且同样校验）。缺必填字段、类型 / enum 不符、或 `additionalProperties: false` 下多出字段时，插件在**同一个会话**里追问并给出具体问题，最多 `resultRetries` 次（robots 插件配置，默认 2）；重试用尽仍不合法时节点以 `error` 结束。节点有出边时，JSON 里必须带 `next`（某条出边的 `name`）或 `abort`，二者恰好一个；缺 `next`、值对不上任何出边、`next` 与 `abort` 同时出现、`abort` 不是非空字符串、或同一个节点下出边重名都走同一追问通道，追问会再次说明 `abort` 是合法出口。合法 `abort` 直接终止运行，观察者不会再续接中断的会话；合法的 `next` 则按那条边（连同它的 `prompt`）前进，不需要 `when` 条件，也不需要额外的判断 agent。没有出边的终止机器人节点仍然交回 JSON，但不需要 `next`。除 `next` / `abort` 外的字段都存进这次执行的 `data`（模板可用 `{{nodes.<id>.data.<path>}}` 引用）；`attachments` 是内置能力，会被规范化成复制后的清单，且只在节点正常完成时复制。运行页展示最终文本、附件预览 / 下载与这次走出的 route（主动终止时显示 `节点主动终止运行` 标签与原因），不铺 key/value、也不展示原始 JSON。

边上的机器人 `prompt` 应当写清两件事：任务，以及每个 `next` 值分别代表什么。结果字段由节点的 `output` 声明、由引擎自动追加到 prompt，不要在边 prompt 里重复字段清单；也不要把附件当成答案的输出通道。`abort` 出口也由引擎契约统一说明，不需要在每条边 prompt 里重复，更不要为了“无法完成”单独加一条假路径或结束节点。

续接同一个机器人会话时，服务会重新装好同名的 `structured_output` 工具，续接轮次同样要交回匹配 `output` 的 JSON。格式 3 启动时会清理旧版本运行，所以不会读到没有 `output` 的旧快照。

prompt 只做占位符替换，不求值：`{{goal}}`、`{{step}}`、`{{runId}}`、`{{nodes.<id>.text}}`、`{{nodes.<id>.data.<path>}}`、`{{nodes.<id>.route}}`、`{{nodes.<user id>.answers.<问题 id>.selected}}` / `.custom`，以及附件路径 `{{nodes.<id>.attachments.<index>.text|path|name|bytes|description}}`。

**模板引用校验**（`buka_workflow_plan` 阶段）：

- 根路径只能是 `goal` / `step` / `runId` / `nodes`；
- `{{nodes.<id>.<field>}}` 的节点必须存在；robot 节点提供 `text` / `data` / `route` / `attachments` / `robot` / `sessionId`，user 节点提供 `text` / `route` / `answers`（以及 `answers.<问题 id>.selected` / `.custom`），不提供 `data` / `attachments` / `robot` / `sessionId`；`route` 只在节点有出边时可用；
- `{{nodes.<user id>.answers.<问题 id>...}}` 的问题 id 只能是 `route`（仅当该节点有出边）或 `questions` 里声明过的 id；`answers.route.selected` 是选中项的 `label`，路由请用 `{{nodes.<user id>.route}}`；非法路径在计划阶段报错；
- `{{nodes.<id>.data.<path>}}` 必须落在该节点声明的 `output` 里：对象按 `properties` 下钻；数组必须是数字下标且声明了 `items`；`oneOf` 要求所有分支都存在。即使 `additionalProperties` 允许，引用未声明字段也会在计划阶段报错；
- `data.next` / `data.abort` / `data.attachments` 是引擎保留字段，请改用 `{{nodes.<id>.route}}` / `{{nodes.<id>.attachments.<index>...}}`。

运行期值不存在时该节点仍然会失败（这里只校验 schema 存在性，不推断节点在这条边上是否已经执行过）；`.text` 对二进制 / 超大附件不可用。

## 用户介入节点语义

`user` 节点是定义里的显式**用户介入点**，用来把只有人能做的事带回流程。三种用法是同一件事：等用户做决定、等用户完成一个手动操作（例如在某处点一下、把设备接上）、等用户查看一个只有人能看的结果并给反馈。它不建机器人会话，执行到它时流程暂停：

1. 运行状态置为 `waiting`，`run.pendingUser` 记录 `title`、渲染后的 `detail`、选项（每条出边的 `name` / `label` / `description`）、原始 `questions` 与创建者会话 id（页面「打开会话」用它）；事件流写 `user/waiting`。
2. 插件用 DSH 的 `userQuestions.ask()` 提交一个问题批次：有出边时第一条是 route 问题（`header` 是 `title`，问题正文是 `detail`，选项就是出边的 `label`），随后是定义里的 `questions`（`multiSelect` 原样传递）；没有出边时只有追加问题。
3. 用户选一项后，运行续上：选中项的 `label` 反查回对应的出边 `name`，作为这次执行的 `route`；追加问题的答案也一并写进这次执行。没有出边、只收问题的 user 节点回答完直接按 `completed` 收尾。
4. 用户跳过选择（没选任何选项，包括只填了自定义文本）→ 运行 `cancelled`；选不出合法选项 / 提问服务不可用 / 其它错误 → `failed`；用户取消这一轮 → `cancelled`。答案落盘后写事件 `user/answered`。

`title` 是提问卡的 header（必填，≤ 200 字符）。`detail` 是展示给用户的说明（可选，≤ 4000 字符），支持和边 prompt 相同的模板（`goal` / `nodes` / `step` / `runId`），适合把前面机器人的结果带给用户看：`请检查 {{nodes.check.text}} 后选择下一步`。

`next` 就是用户的选项，每条边是 `{ "to", "name", "label", "description"?, "prompt"? }`：

- `name`：路由键，同一节点内唯一，≤ 120 字符；机器人结果 / 运行记录里的 route 用它；
- `label`：**显示给用户的选项文字**，必填，同一节点内也必须唯一（回答按 label 反推边），≤ 120 字符；
- `description`：选项说明，可选，≤ 500 字符；
- `to`：目标节点；目标是 `robot` 时 `prompt` 必填（这次进入的任务），目标是 `user` / `end` 时禁止带 `prompt`。

`questions` 用来收集额外信息 / 反馈（与选项相互独立，最多 4 条；加上 route 问题共 5 条）：

```jsonc
"questions": [
  {
    "id": "notes",              // 必填，[A-Za-z0-9_-]{1,64}，同一节点唯一，不能叫 route
    "header": "修改意见",        // 可选，≤ 200 字符
    "question": "哪里需要改？",   // 必填，≤ 1000 字符
    "multiSelect": false,       // 可选：是否多选
    "options": [                // 可选，≤ 20 个；label 必填且同一问题内唯一
      { "label": "界面", "description": "调整布局与文案" }
    ]
  }
]
```

`next` 与 `questions` **至少要有一个**，否则节点没有任何等待内容。user 节点没有 `output`（它的输出固定是用户的回答），也不能在节点上写 `prompt`。

回答会写进这次执行，并成为模板上下文：

| 路径                                        | 值                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{{nodes.<id>.text}}`                       | 整份答案的可读文本（第一行是 `选择：<选中的 label>`，之后每个问题一行 `<header 或 question>：<selected 用、连接>`，有自定义输入时追加 `（<custom>）`） |
| `{{nodes.<id>.route}}`                      | 选中的出边 `name`；没有出边时不可用                                                                                                                    |
| `{{nodes.<id>.answers}}`                    | 整份答案对象                                                                                                                                           |
| `{{nodes.<id>.answers.<问题 id>}}`          | `{ selected, custom }`                                                                                                                                 |
| `{{nodes.<id>.answers.<问题 id>.selected}}` | 选中的选项数组（模板里会 JSON 化）                                                                                                                     |
| `{{nodes.<id>.answers.<问题 id>.custom}}`   | 自由输入，没有时是 `""`                                                                                                                                |

`questionId` 只能是 `route`（仅当节点有出边）或 `questions` 里声明过的 id；`answers.route.selected` 是选中项的 `label`，路由请用顶层 `route`。user 节点不提供 `data` / `attachments` / `robot` / `sessionId`。机器人会话自己请求的工具审批 / 向用户提问仍然是会话内交互，不占用 user 节点，运行页用 `pendingInteraction` 提示（见「页面」）。

### 从格式 2 迁移

- `gate` 节点换成 `user` 节点：`title` 保留，`detail` 保留（现在支持模板）；`onApprove` / `onReject` 改成 `next` 里的普通出边，每条边补上 `name` 与显示给用户的 `label`；原来省略目标的那一侧改成不写这条边（或只用 `questions` 收反馈）。
- 定义里出现 `gate` 或 `onApprove` / `onReject` 会直接报迁移错误，不会自动转换；模板里旧决策字段改为 `route` / `text` / `answers...`。
- 格式 3 启动时清理格式 2 的运行目录，运行编号从 `#1` 重新开始，`settings.json`（自动归档设置）保留。
- 新定义里含 user 节点就必须前台运行；机器人会话内的工具审批 / 用户提问不属于 user 节点。

## 循环

定义里允许成环：某条出边可以指回前面的节点，甚至指回自己，机器人用结果里的 `next`（出边的 `name`）选择回边。校验与调度不把环当错误，而是靠两道上限兜底：

- `maxSteps`：本次运行的节点执行总次数（默认 64，部署侧上限 256）；
- 机器人节点的 `maxVisits`：同一个机器人节点最多被进入几次（`user` 节点不计入）。

超出任一项时运行以 `failed` 结束并记录原因（`exceeded its N-step limit` / `exceeded its N-visit limit`），已经产生的步骤与最终文本都会保留。

循环在页面上这样表达：同层 / 并行分支的节点并排成一行；相邻层的连线从节点上下端口直接连出，跨层 / 回边 / 自环则走左右两侧的竖线 lane（两端圆角转弯），同一侧的 lane 按互不重叠的层区间分配，所以同一侧 lane 上的连线不会中途交叉；两条边各带一个方向箭头，一进一出围成环，不再额外画循环图标。被重复进入的胶囊右侧显示 `×N` 访问次数（节点抽屉里也会写「执行次数」）。一次运行没走到的节点（例如机器人没选择的另一条出边）是**灰色虚线胶囊**，仍留在它的拓扑层里，不会被排到结束节点后面。

循环里需要给“再次进入”的节点不同指令时，把完整提示词写在回到它的那条边上（该边的 `prompt`，见「边」），并给回边和正向边不同的 `name`（例如 `fix` / `retest`），机器人靠结果里的 `next` 选择。节点本身不写 prompt，每次进入由被走到的那条边给出，所以首次进入和测试打回可以读起来完全是两件事。

## 并发（fan-out / join）

一个机器人可以把结果里的 `next` 写成**一列出边 name**，一次启动多条出边、并发执行（fan-out）：

```json
{ "next": ["后端", "前端"] }
```

启动的多个任务在节点图里是若干条指向不同机器人节点的出边；单值 `next`（字符串）仍然是一条边，完全向后兼容。

要用 **join 节点** 把并发分支重新汇聚（比如「多个仓库并行开发 → 合并」）：

```json
{
  "type": "join",
  "id": "合并",
  "inputs": ["后端", "前端"],
  "next": [{ "to": "集成", "prompt": "各仓库都已完成，开始集成。" }]
}
```

- `join` 是纯屏障：不建会话、没有 `robot` / `output` / `result`，出边**恰好一条**（`prompt` 是下游机器人进入时的指令，同 start）；
- `inputs` 是它要等的**机器人节点 id 列表**；放行条件是「这一波 fan-out **实际启动**的那些 input 全部完成」——没被启动的 input 直接忽略；
- 一个任务可以同时出现在多个 join 的 `inputs` 里（它完成时喂给所有引用它的 join），所以**重叠分组**天然成立：例如 source 有 1..8 八条候选边、这一波启动了 1..6，`X.inputs = [1,2,3,7]` 会在 1、2、3 完成后放行，`Y.inputs = [3,4,5,6,8]` 会在 3、4、5、6 完成后放行，任务 3 同时喂给 X 和 Y，7、8 没启动所以不等；
- fan-out 是 `next` 数组，join 的入边是 `inputs`（不是图上的 `next`），所以一个机器人可以既 fan-out 又作为任务喂给 join；
- 任一并发分支 `abort` / 失败 → 整体 `failed`，其余活跃分支被取消（fail-fast）；
- join 可以嵌套：join 的下游机器人再 fan-out、再 join，构成多级并行；`maxSteps` 统计全部执行总数，`maxVisits` 仍按节点生效。

页面上 join 显示为一种独立胶囊；它到下游的连线来自 `next`，上游任务到它的连线来自 `inputs`（隐式入边）。

## 观察者、恢复与超时

**执行模型**：含 `user` 节点的定义在前台运行——工具调用一直持续到运行终止，用户每在提问卡里作答一次，流程继续推进；user 节点不建会话，不需要观察者等待会话结果（但它的 `seq` 同样计入 `maxSteps`，且不受 `maxVisits` 与节点超时约束）。不含 user 节点的后台运行把节点 prompt 投进机器人会话后，工具就返回 `runId`，不再 await 会话的 `result`。插件里常驻一个 Host 生命周期的观察者（[`src/supervisor.ts`](src/supervisor.ts)）：

- 订阅全局 `session/event`（只关心 `turn/end`）、`session/disposed` 与 `agent/disposed`；只处理自己这次 run 登记过的会话，其他会话的事件直接忽略；
- `turn/end` 后从会话日志读这一轮的文本、`stopReason` 与结构化结果，写 step、落节点结果、按 JSON 的 `next` 走对应的出边，再 dispatch 下一个节点；
- 一个 run 同时只有一个活跃节点；同一个 run 的推进串行排队，避免事件竞争导致重复 dispatch。运行状态以磁盘上的 `run.json` 为权威，内存里只有活跃句柄；
- 插件卸载 / 热重载时取消活动轮次并释放句柄，但保留 `running` 记录，下次加载继续恢复。

观察者还监听机器人会话里的**用户提问**与**工具审批请求**：出现时写进 `run.pendingInteraction`（`kind: question` / `approval`，含 node / visit / seq / robot / sessionId、问题或工具名与原因、`askedAt`），运行页详情顶部据此提示「机器人正在等待你回答 / 批准」并给「打开会话」按钮；用户在会话里回答或批准后清空。运行结束或标成 `interrupted` 时也会清空。

**会话中断恢复**：`session/disposed`、`agent/disposed`，或 `turn/end` 的结束原因是 `aborted` / `interrupted` / `error` 时，观察者只尝试把**同一个会话**接回来：

1. 先用 `ctx.bukaRobots.openSession()` 打开同一会话；如果发现上一轮其实已经结束（`turnEnded`），直接收结果、写 step，不再追问；
2. 否则先 compact 这个会话，再往同一会话发一条中性的「继续」prompt（重申输出契约：交回 JSON；有出边时带 `next`），接着这一轮继续等结果；
3. 会话打不开、续接失败、旧版 robots 返回隐藏 subagent 句柄、或旧版服务用新会话替代（`resumeError` / sessionId 变了）时，节点按 `error` 结束、运行 `failed`，错误里写清节点、sessionId 与原因；**不会用原 prompt 新开会话**。会话不可恢复就是这次运行的终点。

不再有 `recoveryAttempts` 配置：每次中断只尝试一次续接，失败即终止。恢复成功时 step 上仍带 `recovered: true`（`recoveryAttempts` 固定为 `1`），事件流里是 `node/recover` / `node/resume`；运行中的 `run.current` 在恢复时带 `recovering: true`，运行页显示「恢复中（第 1 次）」。

**启动恢复**：`store.init` 不再把遗留的 `running` / `waiting` 一律标成 `interrupted`。插件启动时 `ensureReady()` 调用观察者的 `resumeAll()`，读出所有未完成的运行（按创建时间升序，最多同时恢复 4 个）：

- 先等 `ctx.bukaRobots` 出现（最多 5 秒）；服务始终不可用时，把全部未完成运行标成 `interrupted`，原因写明「Buka Robots 服务不可用」；
- 定义里含 `user` 节点的运行：重启后无法重建原生提问卡，直接标 `interrupted`，原因写明「这次运行包含用户介入节点；提问卡需要调用者有活跃 turn，重启后无法重建」；`waiting` / 存在 `pendingUser` / `current` 是 user 节点的运行同样直接标 `interrupted`，原因写明「宿主机重启时运行正在等待用户回答，提问卡无法重建」；
- 缺定义快照、`current` 不是机器人节点、`current` 缺 prompt、或节点在定义里不存在：标 `interrupted` 并写明原因；
- 有 `current` 且是机器人节点：按「会话中断恢复」的同一套逻辑先 `openSession` 检查上一轮是否已结束，否则发「继续」prompt；没有记录会话 id、`openSession` 失败、返回隐藏 subagent 句柄、或旧版服务换回了新会话时，把运行标成 `interrupted` 并写明原因，**不会新开会话**；
- 没有 `current`：从最后一条 step 的出口推导下一个节点（一次都没执行就从 start 节点的出边开始）；没有下一步就直接按 `completed` 收尾。

恢复会写事件 `run/recover`，续接的节点写 `node/resume`。

**超时默认关闭**：

- Config `nodeTimeoutMs` 默认 `0`（`0` = 不超时）。没有硬截止的节点让会话按自己的节奏跑完；
- 需要边界时在定义里给机器人节点写 `timeoutMs`（毫秒，上限 24 小时），它是唯一的硬截止；
- `user` 节点不适用节点超时：它只等待用户回答，不设硬截止；`timeoutMs` 只对机器人节点生效。
- 计时由观察者负责，从 prompt 真正投递后起算（新建 / 续接 dispatch 之前的 compact 不计入；中断恢复沿用这个节点原来的起点）；到点调用句柄的 `cancel()` 取消当前轮，这次执行记成 `stopReason: "timeout"` 与 `timedOut: true`，运行 `failed`，事件 `node/timeout`；
- 超时**不进入恢复重试**：它是定义里的硬边界，不是会话意外中断，所以不会发「继续」prompt、也不会新开会话；
- robots 插件的 `startSession()` 也不再自带默认超时（旧版本是 10 分钟）。

## 页面

侧边栏新增「工作流」条目（观测页面，唯一的写操作是保存「自动归档设置」），页签条上分「运行」与「模板」两页：

- 「运行」页是既有的运行观测页（列表 / 详情 / 节点图 / 自动归档设置），见下文各条。
- 「模板」页展示随插件发布的**抽象工作流模板**目录：每张卡片是模板名字 + 一句描述（什么时候该参考它），点开详情后像运行详情一样画成**分层二维节点图**——每个机器人节点显示抽象角色名与步骤概要（例如「开发」「测试」），不是真实机器人，并带「仅供参考」的提示；点节点胶囊从右侧抽屉看它的**目的**与**流转去向**（每条出边连同条件 / 提示词），点任意连线还能在抽屉里看这条边的路由与提示词。模板没有执行状态：胶囊按节点类型上色（与运行页同色），连线画成中性实线表达流程走向（模板数据不带 `tone`；渲染器对带 `tone` 的边同样会按成功 / 失败上色），页脚图例只列节点类型与「流程走向」，不出现「未运行 / 已走过 / 未走过」。模板不是可运行定义，也不从这里启动：编排 agent 在会话里用只读工具 `buka_workflow_templates` 读同一份目录，参考流程后用 `buka_robots` 看真正拥有的机器人、把角色替换成真实机器人并补上 `output` 与具体 prompt。模板目录由 Host 路由 `GET /buka-workflows/templates` 提供（每份模板还附带一份算好坐标的图模型），是随插件发布的静态数据。

- 列表：最近运行的状态、目标、`#N` 序号、runId 与开始时间；卡片显示 `#N`，已归档的卡片带「已归档」标签；有 `run.pendingUser` 或 `run.pendingInteraction` 的运行还带「等待用户」标签。默认只列未归档的运行，标题右侧工具栏的「已归档（N）」切到归档列表（标题变成「已归档的工作流」），归档视图里点标题左侧的返回箭头切回；
- 详情标题是 `#N · 目标`（`#N` 是这次运行的序号）；运行在 user 节点等待用户时，在图上方先显示一条告警提示：标题是「工作流正在等待你介入」，正文是节点的 `title` 与渲染后的 `detail`，列出选项 `label`（带 `description`）与追加问题，并带「打开会话」按钮——回答只能在工作流创建者的会话里做，提示里也写明这一点；有 `run.pendingInteraction` 时另显示机器人会话内的等待提示：提问显示「机器人正在等待你回答」+ 第一条问题，审批显示「机器人正在等待你批准 <工具名>」+ 原因 / 说明，都带「打开会话」按钮（跳到该机器人的会话去回答或审批）；详情以**分层二维节点图**为主体：同层 / 并行分支的节点并排成一行，相邻层的连线从节点上下端口连出；图没有外框，宽度超出页面时横向滚动，节点本身是一个固定宽度的**胶囊**——开始节点显示「开始」、机器人节点显示创建者写的步骤概要（旧定义没有 `summary` 时退回机器人名）、user 节点显示 `title`、终止节点显示 id；机器人节点的胶囊前还会显示该机器人的**预设头像**（来自 robots 服务的 `avatarMap()`；插件没装或机器人已删除时不画头像，图照常显示）；胶囊颜色区分节点类型（开始 / 机器人 / 用户 / 终止），没有字母角标；这次运行没走到的节点是灰色虚线胶囊，重复进入的节点在胶囊右侧显示 `×N`；
- **绕行线按 lane 分层，同层节点并排**：同层 / 并行分支的节点并排成一行，相邻层的连线从节点上下端口直接连出（直线或三次曲线）；跨层连线、回边与自环走左右两侧的竖线 lane，同一侧的 lane 按互不重叠的层区间分配——嵌套的区间自然分到不同 lane，不会在中途交叉；所有连线都带方向箭头；指向同一目标的多条边合并成一条线（名字并列展示），走过的连线高亮；**定义里带 `tone` 的边按成功 / 失败上色（绿 / 红），颜色优先于「已走过」的品牌蓝和悬停色，但仍保留线宽、实线 / 虚线与压暗状态**；**鼠标悬停到连线上会把这条线变成实线并略粗一点、压暗其余连线，名字以小标签显示；点击则在右侧抽屉展开完整配置**（user 边显示用户看到的选项文字 `label`，机器人边显示路由名 `name`）；正在执行的胶囊带呼吸边框，等待用户作答的 user 节点胶囊为告警色；
- 点击胶囊，从右侧 560px 抽屉展示该节点的详细信息（机器人节点的标题旁同样带这个头像）：**标题就是步骤概要**（创建者写在 `summary` 里的那一行；没有 `summary` 时退回机器人名），节点 id 只作为标题旁的小号代码标签；机器人节点下面是**执行人**与节点配置；user 节点展示 `title` / `detail`（等待中优先取 `run.pendingUser.detail`）；终止节点的详情展示**终止状态**与**最终输出**——最终输出不是定义里写死的文案，而是这次运行**最后一次有正文或附件的机器人执行**，下面标出来源节点与第几次执行，点一下回到那次执行。机器人节点的详情顶部只展示该节点的**一个会话**（每个节点只对应一个会话；运行中的节点在进入后就能看到 sessionId），可直接「打开会话」跳到对话。会话按「运行目标 · 机器人」命名，所以侧边栏里能直接认出是哪次运行的哪段对话；重复进入时页签会标出「已压缩历史」（续接本来就是常态，不再单独标注），压缩失败会在页签里提示但不阻断执行；续接失败时运行直接终止，错误写在节点与运行记录里。节点在跑时详情里的耗时是**实时**走的（页面每次刷新重算，不必等结束）。其余节点按**执行拆分的 Tab**——每次进入节点一个 `#N` 页签，页签里依次是这一次的任务信息（那一次落盘的渲染后提示词；user 节点是渲染后的 `detail`）、输出结果（最终文本与附件；user 节点是你的答案文本）、状态 / 时间 / 时长，以及这次走出的 route 名（小标签；user 节点显示选中选项的 `label`，找不到时退回 `name`）；执行 Tab 不再重复节点级已经展示过的会话 id 与「打开会话」，只对不属于这个节点会话集合的旧执行保留入口。再次进入（visit > 1）的那次执行没有落盘 prompt 时显示「这次执行没有记录输入」，不会把定义里的提示词模板当成那一次的输入。恢复过 / 超时的执行在页签顶部带「已恢复」「超时」标签；页签底部是**上一步 / 下一步**两个方向：左侧回到运行里的上一次执行（本次运行的第一次执行回到开始节点，开始节点本身不执行），右侧到这次执行把运行带到的下一次执行（最后一次执行则指向运行结束的终止节点），点一下就会切到那个节点并打开那一次执行。进入运行详情不会自动选中 / 打开节点，点胶囊才打开抽屉；关闭抽屉（关闭按钮 / Esc / 遮罩）后回到无选中状态。没执行过的机器人节点只有概要（prompt 在边上，第一次执行时才看得到）。出口只在图上表达；**输出结果展示最终文本与附件预览 / 下载**：JSON 只用于路由与模板，不按 key/value 铺在页面上、也不展示原始 JSON，只把这次走出的 route 名标出来。start 节点在标题旁标「起点」，它的详情只说明自己不执行、第一条边的 prompt 在目标节点的第一次执行里，没有执行 Tab；定义校验阶段就拒绝不可达节点，正常记录里不会出现，页面仍保留「不可达」的兜底说明；点任意连线（包括没有名字的边）会从右侧 560px 抽屉展开这条边的配置：来源 → 目标、路由键、user 选项的 `label` / `description`、进入提示词（原始模板，走到这条边时才渲染）、外观色 `tone`、是否回边，运行页还标出是否走过、走过几次，模板页不显示运行状态行。节点抽屉和连线抽屉互斥（打开一方会关闭另一方）；附件预览可以叠在节点抽屉之上，关闭后回到节点抽屉。页脚保留图例，并提示「点击节点查看详情，点击连线查看配置」。
- 不自动选中节点；点击胶囊才打开节点抽屉（运行中 / 等待中的节点仍在图上按状态高亮）；
- 工具栏的「归档设置」按钮打开「自动归档设置」对话框：自动归档开关（默认启用）、归档时间（小时，默认 24）、删除时间（小时，默认 168）；时间只能填整小时，归档时间范围 1–720、删除时间范围 2–8760，删除时间必须晚于归档时间，否则对话框会提示并拒绝保存。保存后立即生效，并马上执行一次清理；
- 页面底部的 footer 放图例（节点类型 / 状态色 / 连线含义）与「点击节点查看详情，点击连线查看配置」的提示；它固定在页面底部、不参与内容滚动，内容再长也不会把它顶下去；
- 页面本身不创建、不启动工作流——定义由编排 agent 在会话里现场生成，页面只负责观测（唯一的写操作是保存自动归档设置）。打开页面期间会定时刷新：有运行在跑（`running` / `waiting`）时每 1.5 秒，否则每 5 秒，所以后台运行的节点进度、节点会话与运行中节点的实时耗时也能看到。

附件预览抽屉在**运行页内**打开，不跳转会话、也不离开运行页（执行 Tab 与终止节点的最终输出里，附件文件名都是可点的按钮；下载入口保留）。文本 / Markdown / 代码走 Host 的 `mode=preview` 预览，图片与 PDF 走 `mode=inline` 取原始字节；文本预览只读前 64 KiB，超出时提示已截断，仍可下载完整文件。Office（docx / pptx / xls / xlsx）、压缩包等二进制显示「无法预览」并提供下载。抽屉可用遮罩、Esc 或关闭按钮关闭；页面定时刷新只更新底层数据，不会关闭、清空或重置已经打开的预览。

图模型由 Host 侧纯函数 [`src/graph.ts`](src/graph.ts) 生成：把定义快照（节点、出边、user 选项）与状态快照（`steps`、`current`、`pendingUser`、`result`）合成节点状态、连线的「是否走过 / 走了几次 / 是否循环边 / 边名字（user 边额外带 `label`）/ 外观色 `tone` / route」，再算好**分层坐标**——按拓扑层级把节点排成二维网格（同层 / 并行分支的节点同一行、并排），边从节点的上下端口进出，相邻层直接连、跨层 / 回边 / 自环分配到左右两侧的 lane，同一侧的 lane 按互不重叠的层区间分配——以及 SVG 路径与方向箭头；浏览器一半只负责渲染。`tone` 只保留 `success` / `failure`，缺失或非法值归一成空串；多条边合并成一条线时取第一条有值的 `tone`。节点上还有一个 `unreachable` 标记（从 `start` 出发没有路径到达），只作为损坏 / 手工改动记录的兜底说明。运行详情接口在构建图模型时还会把 robots 服务的 `avatarMap()` 合进来，给 robot 节点填 `avatar`（只是展示信息，取不到时是 null）。这样布局与状态推导都能直接单测（含分层与同层并排、两侧 lane 的区间不重叠与同层节点不重叠的几何断言、循环的访问次数、自环与合并的重复连线、合并边的名字与 tone）。

节点结果（`nodes/<seq>-<node id>/result.json`）除了输出文本、结构化数据与附件清单，还会保存那一次的**渲染后提示词**（`prompt`）与走出的 route（`route` / `routeTo`），所以页面上的每次执行都能回看自己的输入和去向；user 节点不写 `result.json`，那次执行只记在 `run.steps[]` 里（渲染后的 `detail`、答案文本与 answers，见「落盘位置」）；旧记录的 `nodes/<seq>-<node id>.json` 仍然可读；节点刚进入、还没结束时也会先写一份 `status: "running"` 的结果，页面因此在 dispatch 后就能看到这次执行的任务信息。没有落盘 prompt 时，再次进入（visit > 1）显示「这次执行没有记录输入」，不会把定义里的提示词当成那一次的输入。

页面的运行数据通过 Host 的路由取数：`GET /buka-workflows/runs`（可带 `?archived=1` 只列已归档，响应带 `archivedCount`）与 `GET /buka-workflows/run?runId=...`（返回 `run`、`definition`、`nodeResults` 与算好坐标的 `graph`）；自动归档设置走 `GET/POST /buka-workflows/settings`；都沿用 web 组合的信任栅栏。

附件统一走 `GET /buka-workflows/attachment?runId=&seq=&nodeId=&name=[&mode=download|preview|inline]`（只接受节点清单里的文件；客户端从不拿到文件系统路径，全部按 runId / seq / nodeId / name 走这条同源路由）。`mode` 有三种取值：

- 省略 `mode` 或 `mode=download`（默认）：按 `application/octet-stream` + `content-disposition: attachment` 返回原始字节，与既有下载行为一致。
- `mode=preview`：返回 JSON `{ ok: true, attachment: { name, bytes, kind: 'text' | 'image' | 'pdf' | 'binary', mime, text?, truncated?, read?, offset? } }`。文本只读前 64 KiB（`truncated` 标记是否截断，`read` / `offset` 是本次读取的字节数与起点）；图片 / PDF 只返回元数据（`kind` / `mime`），正文走 `mode=inline`；读不出 UTF-8 的降级为 `kind: 'binary'`（`mime: null`），页面显示无法预览 + 下载。
- `mode=inline`：仅图片（png / jpg / jpeg / gif / webp / bmp / ico / svg）与 PDF，返回原始字节，`content-type` 用白名单 MIME、`content-disposition: inline`、`x-content-type-options: nosniff`、`cache-control: no-store`；SVG 额外带 `content-security-policy: script-src 'none'; object-src 'none'`；其它类型返回 415 `unsupported-preview`。

错误码：参数不合法返回 400（`invalid-mode` / `invalid-seq` / `invalid-attachment` / `invalid-run-id`），运行 / 执行 / 附件不存在返回 404 `not-found`，`mode=inline` 请求非图片 / PDF 返回 415 `unsupported-preview`，读文件失败返回 500 `read-failed`。

## 落盘位置

默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/runs`，可用 Config `runsDir` 覆盖：

```yaml
- id: tool-buka-workflows
  name: "@buka/dsh-plugin-workflows"
  config:
    runsDir: ~/workflow-runs
    maxRuns: 200 # 已归档运行最多保留多少条
    nodeTimeoutMs: 0 # 节点默认硬超时；0 = 不超时（默认）
    maxSteps: 64
    maxAttachmentBytes: 8388608 # 单个附件 8 MiB
    maxAttachmentsPerNode: 20
    maxNodeAttachmentsBytes: 67108864 # 每个节点附件总量 64 MiB
    maxInlineAttachmentBytes: 32768 # prompt 内联单个文本附件 32 KiB
    orchestratorPresets: [workflow-orchestrator]
    robotPreset: standard
```

`maxRuns`（默认 200）只限制**已归档**记录的数量；归档 / 删除的时间由页面上的「自动归档设置」控制，配置里没有按天数保留的项。`nodeTimeoutMs` 默认 `0`（不超时），需要边界时优先在定义里给节点写 `timeoutMs`。附件上限（`maxAttachmentBytes` / `maxAttachmentsPerNode` / `maxNodeAttachmentsBytes` / `maxInlineAttachmentBytes`）默认 8 MiB / 20 个 / 64 MiB / 32 KiB，可按部署需要调整。

每次运行一个目录，运行目录同级还有一份序号计数器：

```text
runs/
  sequence.json    运行序号计数器；和各个运行目录同级，新建运行时递增
  <runId>/
    definition.json  本次一次性定义的快照（`version` 为 `WORKFLOW_FORMAT_VERSION`，当前 3）
    run.json         权威状态快照（原子写，含 `version`、这次运行的序号 `seq`、当前节点 `current`、`pendingUser`、`pendingInteraction`、机器人会话 `sessions` 与执行记录 `steps`）
    events.jsonl     追加事件：node/start、node/session、node/end、node/recover、node/resume、node/timeout、interaction/asked、interaction/settled、user/waiting、user/answered、run/recover、run/end …
    nodes/<seq>-<nodeId>/
      result.json       节点结果全文（那次渲染后的 prompt、输出文本、structured、附件清单、route / routeTo 等）
      attachments/      该次执行的附件文件
```

**格式版本与清理**：`definition.json` 与 `run.json` 的 `version` 当前是 `3`。`store.init()` 在回填 / 清理前会遍历 `runs/` 下的运行目录：`run.json` 或 `definition.json` 的版本不是 3、缺失、或 JSON 损坏时，整目录删除（连同节点结果、附件与事件）；如果所有运行都被删掉，`sequence.json` 也一起删掉，下一次运行重新从 `#1` 开始；`settings.json` 在 `runs/` 的父目录，不受影响。这里**不提供迁移或兼容**，旧格式的定义与运行记录都不会被读取。

`run.current` 是正在执行的那一个节点（`nodeId` / `visit` / `seq` / `type` / `prompt` / `sessionId` / `startSeq` / `startedAt`；user 节点是 `type: "user"`、`robot: null`；恢复时还有 `recovering`，`recoveryAttempts` 固定为 `1`）；`run.pendingUser` 是正在等待用户作答的 user 节点（`nodeId` / `visit` / `seq` / `title` / 渲染后的 `detail` / `options[{name,label,description}]` / `questions` / `requestedAt` / 创建者 `sessionId`，见「用户介入节点语义」），`run.pendingInteraction` 是机器人正在等待的用户交互（见「页面」），没有时都为 `null`。`run.steps` 每次进入节点一条（含 `sessionId`、`stopReason`、`resumed`、`compacted`、`route` / `routeTo`、附件清单 `attachments`；user 执行没有 `sessionId`，带 `answers`（规范化后的问题答案）与可读文本 `text`，`input` 是渲染后的 `detail`；恢复 / 超时还带 `recovered` / `recoveryAttempts` / `timedOut`）。`run.sessions` 按机器人汇总会话，每项是 `{ robot, sessionId, visits, entries }`，`entries` 每次进入一条 `{ nodeId, visit, seq, sessionId, at, resumed, compacted }`：一个机器人在一次运行里只有一个会话，再次进入先 compact；续接失败时运行直接终止，不会换会话。

「自动归档设置」不存在运行目录里，而是持久化在 `runsDir` 的父目录（默认 `~/.cache/dsh-plugin-workflows/settings.json`），删掉某个运行目录不会影响设置：

```jsonc
{
  "version": 1,
  "archive": {
    "enabled": true, // 自动归档开关，默认启用
    "archiveAfterHours": 24, // 超过多少小时归档，默认 24（1 天），范围 1–720
    "deleteAfterHours": 168 // 超过多少小时删除，默认 168（7 天），范围 2–8760
  }
}
```

两个时间都按整小时填写，删除时间必须晚于归档时间。

启动时会：先按上面的格式版本清理 `runs/` 里的旧版本 / 损坏记录，再由观察者尝试恢复未完成的运行（见上文「观察者、恢复与超时」），确实无法恢复的才标成 `interrupted`、把原因写进 `error`；给还没有 `seq` 的当前版本记录按创建时间回填序号，最后按「自动归档设置」清理到期的运行。

## 运行序号与自动归档

每次运行都有一个人能看懂的序号 `#N`：Host 在创建运行时分配，按创建顺序持久递增（从 1 开始），写进 `run.json`，并由 `runs/sequence.json` 计数器记录下一个可用序号。同一格式版本内删除旧运行**不会**回退或复用编号；升级到格式 3 时会删掉旧版本运行、编号重新从 `#1` 开始。当前版本里还没有 `seq` 的记录，启动时会按创建时间排序回填。列表卡片、详情标题（`#N · 目标`）和 `buka_workflow_status` 的列表都显示它，`buka_workflow_start` 在后台模式下的返回值也额外带 `seq`。

运行记录的归档 / 删除按下述规则进行（设置的位置与字段见上一节「落盘位置」）：

- 只有**已结束**（非 `running` / `waiting`）的运行参与；仍在运行的运行永远不会被归档或删除；
- 按**结束时间**计龄，没有结束时间时退回最后更新时间、再退回创建时间；
- 超过归档时间（默认 24 小时）→ 给 `run.json` 写入 `archivedAt`，记录标记为已归档并从默认运行列表隐藏；标题右侧工具栏的「已归档（N）」能看到它们，点标题左侧的返回箭头切回；
- 超过删除时间（默认 168 小时）→ 整个运行目录被删除，**不可恢复**。

清理（sweep）在启动时、每小时、以及保存设置后立即各执行一次。关闭自动归档开关后不再按时间归档或删除，已归档的记录仍在「已归档」里。Config `maxRuns` 只限制**已归档**记录的数量，已归档的多于 `maxRuns` 时从最旧的已归档运行开始删除；保留策略不再有按天数的配置项。

## 依赖与限制

- robot 节点需要先安装并启用 [`@buka/dsh-plugin-robots`](../robots)；它提供 `ctx.bukaRobots`（`list()`、`avatarMap()`、`dispatchSession()`、`openSession()`、`startSession()`）。编排器通过 robots 插件的只读工具 `buka_robots` 取机器人清单，其中每个机器人带一句职责（`description` 字段）；按职责选择节点用哪个机器人，不要凭空造机器人名；没有匹配的机器人时询问用户创建或选择，而不是硬凑。默认创建**普通顶层会话**并挂到机器人自己的工作区：`cwd` 是机器人目录，机器人的 AGENTS.md 与项目 skills 生效，侧边栏能看到、能直接打开；同一个机器人整个运行共用一个会话（按「运行目标 · 机器人」命名），后续进入由服务 resume 续接并先 compact，不再新开会话。普通会话创建失败或续接失败时节点直接报错、运行终止；不会退回 subagent，也不会新开替代会话。观察者用非阻塞的 `dispatchSession()` 投 prompt、用 `openSession()` 检查 / 续接中断的会话；它把节点的 `output` schema、出边 `name`（`next`）与内置附件能力合成 `structured_output` 的 `outputSchema`（并作为合法 route 交给结果追问）。机器人交回的结果不合法时，服务按 `resultRetries` 追问；工作流还会按声明的 `output` 做一次结果校验。
- 含 `user` 节点的定义是**同步**的工具调用：整条流程（含每次等待用户作答）占着编排器会话的这一轮 turn，因为原生提问卡要求会话有活跃 turn；用户点停止会取消运行。长流程尽量少放 user 节点；不含 `user` 节点的定义走后台：第一个节点 dispatch 后工具返回 `runId`，之后由观察者按会话事件推进，用 `buka_workflow_status` 或侧边栏页面跟进，`buka_workflow_cancel` 可以停。
- 编排 preset 的根会话才能创建 / 启动 / 取消工作流；机器人节点会话显式使用 `robotPreset`（默认 `standard`），因此不会继承编排 persona 或创建类工具，但会获得上面四个只读观测工具（可见性按运行记录里的 sessionId 判定）。
- 机器人是**普通会话**：以运行时根会话创建 / 续接（不挂回父会话），走正常审批策略；机器人可以在会话里请求工具审批或向你提问，这些交互出现在机器人会话，运行页用 `pendingInteraction` 提示并可直接打开会话。工作流不注入行为提示词，只给任务、输出契约与每条出边的含义，由机器人自己决定是否提问 / 申请审批。
- 运行数据不只是回看：它是运行状态的权威来源，会话中断续跑与宿主重启恢复都从落盘的 `run.json` / 节点结果重建上下文。每个机器人的会话日志由 DSH 持久化，仍然可以在侧边栏或运行页的「打开会话」里打开：节点结束释放 live agent 时，robots 服务会把这条仍然持久化的会话补通告回客户端（`api-session/added`），所以它不会在节点 / 运行结束后从侧边栏消失；运行页打开会话时如果客户端列表里还缺这条会话，会先补一次 `sessions.refresh()` 再打开。续接前的 compact 依赖宿主 `compaction` 服务（`@deepseek-ai/dsh-compaction-basic`，桌面 profile 默认禁用）；服务缺失时节点照常继续，但页签会提示“压缩服务不可用”，启用后才会真正压缩历史。
- 默认**没有节点超时**：模型速度、任务大小与网络差异都可能让一轮跑很久，硬截止容易误杀；确实需要边界时用定义里的 `timeoutMs`。原生提问卡（user 节点）仍然只能在创建者会话的活跃 turn 里弹，因此含 user 节点的运行无法在宿主重启后恢复，会标成 `interrupted`。
- 不引入第三方状态机/工作流库：五种节点、按 `next` 名字（user 节点按选项 `label`）选路、前台 user 作答与由会话事件驱动的后台调度足够小，接入 DSH 会话才是主要工作。

## 结构

- `src/index.ts`：Host 入口，只装配工具、路由、观察者与启动恢复。
- `src/client/index.ts`：界面入口，只装配侧边栏的只读运行页。
- `src/**`：定义校验、调度观察者、运行存储、图模型、模板、设置等实现模块。
- `lib/index.js`、`lib/client.js`：由 `pnpm run build:code && pnpm run build:clients` 生成的运行文件，提交进 git，不手改。
- `locale/*.json`、`docs/DETAIL.md` / `docs/DETAIL.zh.md`：展示文案来源与市场详情长文，由 `meta.detail` 指向。
- `market.json`、`icon.svg`、`cordis.patch.yml`：挂牌信息、市场图标与 bundle 补丁层。

## 单测

纯逻辑模块（定义校验、模板、输出 schema、路由、存储与格式清理、自动归档、图模型、设置、工具可见性、机器人只读工具）不 import DSH 包，由仓库根 `test/workflows-plugin.test.mjs`、`test/workflows-format-v3.test.mjs`、`test/workflows-format-version.test.mjs`、`test/workflows-output-schema.test.mjs`、`test/workflows-graph.test.mjs`、`test/workflows-settings.test.mjs`、`test/workflows-access.test.mjs` 、`test/workflows-session-tools.test.mjs` 与 `test/workflows-attachments.test.mjs` 直接用 `node --test` 覆盖，附件路由由 `test/workflows-attachment-route.test.mjs` 用最小 webServer / 会话桩覆盖 download / preview / inline、错误码与安全响应头；观察者由 `test/workflows-supervisor.test.mjs` 用最小会话桩覆盖（默认不超时 / 显式超时、会话中断续接、启动恢复、会话索引重建、user 节点前台等待 → 回答 → 继续、后台运行遇到 user 节点拒绝、等待用户时重启标 interrupted 等）；浏览器一半由 `test/workflows-client.test.mjs` 用最小 React 桩做渲染冒烟。
