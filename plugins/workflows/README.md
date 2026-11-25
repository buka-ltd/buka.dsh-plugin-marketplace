# @buka/dsh-plugin-workflows

有明确职责的**执行者** + 持久工作流 + 作业看板，一个插件装下整条流水线。本包由 `@buka/dsh-plugin-workers` 与 `@buka/dsh-plugin-workflows` 合并而来（4.0.0）。

- **执行者**是个体：**智能体**有自己的目录、AGENTS.md、项目 skills 与一句职责，以 DSH 会话执行任务；**机器人**是固定程序（v1 内建 `clock`）。助理不是执行者身上的标记，而是工作流上对智能体标识符的点名。
- **工作流**是一张持久的**岗位图**：岗位、任务类型、通道、内建开始 / 结束节点与预算。
- **作业** = 一个工作流版本 + 一个输入，每个作业一块**看板**；作业编号在所属工作流内递增。
- **作业模式**是普通会话的一种开头方式：新会话第一条消息 `/job [说明]` 进入，只用于启动一个作业。agent 用 `workflow_job_options` 看到全部可启动工作流，按你的描述挑选；你没说用哪个、或几个都像时先问你。选定后按开始节点 schema 补齐输入再调 `workflow_job_start`，启动成功后模式结束。
- **任务**是最小工作单元，只能沿图上的通道派发；依赖显式声明，就绪即认领。每个任务类型声明**并发度**（`concurrency`，默认 1）：同一作业内这类任务最多同时进行几条，就绪任务按创建顺序拿名额；岗位只是书写载体，不同任务类型因此可以并行，人任务不占引擎额度。
- **工作树**是智能体任务类型上的三态设置：`none`（不注入提示词，默认）、`guard`（只做保护检查，发现未提交修改先询问用户）、`create`（提示执行者自己按仓库调用 `create_worktree`，可同时改多个仓库）。`create` 依赖工作树能力，缺失时自动降级为 `guard`。
- **唯一的 Workflow 预设**既能设计 / 保存工作流，也能创建 / 修改执行者。
- **执行者预设（界面写作「模式」）**按层配置：任务类型的 `agentPreset` > 执行者登记的默认 > 插件选项 `workerPreset`；`plan: true` 让会话以计划模式起步，与执行者预设互不影响。
- **任务类型的定义是模板**（定义 v9）：`{{content}}` / `{{content.<path>}}` 引用这一张任务的任务内容，渲染后以用户身份投递；任务内容里的 `/skill` 手势会被转义，定义原文里的仍然生效。工作流模板支持可选路径 `{{content.remark?}}` / `{{input.remark?}}`：字段缺失渲染空串，不带 `?` 仍然严格报错。
- **结构控制风险**（没有通道就不能派发），**并发度控制吞吐**（按任务类型计数）。

## 使用

1. 新建 **Workflow** 预设的会话：让编排 agent 起草岗位图并用 `workflow_save` 保存；同一个会话也可以创建 / 修改执行者（`workflow_worker_build`，先展示草案、等你批准）。
2. 在侧边栏唯一的入口（首页顶部两个页签）里管理：**Workflow** 页签审阅定义图与契约，暂时不用时在页头停用，需要时重新启用；**Worker** 页签管理设置（职责、模式与模型）、文件与项目 skills。
3. 新建作业：
   - 页面：填作业输入，并选择最终报告交回自己还是交给助理，发起人 = 人；
   - 会话：新会话的**第一条消息**执行 `/job [说明]` 进入作业模式。agent 先调 `workflow_job_options` 列出可启动的工作流（id、名称、描述与开始节点输入 schema），按你的说明挑选；你没说用哪个、或几个都像时会问你。选定后补齐输入并调用 `workflow_job_start`，发起人 = 当前会话。`/job off` 退出；一个会话最多启动一个作业。
4. 看板上执行者岗位自动认领就绪任务；人任务由点名的助理承办，或由人直接点动作提交（提交时自动认领）。任务沿通道创建后续任务，结束任务把最终报告交回发起人，发起人确认后作业结算。作业失败后可以从失败位置重启，或按原输入从头新建一个作业。
5. 执行者被删除是硬删，唯一阻塞是引用它的运行中作业；引用它的工作流 / 作业派生「不可用」，重新绑定一个已存在的执行者后自动恢复。

