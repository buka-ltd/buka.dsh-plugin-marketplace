# Buka 工作流

持久工作流 + 作业看板。工作流是一张**岗位图**；作业 = 一个工作流版本 + 一个输入，每个作业一块看板；**任务**是最小工作单元，由执行中的岗位随时产出，只能沿图上画出的边派发。

## 模型

- **工作流**：持久定义，可多版本；由编排 preset 用 `buka_workflow_save` 保存，页面审阅 / 激活 / 停用。
- **岗位**：图里的节点（内建开始 / 结束之外）。一个岗位一种执行者：人或机器人（agent / program）。
- **任务类型**：岗位声明的任务契约：payload schema、output schema、必须依赖的上游类型、人任务的助理、可选 plan 模式。
- **边**：允许的派发关系；可带任务类型白名单；回边必须显式标注。边是权限，不是管道。
- **开始 / 结束**：内建节点，执行者是启动者。启动任务把原始输入转成第一个结构化输入；结束任务携带最终交付物，投递给启动者即完成。
- **作业**：一个工作流 + 一个输入，钉住工作流版本；编号在所属工作流内递增。不存在跨工作流的作业。
- **任务**：看板上的一张卡；有 pending / ready / running / completed / failed / blocked / cancelled 七种状态。依赖纯显式，任务依赖图无环；每次打回产生新任务记录。
- **看板**：行 = 岗位（含开始 / 结束），列 = 排队 / 待认领 / 进行中 / 已完成 / 异常。

## 怎么用

1. 选「工作流编排」preset 新建会话，让编排 agent 起草岗位图，保存为工作流版本。
2. 在侧边栏「工作流」里审阅流程图与契约，激活版本。
3. 新建作业：
   - 页面：填原始输入 + 结构化输入，启动者 = 人；
   - 会话：执行 `/job` 命令，启动者 = 当前会话，启动任务回到该会话执行。
4. 作业看板上，机器人岗位自动认领就绪任务；人任务由点名的助理承办，或由人自己认领。跨分支看板可见整张作业；任务工具按数据流授权附件。
5. 岗位沿边派发后续任务；结束任务把最终交付物交回启动者，作业结算。

## 工具

| 工具 / 命令                                | 作用                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `/job`                                     | 普通会话入口：列已激活工作流，或按输入启动一个作业（启动者 = 当前会话） |
| `buka_workflow_save`                       | 编排 preset 根会话：校验并保存工作流新版本（草稿）                      |
| `buka_workflow_list` / `buka_workflow_get` | 读工作流目录 / 全文                                                     |
| `buka_job_start`                           | `/job` 命令与页面的后端：创建作业                                       |
| `buka_job_status` / `buka_job_cancel`      | 读作业、取消作业                                                        |
| `buka_task_create`                         | 执行中的任务：随时创建下游任务（可多次）                                |
| `buka_task_complete`                       | 执行中的任务 / 助理：提交结构化结果、文本与附件                         |
| `buka_job_board` / `buka_task_get`         | 执行中的任务 / 助理：只读作业看板、任务与依赖结果                       |
| `buka_job_attachments`                     | 执行中的任务 / 助理：按可见范围检索 / 读取附件                          |

编辑工作流的工具只对 `orchestratorPresets` 点名的 preset 根会话、以及 `orchestratorWorkspaces` 点名目录里的会话可见；执行工具只对本次任务会话、助理会话与启动者会话可见。人任务没有模型回答工具。

## 人任务与助理

- 人任务 = 人岗位产出的普通任务，没有「等待人工」状态，所有任务都在看板上。
- 人任务类型点名一个 `assistant`（agent 机器人的名字）或 `null`：
  - 点名助理：任务就绪后引擎启动该助理的会话，助理用自己的 skills 与人沟通，最后提交结果；只有被点名的助理能认领。
  - `null`：任务停在待认领，人在看板认领并按 output schema 填表提交。
- 助理失败后任务回到待认领，不自动换助理；人始终可以兜底完成。

## 附件

每个作业一个附件库。附件必须记录来源任务 / 岗位、创建者、大小、mime、sha256 与描述；可见性按数据流：产出任务、传递依赖它的任务、启动者与作业页面。不相关分支不能列出、检索或读取。文件存插件作业目录，元数据进 `ctx.storageDomain`。

## 页面

侧边栏「工作流」：工作流列表 → 工作流详情（流程图、岗位 / 任务类型 / 边 / 开始结束契约 / 预算、作业列表）→ 作业详情（默认看板，另有流程图、任务、附件库、时间线）。任务抽屉可看 payload、依赖、执行记录、结果与附件，按 `allowedActions` 操作；人任务按 output schema 填表；结束交付失败时提供「重试交付」。

## 依赖与存储

- 需要 `@buka/dsh-plugin-robots` 提供机器人登记与任务会话；需要 DSH 组合里的 `ctx.storageDomain`（base 组合自带）。
- 工作流 / 作业 / 任务 / 执行记录 / 附件元数据在 `ctx.storageDomain` 的 `buka_workflow` 域；大文本与附件文件在插件数据目录 `~/.cache/dsh-plugin-workflows/jobs/<jobId>/`。
- 首次启动 v4 会删除旧的 `runs/` 与 `settings.json`（硬切换）；之后作业 / 任务不再按格式版本清空。

## 配置

配置项以 `src/options.ts` 为准：工作流数据目录、编排 preset 名单、按工作区放行的目录、机器人 preset、任务并发与预算等。默认 `orchestratorPresets` 是随包发布的 `workflow-orchestrator`；`orchestratorWorkspaces` 默认为空，填了以后这些目录（含子目录）里的会话不用切 preset 也能保存 / 读取定义，适合插件自己的开发者工作区。

## 结构

- `src/domain/**`：类型、状态机、id。
- `src/store/**`：storageDomain 表、per-job 串行队列、作业目录。
- `src/definition/**`：工作流 v4 校验与 payload 模板。
- `src/engine/**`：调度、执行器、结算、恢复。
- `src/tools/**`、`src/commands/**`：模型工具与 `/job` 命令。
- `src/routes/**`：页面只读 / 操作路由。
- `src/client/**`：侧边栏页面。
- `lib/index.js`、`lib/client.js`：构建产物，提交进 git，不手改。

## 测试

`test/workflows-core.test.mjs`（domain / store / definition）、`test/workflows-server.test.mjs`（引擎 / 恢复 / 附件 / 工具）、`test/workflows-client.test.mjs`（渲染冒烟）。跑 `node --test`。
