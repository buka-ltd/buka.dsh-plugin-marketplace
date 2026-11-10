# @buka/dsh-plugin-workflows

由**编排 preset** 现场创建的一次性工作流：编排 agent 审视任务后写一份节点图，直接交给插件调度，跑到终止状态或异常为止。当前是**格式 v2**（`WORKFLOW_FORMAT_VERSION = 2`）：每个机器人节点都在定义里声明 `output`（节点结果 JSON 的 JSON Schema），交回 JSON 并用 JSON 里的 `next` 选择出边；定义校验阶段会按这些 schema 检查边 prompt 里的模板变量。会话中断只续接同一会话，续接失败直接终止运行；宿主重启后未完成的运行也能接着跑，续接失败则标成 `interrupted`。

设计的边界：

- **创建入口收窄到一个 preset**：创建 / 启动 / 状态 / 取消工具只对配置点名的 agent preset（默认是随插件发布的 `workflow-orchestrator`）的**根会话**可见，其他会话连这些工具都看不到；由该 preset 会话 spawn 出来的子会话同样看不到，避免机器人节点自己再开工作流。机器人节点会话只额外获得四个只读观测工具（见上文「工具」），不能创建 / 启动 / 取消工作流。
- **不是流程市场**：没有可复用的流程列表、编辑器或按流程生成的自定义工具。每次运行的定义都来自编排 agent 的那一次工具调用，侧边栏页面只是观测点。
- **一次性、无兼容包袱**：格式版本 `WORKFLOW_FORMAT_VERSION = 2`。插件升级 / 启动时会把 `runs/` 下旧版本（或缺失 / 损坏）的运行目录整目录删除，编号重新从 `#1` 开始；`runs/` 同级的 `settings.json`（自动归档设置）保留。不提供迁移、兼容，也不回放旧定义。
- **运行数据落盘，执行交给观察者**：定义快照、运行状态、事件流、节点结果与节点附件都写到插件目录，既是回看的依据，也是重启后恢复的权威状态。后台运行**不 await** 机器人会话的 `result`：Host 侧的 [`lib/supervisor.js`](lib/supervisor.js) 订阅全局会话事件，`turn/end` 后读结果、写 step、按 JSON 的 `next` 路由并投下一个节点；会话中断会续接，宿主重启后未完成的运行会自动恢复（等待审批的门禁运行除外，见下文「观察者、恢复与超时」）。
- **一个机器人一个会话，重复进入先 compact**：同一次运行里，同一个 `robot` 只在第一次进入时通过 `ctx.bukaRobots.dispatchSession()` 新开会话；之后任何节点再次进入这个机器人时都传回已记录的 `sessionId`，插件先对该会话执行一次 compact，再把这次边上的 prompt 发进同一个会话。这样机器人跨节点 / 循环保留上下文，又不会让会话无限膨胀。每次进入都会在 `run.sessions[].entries` 里留一条记录，运行页据此按节点展示会话。会话还会按「运行目标 · 机器人」显式命名（`title`），侧边栏里能直接认出是哪次运行的哪段对话。机器人会话显式落到普通工作 preset（Config `robotPreset`，默认 `standard`），不继承编排器的 persona 或创建类工具，只额外获得四个只读观测工具。
- **机器人是普通会话**：以运行时根会话创建 / 续接，走正常的审批策略（默认沿用部署策略；无头场景才显式 `approval: 'never'`），可以在自己的会话里请求工具审批或向用户提问。工作流**不注入任何行为提示词**，只给任务、定义的输出 schema 渲染出的结果契约与每条出边的含义；是否提问、是否请求审批由机器人按任务自己决定。机器人节点会话另外获得四个只读观测工具（运行总览 / 执行输入 / 执行输出 / 附件读取，见「工具」）。
- **节点输出是声明式的**：robot 节点必须写 `output`（节点结果 JSON 的 JSON Schema 子集）。引擎把 `output`、`next` 与内置的附件能力合并成 `structured_output` 的参数，并在计划阶段按 schema 检查边 prompt 里的模板变量；运行期结果不符合 schema 时在同一会话追问，额度用尽后节点失败。
- **门禁是独立节点**：`gate` 节点不建会话，执行到它时调用 `ctx.approval.request()` 弹一次原生审批框；批准 / 拒绝各走一条出边，也可以直接终止。
- **允许循环**：机器人用结果里的 `next`（出边的 `name`）选路，某条边可以指回前面的节点（或自己）。调度用 `maxSteps` 与机器人节点的 `maxVisits` 兜底，防止环不退出；页面上回边绕到轨道右侧、连线带箭头，重复进入的胶囊显示 `×N`。
- **图调度会话**：不含 `gate` 的定义在后台运行——第一个节点 dispatch 完成后工具立刻返回 `runId`，之后由宿主级观察者按会话事件继续调度，不占编排器会话的 turn；含 `gate` 的定义必须在本次调用内跑完，因为原生审批要求会话有活跃的 turn。
- **运行序号与自动归档**：每次运行按创建顺序分配持久递增的序号 `#N`（同一格式版本内删除旧记录不会回退编号；跨格式版本清理会从 `#1` 重新开始）；运行记录还会按页面上的「自动归档设置」自动归档 / 删除，详见下文「运行序号与自动归档」。

## 工具