## 工具与命令

| 名称                                       | 面向                 | 作用                                                                                      |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------- |
| `workflow_workers`                             | Workflow 预设 / 页面 | 列出执行者（id、名称、driver、挂载、职责、skills、AGENTS.md）                             |
| `workflow_worker_build`                        | Workflow 预设根会话  | 按批准过的 id / 名称 / 头像 / 描述 / AGENTS.md 创建或更新执行者                           |
| `/job`                                     | 普通会话             | 以会话第一条消息进入作业模式：`/job [说明]`；说明可省略，`/job off` 退出               |
| `workflow_save`                       | Workflow 预设根会话  | 校验并保存工作流新版本（保存后即可用）                                                    |
| `workflow_list` / `workflow_get` | Workflow 预设 / 页面 | 读工作流目录 / 全文                                                                       |
| `workflow_job_options`                       | 作业模式内           | 列出可启动的工作流：id、名称、描述、开始节点输入 schema 与不可用原因；按用户描述选或问用户 |
| `workflow_job_start`                           | 作业模式内           | 按选定的工作流创建作业（作业输入 + 交回方式）；只在作业模式会话里可见                     |
| `workflow_job_status` / `workflow_job_cancel`      | 发起人 / 页面        | 读作业 / 取消作业                                                                         |
| `workflow_task_create`                         | 执行中的任务         | 按目标创建下游任务，可多次；通道由引擎解析，工具说明列出本任务的 target 与 content schema |
| `workflow_task_complete`                       | 执行中的任务 / 助理  | 提交结果文本与附件；人任务可带动作与表单，工具说明列出动作 id 与 input schema             |
| `workflow_job_board` / `workflow_task_get`         | 执行中的任务 / 助理  | 只读作业看板、任务与依赖结果                                                              |
| `workflow_job_attachments`                     | 执行中的任务 / 助理  | 按可见范围检索 / 读取附件                                                                 |

`workflow_worker_build` 只对 `builderPresets` 点名的 preset 根会话可见；编辑工作流的工具只对 `orchestratorPresets` 点名的 preset 根会话、以及 `orchestratorWorkspaces` 点名目录里的会话可见——两个名单默认都指向随包发布的 `workflow-orchestrator`（显示名 `Workflow`）。执行工具只对任务会话、助理会话与发起人会话可见。`workflow_job_options` / `workflow_job_start` 只在作业模式（`/job` 进入且尚未启动过作业）的会话里可见；模式状态折叠自会话日志，提示词段落与工具可见性读同一份。

## 页面

侧边栏只有一个入口，首页顶部两个页签，第一个 **Workflow**、第二个 **Worker**（页签由 hash 驱动，`#/workers` 落在 Worker 页签，其余 hash 都是工作流路由）。页签只留在两个列表页；进入工作流 / 作业 / 执行者详情后，页头换成独立设计：返回 + 标题 + 操作一行，页内页签单独一行。

- **Workflow**：工作流列表 → 工作流（**作业** / **结构图** / **任务类型**）→ 作业（**概览** / **实时流程** / **看板** / **资产**）。任务抽屉先给结果与可执行的操作；人任务先选动作、再填表单；结束交付失败时提供「重试交付」。失败作业可从失败位置重启或从头开始。
- **Worker**：列表（driver 标签、职责、挂载状态）→ 详情（设置 / 文件 / 技能）；「设置」里放名称、职责、模式与模型（没有保存按钮，改动即自动保存），「技能」在进入详情时自动探测更新（页签带更新圆点）、有更新的项在行内单独更新；页头右上角的「安装 skills」只列 Skills 插件「技能仓库」里收藏的来源（读 `ctx.skillCatalog`），不再接受手填的第三方来源，未收藏的仓库要先在 Skills 页面收藏；页头的「打开」可用 DSH 内置 open-in-app 探测到的应用打开执行者目录，清单不可用时退回系统文件管理器，「文件」以只读目录树展示执行者目录。机器人只读；删除弹窗先展示影响面（阻塞的运行中作业、受影响的工作流、目录），「打开作业」直接写 `#/job/...`，首页自动切回 Workflow 页签并打开对应作业。

