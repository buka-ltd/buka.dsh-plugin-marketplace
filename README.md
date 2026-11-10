# Buka DSH 插件市场

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件集。它名义上是一个插件市场——把插件登记成一份 **format 1 索引**（`index.json`），DSH 用户在 **Plugins → Discover** 里填一次索引地址，就能浏览、安装、卸载；但它真正在构筑的，是一套**把 Agent 管起来的分层体系**：

| 层 | 插件 | 是什么 |
| --- | --- | --- |
| **Skill · 技能** | [`@buka/dsh-plugin-skills`](plugins/skills) | 能力与知识的最小单位：一份「会做什么 / 知道什么」的说明，本身不行动，装进机器人后才生效 |
| **Robot · 机器人** | [`@buka/dsh-plugin-robots`](plugins/robots) | 有明确职责、能力与行为的个体：自己的目录、自己的 AGENTS.md、自己装的 skills，像一个被派了具体岗位的员工 |
| **Workflow · 工作流** | [`@buka/dsh-plugin-workflows`](plugins/workflows) | 一条开始前就定好、运行中不会被临时改动的流程，把多个机器人按顺序组织起来，共同完成一件复杂工程；关键节点停下来等你介入 |

## 设计哲学

Agent 和人一样会犯错。给单个 Agent 过大的权限和能力，风险会一起放大；让一个团队直接拿着一堆 skill 自由发挥，等于把核武器按钮交给三岁小孩。

所以这套设计把三件事拆开，并让「事先写死」优先于「事后询问」：

- **能力放进 Skill，个体固定成 Robot，协作交给 Workflow**：每个机器人只拿它职责需要的技能，而不是人人都是全能的超级 Agent。
- **工作流是预先定好的**：节点、顺序、出边在开始前就写清，运行中机器人只能按图走，不能临时改流程。
- **保障来自显式的介入点**：`user` 节点会主动停下流程，把该做的决定、该完成的手动操作、该给的人工反馈交还给你。这比「AI 觉得自己该问的时候才来问你」可靠得多。

领导要的正是这一点：**在开始之前就能看到整条流程，看清哪些节点会停下来等人介入**。预先定制的流程，加上可介入的审查节点，是让领导看着就放心的东西；而不是把一堆能力塞给团队、再赌它自己懂得分寸。

仓库里没有服务端：索引是构建产物，交给 GitHub Pages 静态托管；安装由 DSH 自己的 `pluginManager` 完成，直接指向本仓库某个提交里的包目录。

## 使用（DSH 用户）

1. 打开 Web 侧边栏的 **Plugins**
2. **More（Experimental plugins）** → 打开 **Custom plugin markets**
3. 切到 **Discover** → 添加索引来源，填：

   ```text
   https://buka-ltd.github.io/buka.dsh-plugin-marketplace/index.json
   ```

4. 在列表里选插件 → Install。装完的插件出现在 **Installed** 页，可以停用或卸载。

索引地址必须能直连（DSH 拒绝重定向），也不能带账号密码或 `?query`。索引默认缓存 10 分钟，看到旧列表就等一会儿或刷新。

## 已登记插件

核心是下面三件套，逐层对应 Skill → Robot → Workflow；另有 [bell](plugins/bell)（提示音）与 [hello](plugins/hello)（冒烟模板）两个辅助插件，列在三件套之后。

