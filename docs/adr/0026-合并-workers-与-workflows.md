# ADR 0026：Workers 与 Workflows 合并为单一插件与单一预设

- 状态：已采纳（2026-11-18）
- 影响面：市场索引（workers 包下架）、`plugins/workflows`（合并源码、补丁层、文案、配置）、两个 preset（合并为 `Workflow`）、已安装用户的迁移路径

## 背景

Workers（打工人登记、目录、AGENTS.md、项目 skills）与 Workflows（持久工作流、作业看板）是两个独立插件，但已经深度互连：workflows 经 `ctx.bukaWorkers` 读登记表与开任务会话，workers 删除打工人前经 `ctx.bukaWorkflows.workerUsage(id)` 算引用面，页面互相跳转，两个插件还各自随包发布一个 preset（`worker-builder` 与 `workflow-orchestrator`）。用户要装两个包、切两个预设；「先装哪个、谁提供哪个服务」的边界只存在于打包层。

## 决定

1. **合并成一个包**：保留 `@buka/dsh-plugin-workflows` 包名（版本 4.0.0），`plugins/workers/` 的源码以 `git mv` 移入 `plugins/workflows/src/workers/`（宿主一半）与 `src/client/workers/`（界面一半）；`@buka/dsh-plugin-workers` 从市场下架，目录删除。
2. **保持兼容面**：侧边栏面板 id `buka-workers` / `buka-workflows`、路由前缀 `/buka-workers/*` 与 `/buka-workflows/*`、全部工具名、`/job` 命令、服务名 `bukaWorkers` / `bukaWorkflows` 都不变；补丁行 id 保留 `tool-buka-workflows`。
3. **数据零迁移**：打工人数据仍在 `~/.cache/dsh-plugin-workers/`，工作流数据仍在 storageDomain 的 `buka_workflow` 域与 `~/.cache/dsh-plugin-workflows/`；配置默认值不变。与 robots→workers 那次改名不同，这次不需要搬数据。
4. **两个预设合并为一个**：只发布 `preset-workflow-orchestrator` 一个预设行，`config.id` 沿用 `workflow-orchestrator`（兼容既有会话与配置默认值），显示名改为 `Workflow`，persona 合并两份职责——设计并保存工作流、创建 / 修改打工人；都不启动作业、不实现任务。`builderPresets` 与 `orchestratorPresets` 两个配置默认都指向它。
5. **技能清单不再对编排会话隐藏**：原「编排 preset 看不到打工人 skills」的硬规则删除（`resolveWorkerSkillsVisibility` 与相关分支），`buka_workers` 对所有可见调用方返回 skills。原因是单一预设兼任构建与编排，隐藏会让「给打工人推荐技能」失去依据；「定岗只看一句职责、技能清单只用于推荐」的纪律改由 persona 约束。
6. **可选服务兜底分支暂留**：合并后 `ctx.get('bukaWorkers')` / `ctx.get('bukaWorkflows')` 始终存在，但两个方向的「服务缺失」降级路径不改（零行为变化）；后续可以在清理轮里删。
7. **迁移顺序是先卸后装**：新旧并存会重复注册同名服务 / 工具 / 补丁行，导致组合冲突。format 1 索引没有 replaced-by 字段，靠 README / DETAIL 里的「升级与迁移」章节引导。

## 后果

- 市场从四个包变三个；workflows 的元数据与详情页覆盖两半能力，workers 的关键词并入 workflows 的挂牌。
- 已安装用户需要手动迁移：卸载旧的两个插件、安装合并包；自定义过的插件配置会重置为默认（默认目录与旧版一致，数据不丢）。
- 旧 `worker-builder` 预设的历史会话仍可继续，但新建会话只能选 `Workflow`。
- 维护面变小：一套构建产物、一个版本号、一份 Config；两个域的业务代码仍分目录，不互相 import。
- 测试路径平移：workers 系列测试改 import 到 `plugins/workflows/src/workers/`，预设断言改指单一预设。