| 工具 | 作用 |
| --- | --- |
| `buka_workflow_plan` | 只校验定义（含 robot 节点的 `output` schema 与边 prompt 的模板变量），返回规范化节点图或精确错误；建议在 `buka_workflow_start` 之前调用 |
| `buka_workflow_start` | 校验并启动一次运行。不含 `gate` 时后台执行：第一个节点 dispatch 后立即返回 `runId`，观察者继续按图调度节点会话，返回值还额外带这次运行的持久序号 `seq`；含 `gate` 时在本次调用内执行到终止状态并返回逐节点摘要 |
| `buka_workflow_status` | 按 `run_id` 读一次运行（后台运行会持续前进；宿主重启后未完成的运行会被观察者接着跑，等待审批的门禁运行除外）；省略 `run_id` 时列出最近运行，列表里的每一项都带 `#N` 序号 |
| `buka_workflow_cancel` | 取消仍在运行的后台运行；已结束的运行是无操作 |

没有向模型暴露“门禁决策”工具：授权只能由用户在原生审批框里做出。

### 机器人节点会话里的只读工具

每个由工作流创建的机器人节点会话还会看到四个只读工具。它们由 workflows 插件注册，但只对运行记录里出现过的机器人会话（`run.steps[].sessionId` / `run.sessions`）可见；运行结束或 DSH 重启后重新打开会话时，观察者会从落盘运行记录重建索引，工具仍然可用。手动机器人会话不属于任何运行，看不到这四个工具。

| 工具 | 作用 |
| --- | --- |
| `buka_workflow_overview` | 当前运行的总览：节点图、每个节点的概要/状态、执行序号列表与整体状态。只返回挑选后的紧凑字段，不含 prompt、最终文本、边的 prompt 或节点结果全文 |
| `buka_workflow_execution_input` | 按执行序号 `seq` 读取那次执行实际收到的输入：机器人节点是渲染后的 prompt，门禁是标题/说明 |
| `buka_workflow_execution_output` | 按执行序号 `seq` 读取那次执行的输出：机器人节点的正文、结构化 JSON、附件清单、route、停止原因与错误，门禁返回决策 |
| `buka_workflow_execution_attachment` | 按执行序号 `seq` 列出附件清单；传 `name` 时分段读取一个附件（默认 64 KiB，可带 `offset` / `maxBytes`）。二进制只返回元数据与绝对路径 |

执行序号来自总览的 `executions` 列表；每个执行都有独立序号，循环里重复进入同一节点也能精确区分。工具只读当前会话所属的那一次运行，不接受 `run_id`，也不写任何运行记录。运行中的机器人节点可以读输入，但输出要等这一轮结束；等待审批的门禁可以读标题/说明，但输出要等决策。

### 节点附件

附件是每个机器人节点**内置的能力**，用来交回与答案相互独立的文件和 / 或数据（二进制产物、压缩包、trace、大数据集等）；它不是输出通道，答案本身写在节点最终文本与声明的 `output` 字段里。节点交回 JSON 时可以带一个可选的 `attachments` 数组，例如一个检查节点产生了失败用例的 trace：

```jsonc
{
  "next": "fix",
  "status": "blocked",
  "attachments": [
    { "path": "traces/playwright.zip", "name": "trace.zip", "description": "失败用例的 Playwright trace" }
  ]
}
```

- 路径相对机器人工作区（`handle.cwd`）；也允许当前运行目录内的绝对路径，便于把一个附件原样带到下一节点。插件把文件复制到该次执行的 `nodes/<seq>-<id>/attachments/`，机器人不需要直接写 runs 目录。
- 复制后生成稳定清单 `{ index, name, bytes, description? }`，写进节点结果、`run.steps[]` 和后续节点的模板上下文；同名文件自动加 `-2` 后缀。
- 后续节点的 prompt 可以按需引用：`{{nodes.<id>.attachments.<index>.text}}` 内联文本、`.path` 拿绝对路径、`.name` / `.bytes` / `.description` 拿元数据。`.text` 只对 UTF-8 文本且不超过内联上限的附件可用；二进制或超大附件请用 `.path` 或 `buka_workflow_execution_attachment` 读取，避免把大内容塞进 prompt。
- **不要把整份答案写成 markdown 再作为唯一附件交回**：运行页展示的是节点最终文本，附件只是补充材料；后续节点需要正文时请用 `{{nodes.<id>.text}}` 或声明的 data 字段。
- 只有正常完成的节点会复制附件。附件数组不合法、源文件缺失 / 越界 / 不是普通文件、超限时，节点以明确错误失败，运行终止，不会静默丢附件。
- 默认限制：单文件 8 MiB、每节点 20 个、每节点总量 64 MiB、prompt 内联单文件 32 KiB；都可通过配置调整。
- 运行页的每次执行会列出附件并可下载；最终输出只有附件、没有正文时也会展示附件，而不是显示“没有输出”。

## 谁能创建工作流

工具注册在 Host 上，但可见性由 [`lib/access.js`](lib/access.js) 按会话收窄：

1. 取调用者会话记录的 agent preset（`ctx.agentPresets.presetForSession`）；
2. 只有配置 `orchestratorPresets` 里点名的 preset **根会话**能看到创建 / 启动 / 状态 / 取消工具；
3. 子会话（机器人节点）、其他 preset 的会话看不到这些创建类工具；机器人节点会话只额外拥有上面四个只读观测工具。

随插件的 bundle 补丁会插入一个 `workflow-orchestrator` preset（`id: workflow-orchestrator`，显示为「工作流编排」）：它带一段编排 persona，以及 bash / fs / fs-search / ask-user 等基础工具，但**不做具体工作**，只负责计划节点图并启动。新建会话时选择这个 preset 即可创建工作流。想换成自己的 preset，把 `orchestratorPresets` 改成对应 id；留空表示不做收窄（所有会话可见，不推荐）。


## 定义格式

