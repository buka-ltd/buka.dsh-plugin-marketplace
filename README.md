# Buka DSH Workshop

把 Agent 管起来：**技能给能力，机器人担职责，工作流把任务走完，并在关键节点停下来等你拍板。**

## 插件

| 插件 | 核心能力 |
| --- | --- |
| [Skills · 技能](plugins/skills/README.md)（`@buka/dsh-plugin-skills`） | 所有技能的收藏夹和清单：收藏技能来源、记录已安装的技能，需要时一键装进机器人 |
| [Robots · 机器人](plugins/robots/README.md)（`@buka/dsh-plugin-robots`） | 有明确职责的个体：每个机器人有自己的 AGENTS.md、项目技能和一句职责，只拿岗位需要的技能，不是万能的超级 Agent |
| [Workflows · 工作流](plugins/workflows/README.md)（`@buka/dsh-plugin-workflows`） | 预先定好的流程：把多个机器人按顺序组织起来完成一件复杂工程，`user` 节点在关键处停下来等你介入，`mode: "plan"` 的机器人节点先交计划、你批准后再实施 |
| [Bell · 提示音](plugins/bell/README.md)（`@buka/dsh-plugin-bell`） | Agent 任务结束、等你输入、计划被退回、手动终止四个时机各响一声提示，每个时机的音单独选、点一下即试听 |

## 为什么这样做

Agent 和人一样会犯错。给单个 Agent 过大的权限和能力，风险会一起放大；让一个团队直接拿着一堆 skill 自由发挥，等于把核武器按钮交给三岁小孩。

所以我们把三件事拆开，把可靠的工作过程从一开始就定好：

- **能力放进 Skill，个体固定成 Robot，协作交给 Workflow**——每个机器人只拿职责需要的技能。
- **工作流是预先定好的**——节点、顺序、出边在开始前就写清，运行中只能按图走。
- **保障来自显式的介入点**——`user` 节点主动停下流程，把决定、操作、反馈交还给你，而不是靠 AI 觉得自己该问才问。

领导要的正是这一点：**开始之前就能看到整条流程，看清哪些节点会停下来等人介入**。预先定制的流程加上可介入的审查节点，是让领导看着就放心的东西；而不是把一堆能力塞给团队、再赌它自己懂得分寸。

## 快速开始

1. 打开 Web 侧边栏的 **Plugins**
2. **More（Experimental plugins）→ Custom plugin markets → Discover**
3. 添加索引来源，填：

   ```text
   https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json
   ```

4. 在列表里安装你需要的插件，装完侧边栏会出现对应页面。