| 目录 | 插件 | 用途 |
| --- | --- | --- |
| [plugins/skills](plugins/skills) | `@buka/dsh-plugin-skills` | 侧边栏新增「Skills」页面：「已安装」列出全局 skills 并识别哪些由 `npx skills` 管理、按来源选择卸载方式；「收藏」记录常用的 npx skills 来源（`owner/repo`、GitHub/GitLab 链接、任意 git 地址或本地绝对路径），点「刷新」旁边的「收藏」按钮在对话框里填仓库与备注，有网页地址的来源标题即仓库链接，可列出的来源会自动判定是 `npx skills` 仓库、Claude Code marketplace 仓库还是不可用并显示徽标，可展开成带缓存的 skills 树（git 地址先浅克隆到本地，本地路径直接扫描），关掉 DSH 再打开仍保留展开状态；并通过 `ctx.bukaSkills` 服务把收藏、仓库里的 skills 与 marketplace 插件列表开放给其他插件 |
| [plugins/robots](plugins/robots) | `@buka/dsh-plugin-robots` | 侧边栏新增「机器人」页面：机器人是本插件在 `~/.cache/dsh-plugin-robots/robots` 下创建并挂载成 DSH 工作区的目录（只管理自己创建的）；每个机器人可用 `npx skills` 安装项目级 skills、编辑自己的 AGENTS.md、一键打开会话，工作区被删后还可重新挂载；每个机器人可重命名（移动机器人目录并重建 DSH 工作区，旧会话日志保留但不再挂在该机器人下）；每个机器人带一个可更换的预设头像（新建时自动分配）与一句供工作流选择机器人的职责（对应 description 字段，类似 skill 的 description）；并通过 `ctx.bukaRobots` 服务向其他插件开放 `list()`、`avatarMap()`，以及阻塞的 `startSession()` 与非阻塞的 `dispatchSession()` / `openSession()`；机器人会话统一要求交回结构化 JSON 结果（可用 `outputSchema` 约束，工作流可传 `abortable` 允许节点用 `abort` 主动终止），并且是走正常审批策略的普通会话，能请求工具审批或向你提问，节点结束释放 live agent 后会把仍持久化的会话补通告回客户端（不会从侧边栏消失）；安装插件还会插入一个随包发布的「机器人构建」模式（preset），新建会话时可选，先问清需求、起草 AGENTS.md，再用只对该模式可见的 `buka_robot_build` 创建并挂载机器人；列表顶部还有固定使用 🤖 头像、标准模式、可进入任意已有工作区的通用型机器人（启用时作为兜底机器人暴露给工作流，停用则不再暴露），页面「设置」对话框里的开关决定它是否显示 |
| [plugins/workflows](plugins/workflows) | `@buka/dsh-plugin-workflows` | 由**编排 preset**（随插件发布 `workflow-orchestrator`，其他会话看不到创建类工具）现场创建的一次性工作流（格式 3）：节点只有 `start` / `robot` / `user` / `end` 四种，其中 `user` 是**用户介入节点**——流程在这里暂停，把只有人能做的事交给用户：等你做一个决定、等你完成一个手动操作、或等你查看只有人能看的结果并给反馈。user 节点必须写 `title`（标题，提问卡的 header），可写 `detail`（展示给你的说明，支持模板）；出边就是你能选的选项（每条边 `name` 是路由键、`label` 是显示给你的选项文字、可选 `description`），还可以用 `questions` 追加问题收集信息或修改意见（最多 4 条，选项式或自由文本）；你的回答会带回流程，后续 prompt 用 `{{nodes.<id>.route}}`（选中的出边）、`{{nodes.<id>.answers.<问题 id>.selected}}` / `.custom`（某个问题的选择与自由输入）与 `{{nodes.<id>.text}}`（整份答案的可读文本）引用。含 user 节点的定义必须**前台运行**——原生提问卡要求创建者会话有活跃 turn，工具调用会一直等到流程终止，宿主重启会中断这类运行；不含 user 节点的定义在后台运行、第一个节点 dispatch 后工具立即返回 runId，由宿主侧观察者订阅会话事件继续调度机器人会话（中断只续接同一会话，续接失败即终止；DSH 重启后未完成的运行继续跑）。同一个机器人在一次运行里共用一个会话（首次新开普通会话并挂到机器人工作区、侧边栏可见，之后先 compact 再发新的边 prompt；落到普通工作 preset）；机器人是普通会话（正常审批策略，可请求工具审批或向你提问，运行页会提示等待交互），默认不设节点超时（需要边界时给节点写 timeoutMs）；机器人节点会话还会看到四个只读观测工具（当前运行总览 / 某次执行的输入 / 输出与附件清单 / 附件读取，按运行记录里的会话 id 判定可见性，运行结束或重启后重开会话仍可用）；每个机器人节点都必须在定义里声明 `output`（结果 JSON 的 JSON Schema），并交回匹配它的 JSON（边 prompt 里的模板变量会在计划阶段按 schema 校验）；节点有出边时用 JSON 里的 `next`（等于某条出边的 `name`）选择走哪条边，或者在确实无法完成时用 `abort` 主动终止整个运行（failed + aborted 标记，不走出边、不要求声明的字段）；观察者照 next 这条边和它的 prompt 自动前进，没有 `when` 条件也不需要额外的判断 agent；附件是每个 robot 节点内置的能力（无需声明），用来交回与答案相互独立的文件 / 数据；节点可以返回 `attachments`（工作区相对路径），文件被复制到该次执行的节点目录，后续节点可用提示词里的 `{{nodes.<id>.attachments.<index>.text/.path}}` 或附件工具按需读取；机器人节点的边是 `{ to, name, prompt }`：`name` 是唯一的路由键，`prompt` 写清这次的任务与每个 `next` 值的含义（循环里同一个节点被测试打回时只换边上的指令），user 节点的边是 `{ to, name, label, description?, prompt? }`：`label` 是显示给你的选项文字，目标是机器人时 `prompt` 必填、目标是 user / 终止节点时禁止；定义里允许循环（maxSteps 与节点 maxVisits 兜底，user 节点不计入 maxVisits）；运行一次性且只兼容格式 3：格式 3 直接拒绝旧 `gate` 节点（报迁移错误，请改用 user 节点），启动时清理旧版本运行、编号从 #1 重新开始，归档设置文件保留；侧边栏「工作流」页面把每次运行画成类似 git log 的纵向节点图（机器人节点的胶囊前显示机器人头像，节点胶囊显示创建者写的步骤概要或 user 节点的标题、颜色区分类型，走过的连线高亮，鼠标悬停连线会把它变成实线、略粗一点并压暗其余连线，名字以小标签钉在线中段右侧（不跟着鼠标跑），user 边显示给你看的选项文字 `label`、机器人边显示路由名（不展示提示词等边配置）；跨行/回边走右侧竖线 lane、内层靠里外层靠外所以不交叉，循环由回边与正向边的两个方向箭头围成、重复进入的节点标 ×N，没走到的节点留在拓扑位置、显示为灰色虚线胶囊（不会排到结束节点后面）），点胶囊后节点标题就是创建者写的步骤概要（user 节点显示 `title`；节点 id 只作标题旁的小标签），再看到执行人与该节点的一个会话（可直接「打开会话」跳到对话；机器人会话按「运行目标 · 机器人」命名，侧边栏里能直接认出是哪次运行的哪段对话（节点结束释放 live agent 后会话仍留在客户端列表，运行页「打开会话」照常可用）；重复进入会标出「已压缩历史」；再次进入缺少落盘输入时提示「这次执行没有记录输入」，运行中的节点显示实时耗时，恢复过 / 超时的执行带标签），并按「第几次执行」的 Tab 查看那一次的任务信息、输出结果、状态 / 时间 / 时长与这次走出的 route（user 的那次执行输入是渲染后的 `detail`、输出是你的答案文本、route 显示选中选项的 `label`），Tab 底部左侧是上一步、右侧是下一步，可以沿运行记录两个方向走（点一下就跳到对应节点的对应执行）；运行在 user 节点等待你时，详情顶部提示「工作流正在等待你介入」并展示标题 / 说明 / 选项，可「打开会话」回到工作流创建者的会话里作答（机器人会话内请求审批或向你提问时另有一条等待交互提示），页面列表同时给这类运行带「等待用户」标签；输出结果展示最终文本与附件下载入口（不铺路由字段、也不展示原始 JSON），终止节点展示这次运行的最终输出，图例 footer 固定在页面底部不随内容滚走；有运行在跑时每 1.5 秒刷新；每次运行有一个持久递增的序号 `#N`（列表、详情与工具输出都能看到），页面「归档设置」可按小时配置自动归档（默认超过 1 天归档、超过 7 天删除；归档的运行从默认列表隐藏，超过删除时间的记录连目录一起删除，设置文件在 `~/.cache/dsh-plugin-workflows/settings.json`）；定义快照、运行状态、事件、节点结果与节点附件落盘到 `~/.cache/dsh-plugin-workflows/runs` 供回看与恢复 |
| [plugins/hello](plugins/hello) | `@buka/dsh-plugin-hello` | 冒烟模板：注册 `buka_hello` 工具，验证市场 → 安装 → composition 链路 |
| [plugins/bell](plugins/bell) | `@buka/dsh-plugin-bell` | 任务结束、等待你输入、计划被退回修改、手动终止时播放提示音；四个声音可在 设置 → 提示音 里选择（macOS 系统自带音或插件自带的「你干嘛~哎哟」梗语音，「无」表示不播） |