```jsonc
{
  "goal": "修复登录页空白屏并验证",
  "maxSteps": 32,
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "next": [{
        "to": "check",
        "name": "开始",
        "prompt": "目标：{{goal}}\n定位登录页空白屏的原因并修复，改完跑一遍相关测试。"
      }]
    },
    {
      "id": "check",
      "type": "robot",
      "robot": "developer",
      "summary": "检查登录页并跑测试",
      "timeoutMs": 600000, // 可选硬超时；不写表示不超时
      "output": {          // 必填：节点结果 JSON 的 JSON Schema
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
        { "to": "fix", "name": "fix", "prompt": "测试打回了，按失败信息继续修复，然后重新跑测试。" },
        { "to": "done", "name": "pass" }
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
    { "id": "done", "type": "end", "status": "completed" }
  ]
}
```

`check` 节点交回的 JSON（`structured_output` 的参数；纯文本 JSON 也接受，并且同样校验）；字段必须匹配该节点的 `output`，`next` 与 `attachments` 由引擎合并进实际 schema：

```jsonc
// 测试打回：next 必须是 check 的出边名之一
{ "next": "fix", "status": "blocked", "reason": "登录页仍然空白，快照显示渲染前抛错" }
// 测试通过（去 done）：同样要交回 JSON，但 done 是终止节点，所以 pass 边不带 prompt
{ "next": "pass", "status": "ok", "summary": "已修复，3 个测试全绿" }
```

`status` / `blocked` / `reason` 等只是机器人自己约定的**业务字段**，不是节点或运行状态——运行状态仍然只有 `completed` / `failed` / `cancelled` / `rejected` / `waiting` / `interrupted`。

节点字段：

| 节点 | 字段 |
| --- | --- |
| `start` | `id`、`type: "start"`、`next`；恰好一个，不执行、不占步数。它只有一条出边，出边上的 `prompt` 就是真正的第一个机器人节点首次进入时的提示词 |
| `robot` | `id`、`type: "robot"`、`robot`、`output`（**必填**，节点结果 JSON 的 JSON Schema）、`summary`（可选，创建者写的一行步骤概要）、`agentOptions`、`timeoutMs`（可选硬超时，毫秒，上限 24 小时；不写就不超时）、`maxVisits`、`next`；**没有 `prompt`，也没有 `report`** |
| `gate` | `id`、`type: "gate"`、`title`、`detail`、`onApprove`、`onReject`（目标是门禁 / 终止时可用节点 id；目标是机器人时必须是带 `prompt` 的边对象；省略表示终止） |
| `end` | `id`、`type: "end"`、`status`（`completed` / `rejected` / `failed`）；终止节点不写最终文本，它在页面上的「最终输出」取这次运行最后一次**有正文**的机器人执行 |

`next` 是**出边数组**：机器人节点的每条出边都是 `{ "to": "...", "name": "...", "prompt": "..." }`——`to` 是目标节点，`name` 是这条边的**路由名**（同一个机器人节点下必须唯一，最长 120 字符），`prompt` 是走到这条边时发给目标节点的提示词。进入机器人节点的边必须有非空 `prompt`，进入门禁 / 终止节点的边不能带 `prompt`。机器人没有 `when` 条件、也没有默认出口：走哪条边完全由机器人交回 JSON 里的 `next` 决定；机器人节点的 `next` 必须是边对象数组（v2 不再支持字符串简写），门禁的 `onApprove` / `onReject` 目标是门禁 / 终止节点时仍可只写节点 id。

`name` 既是路由键（机器人结果里的 `next` 必须等于它），也是运行页上这条边的标签：鼠标悬停到连线上时显示名字，这条线变成实线、略粗一点、其余连线压暗，名字以小标签钉在线中段右侧、两行胶囊之间（不跟着鼠标跑，也不压住节点）；页面上不展示 `prompt` 等边配置。门禁边没有自定义名字时，悬停按「批准 / 拒绝」显示；指向同一目标的多条边可以并存（`name` 不同），图上合并为一条线、名字并列展示。

**所有 prompt 都定义在边上**：每个进入机器人节点的边都必须有 `prompt`，包括 start 节点的第一条边、门禁的出边和循环回边；节点本身不写 prompt。`prompt` 在**这条边被走到时**渲染，并成为目标节点这一次执行的完整提示词。于是同一个 `dev` 节点可以由 start 边给出“首次开发”的指令，由 `test → dev` 回边给出“测试打回、按以下问题修复”的指令，而图上仍然只有一个开发者节点、右侧按 `#1 / #2` 分开每次执行。边 prompt 进入门禁 / 终止节点没有意义，写了会在校验时报错；它按模板渲染：引用的节点 / 字段不存在的写法在计划阶段报错（见下方「模板引用校验」），运行期值确实缺失时该节点失败。

**所有节点都必须能从 start 节点走到**：走不到的节点没有任何入边，永远不会执行，画到运行图上还会被当成第二个起点。校验阶段直接报错（`buka_workflow_plan` 会指出具体是哪个节点）。边也不能指回 start 节点。

**格式校验是严格的**：`report` 与 `when` 在 v2 里都是校验错误（分别提示 report 已在格式 2 移除、when 已移除请用 JSON 的 `next` 选择出边）；机器人节点没有 `prompt`，但必须声明 `output`；start / gate / end 声明 `output` 会报错；v2 不兼容旧格式（没有 start 节点、用顶层 `"start"` 指定入口、prompt 写在机器人节点上）的定义。