## 依赖与存储

- 执行者登记与任务会话由本插件自带（`ctx.workflowWorkers` 服务）；工作流元数据需要 DSH 组合里的 `ctx.storageDomain`（base 组合自带）。任务类型的 `worktree: "create"` 需要 DSH 组合同时提供工作树服务（`ctx.worktrees`）与 `create_worktree` 工具；未启用时定义照常保存，执行时自动降级为 `"guard"`。
- 执行者页面的「安装 skills」读 Skills 插件的 `ctx.skillCatalog`：收藏列表来自「技能仓库」，候选清单来自 `listSkills()`；Skills 插件没装时弹窗给出安装提示，不提供手填来源。
- 执行者数据在 `~/.cache/dsh-plugin-workers/`（`workers.json` + `workers/<id>/`）；每个执行者目录默认初始化为独立 git 仓库（`git init`，不自动提交），作为分享的基础；工作流 / 作业 / 任务 / 执行记录 / 附件元数据在 `buka_workflow` 域；大文本与附件在 `~/.cache/dsh-plugin-workflows/jobs/<jobId>/`。
- 定义格式当前版本是 v9（任务类型的定义是模板）；打开存储时把 v7 工作流定义迁移到 v8（幂等），v8 不会自动升级。v7 / v8 工作流标记「待升级」，不能再启动作业；作业快照不迁移，按旧语义跑完。

## 升级与迁移（从旧的两个插件）

1. **先卸载 `@buka/dsh-plugin-workers` 与旧的 `@buka/dsh-plugin-workflows`，再安装本包**。新旧并存会重复注册同名服务 / 工具 / 补丁行，导致组合冲突。
2. **数据零迁移**：执行者目录与登记表、工作流定义、作业看板都在原来的位置，合并后原样读取。
3. **预设合并**：旧的「执行者」（`worker-builder`）与「工作流编排」（`workflow-orchestrator`）合并为唯一的 **Workflow** 预设（id 沿用 `workflow-orchestrator`）；旧预设的历史会话仍可继续。
4. 插件配置重置为默认；默认目录与旧版一致，自定义过 `workersDir` / `dataDir` / 预设名单的重新填一次即可。

## 配置

配置项以 `src/options.ts`（工作流）与 `src/workers/index.ts`（执行者）为准：`workersDir` / `builderPresets` / `seedPresets` / `dataDir` / `orchestratorPresets` / `orchestratorWorkspaces` / `workerPreset` 等。默认 `builderPresets` 与 `orchestratorPresets` 都是 `workflow-orchestrator`。

## 结构

- `src/workers/**`：执行者一半——登记表、目录、AGENTS.md、项目 skills、模型工具与 `/workflow/workers/*` 路由。
- `src/domain/**`、`src/store/**`、`src/definition/**`、`src/engine/**`：工作流类型、状态机、存储域、定义校验与调度引擎。
- `src/tools/**`、`src/commands/**`：工作流模型工具与 `/job` 命令；`src/job-mode.ts`：作业模式的日志折叠与提示词段落。
- `src/routes/**`：工作流页面路由；`src/service.ts`：只读服务 `ctx.workflowQuery`（`workerUsage`）。
- `src/client/**`：工作流页面；`src/client/workers/**`：执行者页面；`src/client/home.ts` 装配首页的两个页签。
- `src/index.ts`、`src/client/index.ts`：合并后的两个装配入口（只装配）。
- `lib/index.js`、`lib/client.js`：构建产物，提交进 git，不手改。

## 测试

`test/workers-*.test.mjs`、`test/workflows-core.test.mjs`、`test/workflows-server.test.mjs`、`test/workflows-job-mode.test.mjs`、`test/workflows-client.test.mjs`、`test/preset-prompts.test.mjs`。跑 `node --test`。