## 仓库结构

```text
market.json                 # 索引自身的标题、分类、标签表、发布地址
plugins/<dir>/              # 一个插件一个目录
  package.json              # 包身份、engines.dsh、dsh.bundle.patch
  market.json               # 挂牌信息：标题、简介、图标、分类、标签、关键词
  cordis.patch.yml          # bundle 层：把自己插进 composition
  lib/index.js              # Cordis 插件：导出 name / inject / apply
  client.js                 # 浏览器一半（可选）：Web UI 入口，dsh.client 声明
  icon.svg                  # Discover 页图标
scripts/                    # 生成与校验索引，无第三方依赖
schemas/index.schema.json   # format 1 的 JSON Schema（编辑期提示）
docs/agent-rules/           # 本仓库的协作规则
dist/                       # 构建产物：index.json + icons/，不进版本库
```

## 命令

需要 Node.js 22.20 及以上；仓库本身没有依赖，不需要 `pnpm install`。

```bash
pnpm run check    # 发布前自检：清单、format 1、钉住的提交是否真的含插件
pnpm test         # 校验器与生成器的单测（node --test）
pnpm run build    # 生成 dist/index.json + dist/icons/
pnpm run serve    # 本地起 http 服务预览 dist/，默认 127.0.0.1:4180
```