**输出契约与路由**：每个机器人节点必须声明 `output`——节点结果 JSON 的 JSON Schema。支持的关键字：`type`（必填：object / array / string / number / integer / boolean / null）、`description`、`properties`、`required`、`additionalProperties`（布尔）、`items`、`enum`、`const`、`oneOf`（独占）；属性名必须是 `[A-Za-z0-9_-]{1,64}`，方便模板寻址；顶层不能声明 `next` / `attachments`。引擎把声明合并成 `structured_output` 的参数：有出边时加 `next` 枚举并设为必填，同时总是加内置的 `attachments` 数组；并把同一份契约追加到节点 prompt 末尾。

节点必须交回**一个 JSON 对象**（scoped 工具 `structured_output`；最后一条回复本身是 JSON、或用 ```json 代码块同样接受，并且同样校验）。缺必填字段、类型 / enum 不符、或 `additionalProperties: false` 下多出字段时，插件在**同一个会话**里追问并给出具体问题，最多 `resultRetries` 次（robots 插件配置，默认 2）；重试用尽仍不合法时节点以 `error` 结束。节点有出边时，JSON 里必须带 `next`，值就是某条出边的 `name`；缺 `next`、值对不上任何出边、或同一个节点下出边重名也走同一追问通道。观察者按 `next` 直接走那条边（连同它的 `prompt`），不需要 `when` 条件，也不需要额外的判断 agent。没有出边的终止机器人节点仍然交回 JSON，但不需要 `next`。除 `next` 外的字段都存进这次执行的 `data`（模板可用 `{{nodes.<id>.data.<path>}}` 引用）；`attachments` 是内置能力，会被规范化成复制后的清单。运行页展示最终文本、附件下载与这次走出的 route，不铺 key/value、也不展示原始 JSON。

边上的机器人 `prompt` 应当写清两件事：任务，以及每个 `next` 值分别代表什么。结果字段由节点的 `output` 声明、由引擎自动追加到 prompt，不要在边 prompt 里重复字段清单；也不要把附件当成答案的输出通道。工作流不会注入其它行为提示词。

续接同一个机器人会话时，服务会重新装好同名的 `structured_output` 工具，续接轮次同样要交回匹配 `output` 的 JSON。升级前已在跑的运行快照没有 `output`：这些节点沿用旧的宽松 schema，prompt 也不追加契约块，运行结束后自然消失。

prompt 只做占位符替换，不求值：`{{goal}}`、`{{step}}`、`{{nodes.<id>.text}}`、`{{nodes.<id>.data.<path>}}`、`{{nodes.<id>.route}}`、`{{nodes.<门禁 id>.decision}}`，以及附件路径 `{{nodes.<id>.attachments.<index>.text|path|name|bytes|description}}`。

**模板引用校验**（`buka_workflow_plan` 阶段）：

- 根路径只能是 `goal` / `step` / `runId` / `nodes`；
- `{{nodes.<id>.<field>}}` 的节点必须存在；`text` / `data` / `route` / `attachments` / `robot` / `sessionId` 只对 robot 节点有效，`decision` 只对 gate 节点有效；
- `{{nodes.<id>.data.<path>}}` 必须落在该节点声明的 `output` 里：对象按 `properties` 下钻；数组必须是数字下标且声明了 `items`；`oneOf` 要求所有分支都存在。即使 `additionalProperties` 允许，引用未声明字段也会在计划阶段报错；
- `data.next` / `data.attachments` 是引擎保留字段，请改用 `{{nodes.<id>.route}}` / `{{nodes.<id>.attachments.<index>...}}`。

运行期值不存在时该节点仍然会失败（这里只校验 schema 存在性，不推断节点在这条边上是否已经执行过）；`.text` 对二进制 / 超大附件不可用。

## 门禁语义

- 执行到 `gate` 时：运行状态置为 `waiting`，调用 `ctx.approval.request({ agent: 创建者, toolName: 'buka_workflow_gate', reason })`，用户看到 DSH 的原生审批框；
- `allowed-once` → `approved` → 走 `onApprove`，省略则按 `completed` 结束；
- `rejected` → 走 `onReject`，省略则按 `rejected` 结束；
- 用户停止这一轮 / 取消 → 运行 `cancelled`；审批服务不可用 → 运行 `failed`；
- 创建者 agent 自身是 delegated child 或审批策略为 `never` 时，审批会被自动拒绝（fail closed），所以工作流应由根会话 agent 创建。

门禁是**定义里的显式检查点**；机器人会话自己请求的工具审批 / 向用户提问属于会话内交互，不会占用 `gate` 节点，运行页用 `pendingInteraction` 提示（见「页面」）。

## 循环

定义里允许成环：某条出边可以指回前面的节点，甚至指回自己，机器人用结果里的 `next`（出边的 `name`）选择回边。校验与调度不把环当错误，而是靠两道上限兜底：

- `maxSteps`：本次运行的节点执行总次数（默认 64，部署侧上限 256）；
- 机器人节点的 `maxVisits`：同一个机器人节点最多被进入几次（`gate` 不计入）。

超出任一项时运行以 `failed` 结束并记录原因（`exceeded its N-step limit` / `exceeded its N-visit limit`），已经产生的步骤与最终文本都会保留。

循环在页面上这样表达：回边 / 自环走轨道右侧的竖线 lane（两端圆角转弯），lane 从里往外分配，循环作为内层套在被它包住的分支里，不会和别的线交叉；两条边各带一个方向箭头，一进一出围成环，不再额外画循环图标。被重复进入的胶囊右侧显示 `×N` 访问次数（详情里也会写「执行次数」）。一次运行没走到的节点（例如机器人没选择的另一条出边）是**灰色虚线胶囊**，仍留在它的拓扑位置（在结束节点之前），不会被排到结束节点后面。

循环里需要给“再次进入”的节点不同指令时，把完整提示词写在回到它的那条边上（该边的 `prompt`，见「边」），并给回边和正向边不同的 `name`（例如 `fix` / `retest`），机器人靠结果里的 `next` 选择。节点本身不写 prompt，每次进入由被走到的那条边给出，所以首次进入和测试打回可以读起来完全是两件事。

## 观察者、恢复与超时

**执行模型**：后台运行的节点 prompt 投进机器人会话后，工具就返回 `runId`，不再 await 会话的 `result`。插件里常驻一个 Host 生命周期的观察者（[`lib/supervisor.js`](lib/supervisor.js)）：

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
- `waiting`、`pendingGate` 存在、或 `current` 是门禁节点的运行：重启后无法重建原生审批，直接标 `interrupted`，原因写明「等待审批时宿主重启，审批无法重建」；
- 缺定义快照、`current` 不是机器人节点、`current` 缺 prompt、或节点在定义里不存在：标 `interrupted` 并写明原因；
- 有 `current` 且是机器人节点：按「会话中断恢复」的同一套逻辑先 `openSession` 检查上一轮是否已结束，否则发「继续」prompt；没有记录会话 id、`openSession` 失败、返回隐藏 subagent 句柄、或旧版服务换回了新会话时，把运行标成 `interrupted` 并写明原因，**不会新开会话**；
- 没有 `current`：从最后一条 step 的出口推导下一个节点（一次都没执行就从 start 节点的出边开始）；没有下一步就直接按 `completed` 收尾。

恢复会写事件 `run/recover`，续接的节点写 `node/resume`。

**超时默认关闭**：

- Config `nodeTimeoutMs` 默认 `0`（`0` = 不超时）。没有硬截止的节点让会话按自己的节奏跑完；
- 需要边界时在定义里给机器人节点写 `timeoutMs`（毫秒，上限 24 小时），它是唯一的硬截止；
- 计时由观察者负责，从 prompt 真正投递后起算（新建 / 续接 dispatch 之前的 compact 不计入；中断恢复沿用这个节点原来的起点）；到点调用句柄的 `cancel()` 取消当前轮，这次执行记成 `stopReason: "timeout"` 与 `timedOut: true`，运行 `failed`，事件 `node/timeout`；
- 超时**不进入恢复重试**：它是定义里的硬边界，不是会话意外中断，所以不会发「继续」prompt、也不会新开会话；
- robots 插件的 `startSession()` 也不再自带默认超时（旧版本是 10 分钟）。

## 页面

侧边栏新增「工作流」条目（观测页面，唯一的写操作是保存「自动归档设置」）：

- 列表：最近运行的状态、目标、`#N` 序号、runId 与开始时间；卡片显示 `#N`，已归档的卡片带「已归档」标签；有 `run.pendingInteraction` 的运行还带「等待用户」标签。默认只列未归档的运行，标题右侧工具栏的「已归档（N）」切到归档列表（标题变成「已归档的工作流」），归档视图里点标题左侧的返回箭头切回；
- 详情标题是 `#N · 目标`（`#N` 是这次运行的序号）；有 `run.pendingInteraction` 时，在图与详情上方先显示一条告警提示：提问显示「机器人正在等待你回答」+ 第一条问题，审批显示「机器人正在等待你批准 <工具名>」+ 原因 / 说明，都带「打开会话」按钮（跳到该机器人的会话去回答或审批）；详情以**纵向节点图**为核心（类似 `git log`）：图没有外框，宽度由节点内容决定；节点从上到下排列，左侧轨道用圆点颜色表示运行状态，节点本身是一个**胶囊**——开始节点显示「开始」、机器人节点显示创建者写的步骤概要（旧定义没有 `summary` 时退回机器人名）、门禁显示标题、终止节点显示 id；机器人节点的胶囊前还会显示该机器人的**预设头像**（来自 robots 服务的 `avatarMap()`；插件没装或机器人已删除时不画头像，图照常显示）；胶囊颜色区分节点类型（开始 / 机器人 / 门禁 / 终止），没有字母角标；这次运行没走到的节点是灰色虚线胶囊，重复进入的节点在胶囊右侧显示 `×N`；
- **线之间不交叉**：跨行分支、回边、自环都走轨道右侧的竖线 lane，lane 按「内层靠里、外层被挤到外面」分配——嵌套的区间就分到不同的层，不会在中途交叉；所有连线都带方向箭头，箭头画在各自竖段的中点，而不是几个箭头挤在圆点旁边；指向同一目标的多条边合并成一条线（名字并列展示），走过的连线高亮；**鼠标悬停到连线上会把这条线变成实线并略粗一点、压暗其余连线，名字以小标签钉在线中段右侧（不跟着鼠标跑）**（创建者写在边 `name` 里的路由名；只显示名字，不展示提示词等配置；门禁边没有名字时按「批准 / 拒绝」显示）；正在执行的胶囊带呼吸边框，等待授权的门禁胶囊为告警色；
- 点击胶囊，右侧展示该节点的详细信息（机器人节点的标题旁同样带这个头像）：**标题就是步骤概要**（创建者写在 `summary` 里的那一行；没有 `summary` 时退回机器人名），节点 id 只作为标题旁的小号代码标签；下面是**执行人**（机器人名）、节点配置与门禁说明；终止节点的详情展示**终止状态**与**最终输出**——最终输出不是定义里写死的文案，而是这次运行**最后一次有正文或附件的机器人执行**，下面标出来源节点与第几次执行，点一下回到那次执行。机器人节点的详情顶部只展示该节点的**一个会话**（每个节点只对应一个会话；运行中的节点在进入后就能看到 sessionId），可直接「打开会话」跳到对话。会话按「运行目标 · 机器人」命名，所以侧边栏里能直接认出是哪次运行的哪段对话；重复进入时页签会标出「已压缩历史」（续接本来就是常态，不再单独标注），压缩失败会在页签里提示但不阻断执行；续接失败时运行直接终止，错误写在节点与运行记录里。节点在跑时详情里的耗时是**实时**走的（页面每次刷新重算，不必等结束）。其余节点按**执行拆分的 Tab**——每次进入节点一个 `#N` 页签，页签里依次是这一次的任务信息（那一次落盘的渲染后提示词）、输出结果（最终文本与附件）、状态 / 时间 / 时长，以及这次走出的 route 名（小标签）；执行 Tab 不再重复节点级已经展示过的会话 id 与「打开会话」，只对不属于这个节点会话集合的旧执行保留入口。再次进入（visit > 1）的那次执行没有落盘 prompt 时显示「这次执行没有记录输入」，不会把定义里的提示词模板当成那一次的输入。恢复过 / 超时的执行在页签顶部带「已恢复」「超时」标签；页签底部是**上一步 / 下一步**两个方向：左侧回到运行里的上一次执行（本次运行的第一次执行回到开始节点，开始节点本身不执行），右侧到这次执行把运行带到的下一次执行（最后一次执行则指向运行结束的终止节点），点一下就会切到那个节点并打开那一次执行。进入运行详情时自动聚焦：有正在执行 / 等待授权的节点就选中它；运行已完成则选中它最后走到的终止节点（一进来就展示最终输出）；其他状态打开最近一次执行。没执行过的机器人节点只有概要（prompt 在边上，第一次执行时才看得到）。出口只在图上表达；**输出结果展示最终文本与附件下载**：JSON 只用于路由与模板，不按 key/value 铺在页面上、也不展示原始 JSON，只把这次走出的 route 名标出来。start 节点在标题旁标「起点」，它的详情只说明自己不执行、第一条边的 prompt 在目标节点的第一次执行里，没有执行 Tab；格式 v2 在校验阶段就拒绝不可达节点，正常记录里不会出现，页面仍保留「不可达」的兜底说明；
- 默认选中正在执行或最近执行过的节点；
- 工具栏的「归档设置」按钮打开「自动归档设置」对话框：自动归档开关（默认启用）、归档时间（小时，默认 24）、删除时间（小时，默认 168）；时间只能填整小时，归档时间范围 1–720、删除时间范围 2–8760，删除时间必须晚于归档时间，否则对话框会提示并拒绝保存。保存后立即生效，并马上执行一次清理；
- 页面底部的 footer 放图例（节点类型 / 状态色 / 连线含义）与交互提示；它固定在页面底部、不参与内容滚动，内容再长也不会把它顶下去；
- 页面本身不创建、不启动工作流——定义由编排 agent 在会话里现场生成，页面只负责观测（唯一的写操作是保存自动归档设置）。打开页面期间会定时刷新：有运行在跑（`running` / `waiting`）时每 1.5 秒，否则每 5 秒，所以后台运行的节点进度、节点会话与运行中节点的实时耗时也能看到。

