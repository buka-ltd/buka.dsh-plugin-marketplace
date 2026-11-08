# Buka DSH Plugin Marketplace

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件市场：把插件登记成一份 **format 1 索引**（`index.json`），DSH 用户在 **Plugins → Discover** 里填一次索引地址，就能浏览、安装、卸载这些插件。

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

| 目录 | 插件 | 用途 |
| --- | --- | --- |
| [plugins/hello](plugins/hello) | `@buka/dsh-plugin-hello` | 冒烟模板：注册 `buka_hello` 工具，验证市场 → 安装 → composition 链路 |
| [plugins/bell](plugins/bell) | `@buka/dsh-plugin-bell` | 任务结束、等待你输入、计划被退回修改、手动终止时播放提示音；四个声音可在 设置 → 提示音 里选择（macOS 系统自带音或插件自带的「你干嘛~哎哟」梗语音，「无」表示不播） |
| [plugins/skills](plugins/skills) | `@buka/dsh-plugin-skills` | 侧边栏新增「Skills」页面：「已安装」列出全局 skills 并识别哪些由 `npx skills` 管理、按来源选择卸载方式；「收藏」记录常用的 npx skills 来源，点「刷新」旁边的「收藏」按钮在对话框里填仓库与备注，标题即仓库链接，GitHub 仓库会自动判定是 `npx skills` 仓库、Claude Code marketplace 仓库还是不可用并显示徽标，可展开成带缓存的 skills 树，关掉 DSH 再打开仍保留展开状态；并通过 `ctx.bukaSkills` 服务把收藏、仓库里的 skills 与 marketplace 插件列表开放给其他插件 |
| [plugins/robots](plugins/robots) | `@buka/dsh-plugin-robots` | 侧边栏新增「机器人」页面：机器人是本插件在 `~/.cache/dsh-plugin-robots/robots` 下创建并挂载成 DSH 工作区的目录（只管理自己创建的）；每个机器人可用 `npx skills` 安装项目级 skills、编辑自己的 AGENTS.md、一键打开会话，工作区被删后还可重新挂载；每个机器人带一个可更换的预设头像（新建时自动分配）与一句供工作流选择机器人的职责（对应 description 字段，类似 skill 的 description）；并通过 `ctx.bukaRobots` 服务向其他插件开放 `list()`、`avatarMap()` 与 `startSession()`；安装插件还会插入一个随包发布的「机器人构建」模式（preset），新建会话时可选，先问清需求、起草 AGENTS.md，再用只对该模式可见的 `buka_robot_build` 创建并挂载机器人；列表顶部还有固定使用 🤖 头像、标准模式、可进入任意已有工作区的通用型机器人（启用时作为兜底机器人暴露给工作流，停用则不再暴露），页面「设置」对话框里的开关决定它是否显示 |
| [plugins/workflows](plugins/workflows) | `@buka/dsh-plugin-workflows` | 由**编排 preset**（随插件发布 `workflow-orchestrator`，其他会话看不到工具）现场创建的一次性工作流：不含门禁的定义在后台运行、工具立即返回 runId，由节点图继续调度机器人会话；同一个机器人在一次运行里共用一个会话（首次新开普通会话并挂到机器人工作区、侧边栏可见，之后先 compact 再发新的边 prompt；落到普通工作 preset）、不弹审批，门禁节点弹原生审批框，拒绝可跳转或终止；唯一的开始节点通过出边给第一个机器人节点定义 prompt，之后每个进入机器人节点的边各自带 prompt（循环里同一个节点被测试打回时只换边上的指令）；定义里允许循环（maxSteps 与节点 maxVisits 兜底）；侧边栏「工作流」页面把每次运行画成类似 git log 的纵向节点图（机器人节点的胶囊前显示机器人头像，节点胶囊显示创建者写的步骤概要、颜色区分类型，走过的连线高亮，鼠标悬停连线会把它变成实线、略粗一点并压暗其余连线，名字以小标签钉在线中段右侧（不跟着鼠标跑），只显示创建者写的边名字（不展示条件 / 提示词等边配置）；跨行/回边走右侧竖线 lane、内层靠里外层靠外所以不交叉，循环由回边与正向边的两个方向箭头围成、重复进入的节点标 ×N，没走到的节点留在拓扑位置、显示为灰色虚线胶囊（不会排到结束节点后面）），点胶囊后节点标题就是创建者写的步骤概要（节点 id 只作标题旁的小标签），再看到执行人与该机器人的会话（可直接「打开会话」跳到对话；机器人会话按「运行目标 · 机器人」命名，侧边栏里能直接认出是哪次运行的哪段对话；重复进入会标出「已压缩历史」），并按「第几次执行」的 Tab 查看那一次的任务信息、输出结果、状态 / 时间 / 时长，Tab 底部左侧是上一步、右侧是下一步，可以沿运行记录两个方向走（点一下就跳到对应节点的对应执行）；输出结果展示交付物正文（路由字段不铺成 key/value、也不展示原始 JSON），终止节点展示这次运行的最终交付物，图例 footer 固定在页面底部不随内容滚走；report 节点结束时没交回 JSON 会在同一会话里被追问（有次数上限），有运行在跑时每 1.5 秒刷新；定义快照、运行状态、事件与节点结果落盘到 `~/.cache/dsh-plugin-workflows/runs` 供回看，不做断点续跑 |

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