> 第一次在空仓库里跑 `pnpm run check` 会报「目录还没有提交」：索引要钉住插件目录的提交，先提交再校验。这是唯一必须在 `check` 之前做的动作。

本地预览：

```bash
pnpm run build && pnpm run serve
# 把 http://127.0.0.1:4180/index.json 填进 Discover
```

## 新增一个插件

```bash
mkdir -p plugins/<dir>/lib
```

按 [plugins/hello](plugins/hello) 抄一份，然后：

1. `package.json` 的 `name` 用 `@buka/dsh-plugin-<dir>`，`version` 从 `0.1.0` 起
2. `engines.dsh` 写当前 DSH 的兼容范围，`dsh.bundle.patch` 指到 `./cordis.patch.yml`
3. `cordis.patch.yml` 用一行 `insert` 把自己作为一行插件插进 composition
4. `market.json` 补标题（必须含 `en`）、简介、图标、分类、标签、关键词
5. `pnpm run check` 通过后提交

细则见 [插件编写规范](docs/agent-rules/plugin-authoring.md)。

## 发布

推送到 `main` 后，`.github/workflows/market.yml` 会：校验 → 跑测试 → 生成 `dist/` → 部署到 GitHub Pages。

一次性配置：仓库 **Settings → Pages → Source** 选 **GitHub Actions**。发布地址与 `market.json` 的 `publicUrl` 必须一致，否则图标与相对地址会解析到错误的位置。

## 文档

- [AGENTS.md](AGENTS.md) — 协作规则的索引，改任何东西前先看
- [索引格式](docs/agent-rules/index-format.md) — format 1 的字段与硬规则、托管与缓存行为
- [插件编写规范](docs/agent-rules/plugin-authoring.md)
- [常用命令](docs/agent-rules/commands.md)
- [Git 操作约束](docs/agent-rules/git.md)