图模型由 Host 侧纯函数 [`lib/graph.js`](lib/graph.js) 生成：把定义快照（节点、出边、门禁分支）与状态快照（`steps`、`current`、`pendingGate`、`result`）合成节点状态、连线的「是否走过 / 走了几次 / 是否循环边 / 边名字 / route」，再算好行序（拓扑排序：不成环的连线一律从上往下，只有环内的返回边向上）、lane 分配、SVG 路径与方向箭头；浏览器一半只负责渲染。节点上还有一个 `unreachable` 标记（从 `start` 出发没有路径到达），只作为损坏 / 手工改动记录的兜底说明。运行详情接口在构建图模型时还会把 robots 服务的 `avatarMap()` 合进来，给 robot 节点填 `avatar`（只是展示信息，取不到时是 null）。这样布局与状态推导都能直接单测（含循环的访问次数、lane 嵌套与「不交叉」的几何断言、自环与合并的重复连线、合并边的名字）。

节点结果（`nodes/<seq>-<node id>/result.json`）除了输出文本、结构化数据与附件清单，还会保存那一次的**渲染后提示词**（`prompt`）与走出的 route（`route` / `routeTo`），所以页面上的每次执行都能回看自己的输入和去向；旧记录的 `nodes/<seq>-<node id>.json` 仍然可读；节点刚进入、还没结束时也会先写一份 `status: "running"` 的结果，页面因此在 dispatch 后就能看到这次执行的任务信息。没有落盘 prompt 时，再次进入（visit > 1）显示「这次执行没有记录输入」，不会把定义里的提示词当成那一次的输入。

