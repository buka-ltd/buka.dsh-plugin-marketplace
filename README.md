# Buka DSH Workshop

这是一个试验性的、叛逆的项目：**把那个绝顶聪明的三岁小孩关进公司**——给他一个岗位，把流程写死，再设几道必须停下来等人的关口——图谋的却是一条可靠的生产过程，而不是赌他懂事。

**这里是固定流程驱动 Agent，不是 Agent 驱动 Agent 的团队。** 工作流是一张持久的岗位图：谁在什么时候做什么、下一步只能走哪几条通道，都先写定（可以让编排 Agent 起草并保存）；作业进入后由一个作业看板承载任务，任务沿图上的通道派发、按显式依赖就绪、由打工人或人认领。

「关进公司」落到实处，就是**技能给能力，打工人担职责，工作流约束结构，看板把任务分发到岗位，并在关键节点停下来等人**。

## 插件

| 插件                                                                              | 核心能力                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Skills · 技能](plugins/skills/README.md)（`@buka/dsh-plugin-skills`）            | 所有技能的收藏夹和清单：收藏技能来源、记录已安装的技能，需要时一键装进打工人                                                                                                                                                |
| [Workers · 打工人](plugins/workers/README.md)（`@buka/dsh-plugin-workers`）       | 有明确职责的个体：智能体有自己的目录、AGENTS.md、项目技能和一句职责，以 DSH 会话执行任务；机器人是固定程序（例如时钟），同样登记一句职责。带 `assistant` 标记的智能体可以代人任务做沟通；每个智能体还能配置新会话使用的模型 |
| [Workflows · 工作流](plugins/workflows/README.md)（`@buka/dsh-plugin-workflows`） | 持久工作流 + 作业看板：工作流是一张岗位图，作业 = 工作流 + 输入，每个作业一块看板；任务沿图上的通道派发、按显式依赖就绪、由打工人或人认领，助理打工人可代人任务沟通；内建开始 / 结束把输入与交付物交回启动者                |
| [Bell · 提示音](plugins/bell/README.md)（`@buka/dsh-plugin-bell`）                | Agent 任务结束、等你输入、计划被退回、手动终止四个时机各响一声提示，每个时机的音单独选、点一下即试听                                                                                                                        |

## 为什么这样做

Agent 和人一样会犯错。单个 Agent 越能干，一次误判能造成的事故就越大；让一个团队直接拿着一堆 skill 自由发挥，等于把核武器按钮交给三岁小孩。

人类社会的解法不是找更可靠的人，而是让危险动作必须走流程：用印、付款、发布，各有各的审批路径，发起、复核、批准往往分开，权限再大的人也跳不过去。公司用这个把「有能力」和「可以随便用」分开了。

这个项目照抄的就是这一点：**可靠性不靠 Agent 的性格，靠流程的结构。** 危险动作不是被禁止，而是只能作为流程里的一步出现：

- **动作只能落在节点里，不能自己往下走。** 工作交给流程图调度：打工人被分到哪个节点，就只做那一步，交回结果，然后由流程决定下一步；它没法顺手把后面的活也干完。
- **危险动作没有「顺手就做」的入口。** 发布、删数据只能按图发生：改代码、测试、验收、部署依次相接，前一步交回才轮得到下一步；有发布权限也得走完这条路径。就算允许「一步做完」，那一步也必须明确写在流程里。
- **编排权和执行权分开。** 编排 Agent 没有技能、也看不到技能清单，只按每个打工人的一句职责定岗排流程；它不干活，干活的打工人也拿不到编排工具。

这套控制靠结构，不靠沙箱：打工人仍然拿得到工具，硬边界交给 DSH 的沙箱和审批策略；它做到的是让危险动作成为流程里明确的一步——看得见、也拦得住。风险因此低得多，但没谁假装它是零。

于是危险能力不是被收走，而是被拆进流程：谁能做什么，取决于流程走到哪一步、前面谁放行了。领导要的正是这个——不是把能力塞给团队、再赌它懂分寸，而是流程先摆在那里，人只出现在该出现的位置。

## 快速开始

本仓库的开发需要 Node.js `>=22.20` 与 pnpm 11。首次工作先安装依赖：

```bash
pnpm install
```

插件源码在 `plugins/*/src/`（TypeScript），`plugins/*/lib/` 是编译产物、提交进 git、安装时不编译。改完源码要重建产物：

```bash
pnpm run build:code      # 先编 packages/*，再编 plugins/*，产出 .build/
pnpm run build:clients   # 从 .build/ 打出 plugins/*/lib/{index.js,client.js}
```

本地看市场索引：

```bash
pnpm run build           # 只生成 dist/index.json 与 dist/icons/，不编译插件
pnpm run serve           # 在 http://127.0.0.1:4180 预览 dist/
```

### 在 DSH 里安装

1. 打开 Web 侧边栏的 **Plugins**
2. **More（Experimental plugins）→ Custom plugin markets → Discover**
3. 添加索引来源，填：

   ```text
   https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json
   ```

4. 在列表里安装你需要的插件，装完在侧边栏或设置页出现对应入口。

### 本地开发命令

| 命令                     | 作用                                                     |
| ------------------------ | -------------------------------------------------------- |
| `pnpm run build:code`    | TypeScript 类型检查 + 编译 `packages/*` 与 `plugins/*`   |
| `pnpm run build:clients` | 用 tsdown 从 `.build/` 打出插件运行文件 `plugins/*/lib/` |
| `pnpm run build`         | 生成市场索引 `dist/`（不编译插件）                       |
| `pnpm run check`         | 发布前自检：清单、locale、format 1、钉住的提交           |
| `pnpm run serve`         | 本地 http 预览 `dist/`                                   |
| `pnpm test`              | `node --test`；`pretest` 会先跑 `build:code`             |
| `pnpm run lint`          | Biome 格式 + 静态检查                                    |

更细的说明见 [常用命令](docs/agent-rules/commands.md)。

## 目录结构

```text
plugins/<dir>/src/          # TypeScript 源码：宿主一半与界面一半
plugins/<dir>/lib/          # 编译产物，提交进 git，不手改
plugins/<dir>/locale/       # 展示文案唯一来源（meta.title/description/detail）
plugins/<dir>/docs/         # DETAIL.md / DETAIL.zh.md：市场详情长文
plugins/<dir>/market.json   # 挂牌字段：分类、标签、关键词、图标等
packages/plugin-kit/        # 宿主侧公共包，构建时内联进插件
packages/plugin-ui/         # 界面侧公共包，构建时内联进插件
scripts/                    # 索引与构建脚本（Node 直接运行 .ts）
types/dsh.d.ts              # 官方缺失的服务与 Context 增强
docs/adr/                   # 架构决策记录
dist/、.build/              # 构建产物，gitignored
```

完整目录树与文件归属见 [项目结构](docs/agent-rules/project-structure.md)。

## 文档

- [AGENTS.md](AGENTS.md)：仓库协作规则的索引与硬约束。
- [docs/agent-rules/](docs/agent-rules/)：项目结构、索引格式、插件编写、常用命令、Git 操作约束。
- [GLOSSARY.md](GLOSSARY.md)：本仓库的术语表；写文档、提交信息时用这里的词。
- [docs/adr/](docs/adr/)：已经采纳的架构决策（TypeScript 化、locale 单一来源、兼容范围等）。