页面的运行数据通过 Host 的路由取数：`GET /buka-workflows/runs`（可带 `?archived=1` 只列已归档，响应带 `archivedCount`）与 `GET /buka-workflows/run?runId=...`（返回 `run`、`definition`、`nodeResults` 与算好坐标的 `graph`）；附件下载走 `GET /buka-workflows/attachment?runId=&seq=&nodeId=&name=`（只接受节点清单里的文件）；自动归档设置走 `GET/POST /buka-workflows/settings`；都沿用 web 组合的信任栅栏。

## 落盘位置

默认 `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-workflows/runs`，可用 Config `runsDir` 覆盖：

```yaml
- id: tool-buka-workflows
  name: '@buka/dsh-plugin-workflows'
  config:
    runsDir: ~/workflow-runs
    maxRuns: 200        # 已归档运行最多保留多少条
    nodeTimeoutMs: 0    # 节点默认硬超时；0 = 不超时（默认）
    maxSteps: 64
    maxAttachmentBytes: 8388608       # 单个附件 8 MiB
    maxAttachmentsPerNode: 20
    maxNodeAttachmentsBytes: 67108864 # 每个节点附件总量 64 MiB
    maxInlineAttachmentBytes: 32768   # prompt 内联单个文本附件 32 KiB
    orchestratorPresets: [workflow-orchestrator]
    robotPreset: standard
```

`maxRuns`（默认 200）只限制**已归档**记录的数量；归档 / 删除的时间由页面上的「自动归档设置」控制，配置里没有按天数保留的项。`nodeTimeoutMs` 默认 `0`（不超时），需要边界时优先在定义里给节点写 `timeoutMs`。附件上限（`maxAttachmentBytes` / `maxAttachmentsPerNode` / `maxNodeAttachmentsBytes` / `maxInlineAttachmentBytes`）默认 8 MiB / 20 个 / 64 MiB / 32 KiB，可按部署需要调整。

每次运行一个目录，运行目录同级还有一份序号计数器：

```text
runs/
  sequence.json    运行序号计数器；和各个运行目录同级，新建运行时递增
  <runId>/
    definition.json  本次一次性定义的快照（`version` 为 `WORKFLOW_FORMAT_VERSION`，当前 2）
    run.json         权威状态快照（原子写，含 `version`、这次运行的序号 `seq`、当前节点 `current`、`pendingInteraction`、机器人会话 `sessions` 与执行记录 `steps`）
    events.jsonl     追加事件：node/start、node/session、node/end、node/recover、node/resume、node/timeout、interaction/asked、interaction/settled、gate/decided、run/recover、run/end …
    nodes/<seq>-<nodeId>/
      result.json       节点结果全文（那次渲染后的 prompt、输出文本、structured、附件清单、route / routeTo 等）
      attachments/      该次执行的附件文件
```

**格式版本与清理**：`definition.json` 与 `run.json` 的 `version` 当前是 `2`。`store.init()` 在回填 / 清理前会遍历 `runs/` 下的运行目录：`run.json` 或 `definition.json` 的版本不是 2、缺失、或 JSON 损坏时，整目录删除（连同节点结果、附件与事件）；如果所有运行都被删掉，`sequence.json` 也一起删掉，下一次运行重新从 `#1` 开始；`settings.json` 在 `runs/` 的父目录，不受影响。这里**不提供迁移或兼容**，旧格式的定义与运行记录都不会被读取。

`run.current` 是正在执行的那一个节点（`nodeId` / `visit` / `seq` / `type` / `prompt` / `sessionId` / `startSeq` / `startedAt`；恢复时还有 `recovering`，`recoveryAttempts` 固定为 `1`）；`run.pendingInteraction` 是机器人正在等待的用户交互（见「页面」），没有时为 `null`。`run.steps` 每次进入节点一条（含 `sessionId`、`stopReason`、`resumed`、`compacted`、`route` / `routeTo`、附件清单 `attachments`；恢复 / 超时还带 `recovered` / `recoveryAttempts` / `timedOut`）。`run.sessions` 按机器人汇总会话，每项是 `{ robot, sessionId, visits, entries }`，`entries` 每次进入一条 `{ nodeId, visit, seq, sessionId, at, resumed, compacted }`：一个机器人在一次运行里只有一个会话，再次进入先 compact；续接失败时运行直接终止，不会换会话。

「自动归档设置」不存在运行目录里，而是持久化在 `runsDir` 的父目录（默认 `~/.cache/dsh-plugin-workflows/settings.json`），删掉某个运行目录不会影响设置：

```jsonc
{
  "version": 1,
  "archive": {
    "enabled": true,          // 自动归档开关，默认启用
    "archiveAfterHours": 24,  // 超过多少小时归档，默认 24（1 天），范围 1–720
    "deleteAfterHours": 168   // 超过多少小时删除，默认 168（7 天），范围 2–8760
  }
}
```

两个时间都按整小时填写，删除时间必须晚于归档时间。

启动时会：先按上面的格式版本清理 `runs/` 里的旧版本 / 损坏记录，再由观察者尝试恢复未完成的运行（见上文「观察者、恢复与超时」），确实无法恢复的才标成 `interrupted`、把原因写进 `error`；给还没有 `seq` 的当前版本记录按创建时间回填序号，最后按「自动归档设置」清理到期的运行。

## 运行序号与自动归档

每次运行都有一个人能看懂的序号 `#N`：Host 在创建运行时分配，按创建顺序持久递增（从 1 开始），写进 `run.json`，并由 `runs/sequence.json` 计数器记录下一个可用序号。同一格式版本内删除旧运行**不会**回退或复用编号；升级到格式 2 时会删掉旧版本运行、编号重新从 `#1` 开始。当前版本里还没有 `seq` 的记录，启动时会按创建时间排序回填。列表卡片、详情标题（`#N · 目标`）和 `buka_workflow_status` 的列表都显示它，`buka_workflow_start` 在后台模式下的返回值也额外带 `seq`。

运行记录的归档 / 删除按下述规则进行（设置的位置与字段见上一节「落盘位置」）：

- 只有**已结束**（非 `running` / `waiting`）的运行参与；仍在运行的运行永远不会被归档或删除；
- 按**结束时间**计龄，没有结束时间时退回最后更新时间、再退回创建时间；
- 超过归档时间（默认 24 小时）→ 给 `run.json` 写入 `archivedAt`，记录标记为已归档并从默认运行列表隐藏；标题右侧工具栏的「已归档（N）」能看到它们，点标题左侧的返回箭头切回；
- 超过删除时间（默认 168 小时）→ 整个运行目录被删除，**不可恢复**。

清理（sweep）在启动时、每小时、以及保存设置后立即各执行一次。关闭自动归档开关后不再按时间归档或删除，已归档的记录仍在「已归档」里。Config `maxRuns` 只限制**已归档**记录的数量，已归档的多于 `maxRuns` 时从最旧的已归档运行开始删除；保留策略不再有按天数的配置项。

## 依赖与限制

- robot 节点需要先安装并启用 [`@buka/dsh-plugin-robots`](../robots)；它提供 `ctx.bukaRobots`（`list()`、`avatarMap()`、`dispatchSession()`、`openSession()`、`startSession()`）。编排器通过 robots 插件的只读工具 `buka_robots` 取机器人清单，其中每个机器人带一句职责（`description` 字段）；按职责选择节点用哪个机器人，不要凭空造机器人名。清单最后可能带「通用型机器人」（启用时才有，字段与普通机器人相同）：它跑在当前工作区、没有自己的 AGENTS.md/skills，职责里写明没有专用机器人时使用，停用后不会出现、也不能被调用。默认创建**普通顶层会话**并挂到机器人自己的工作区：`cwd` 是机器人目录，机器人的 AGENTS.md 与项目 skills 生效，侧边栏能看到、能直接打开；同一个机器人整个运行共用一个会话（按「运行目标 · 机器人」命名），后续进入由服务 resume 续接并先 compact，不再新开会话。普通会话创建失败或续接失败时节点直接报错、运行终止；不会退回 subagent，也不会新开替代会话。观察者用非阻塞的 `dispatchSession()` 投 prompt、用 `openSession()` 检查 / 续接中断的会话；它把节点的 `output` schema、出边 `name`（`next`）与内置附件能力合成 `structured_output` 的 `outputSchema`（并作为合法 route 交给结果追问）。机器人交回的结果不合法时，服务按 `resultRetries` 追问；工作流还会按声明的 `output` 做一次结果校验。
- 含 `gate` 的定义是**同步**的工具调用：整条流程（含等待门禁授权）占着编排器会话的这一轮 turn，因为原生审批要求会话有活跃 turn。长流程不要放进这一轮；用户点停止会取消运行。不含 `gate` 的定义走后台：第一个节点 dispatch 后工具返回 `runId`，之后由观察者按会话事件推进，用 `buka_workflow_status` 或侧边栏页面跟进，`buka_workflow_cancel` 可以停。
- 编排 preset 的根会话才能创建 / 启动 / 取消工作流；机器人节点会话显式使用 `robotPreset`（默认 `standard`），因此不会继承编排 persona 或创建类工具，但会获得上面四个只读观测工具（可见性按运行记录里的 sessionId 判定）。
- 机器人是**普通会话**：以运行时根会话创建 / 续接（不挂回父会话），走正常审批策略；机器人可以在会话里请求工具审批或向你提问，这些交互出现在机器人会话，运行页用 `pendingInteraction` 提示并可直接打开会话。工作流不注入行为提示词，只给任务、输出契约与每条出边的含义，由机器人自己决定是否提问 / 申请审批。
- 运行数据不只是回看：它是运行状态的权威来源，会话中断续跑与宿主重启恢复都从落盘的 `run.json` / 节点结果重建上下文。每个机器人的会话日志由 DSH 持久化，仍然可以在侧边栏或运行页的「打开会话」里打开：节点结束释放 live agent 时，robots 服务会把这条仍然持久化的会话补通告回客户端（`api-session/added`），所以它不会在节点 / 运行结束后从侧边栏消失；运行页打开会话时如果客户端列表里还缺这条会话，会先补一次 `sessions.refresh()` 再打开。续接前的 compact 依赖宿主 `compaction` 服务（`@deepseek-ai/dsh-compaction-basic`，桌面 profile 默认禁用）；服务缺失时节点照常继续，但页签会提示“压缩服务不可用”，启用后才会真正压缩历史。
- 默认**没有节点超时**：模型速度、任务大小与网络差异都可能让一轮跑很久，硬截止容易误杀；确实需要边界时用定义里的 `timeoutMs`。原生审批（门禁）仍然只能在创建者会话的活跃 turn 里弹，因此含门禁的运行无法在重启后恢复。
- 不引入第三方状态机/工作流库：三种节点、按 `next` 名字选路和由会话事件驱动的调度足够小，接入 DSH 会话才是主要工作。

## 单测

纯逻辑模块（定义校验、模板、输出 schema、路由、存储与格式清理、自动归档、图模型、设置、工具可见性、机器人只读工具）不 import DSH 包，由仓库根 `test/workflows-plugin.test.mjs`、`test/workflows-format-v2.test.mjs`、`test/workflows-format-version.test.mjs`、`test/workflows-output-schema.test.mjs`、`test/workflows-graph.test.mjs`、`test/workflows-settings.test.mjs`、`test/workflows-access.test.mjs` 、`test/workflows-session-tools.test.mjs` 与 `test/workflows-attachments.test.mjs` 直接用 `node --test` 覆盖；观察者由 `test/workflows-supervisor.test.mjs` 用最小会话桩覆盖（默认不超时 / 显式超时、会话中断续接、启动恢复、会话索引重建、门禁重启标 interrupted 等）；浏览器一半由 `test/workflows-client.test.mjs` 用最小 React 桩做渲染冒烟。
