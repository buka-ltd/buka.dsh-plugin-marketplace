# @buka/dsh-plugin-robots

在**侧边栏**新增一个「机器人」页面。机器人是**本插件自己创建并登记**的目录，不是 DSH 里已有的工作区：

- **只有这里创建的机器人才归本插件管理**；DSH 里用户自己建的工作区不会出现在「机器人」页面。
- **通用型机器人**（不用创建）：列表顶部固定一张「通用型机器人」卡片，头像固定 🤖、标准模式，
  没有自己的目录、AGENTS.md 与 skills。它的「进入工作区」会列出 DSH 里已有的工作区，
  选一个就以标准模式打开那个工作区。启用时它也会以「通用型机器人」的名字出现在工作流的
  机器人清单里（排在所有登记机器人之后，作为没有其他更合适机器人时的兜底）；标题行的
  「设置」按钮里可以关掉它，设置存在 `<robotsDir>/../settings.json`，关掉后它既不在页面出现，
  也不再暴露给工作流、不能被工作流调用（随时可以再启用）。
- 新建机器人 = 在插件根目录下建同名目录（并写入 AGENTS.md 模板）→ 登记到插件的 `robots.json` →
  再挂到 DSH 的**工作区列表**（`workspaces.create`），侧边栏工作区里立刻出现。
- 重命名机器人 = 把 `<robotsDir>/<旧名>` 目录真正改名为新名 → 登记表里同一条目就地更新
  `name` / `path`（位置、`createdAt`、`avatar`、`description` 不变）→ 删除旧工作区注册（若之前已挂载），
  再按新路径**重建**工作区（未挂载的机器人改名后也会按新路径挂载，与构建工具「始终保证挂载」一致）；
  **旧会话日志保留，但不再挂在这个机器人下**（这是改名语义的已知代价）。
- 删除机器人 = 移除插件登记 + 删除对应的工作区注册；**机器人目录、文件与会话保留**（与 DSH 删除工作区的语义一致）。
- 每个机器人可以：
  - **选一个预设头像**（新建时默认带一个，之后点详情页标题旁的头像即可更换）；
  - **写一句职责**（`description`，类似 skill 的 description）：工作流通过只读工具
    `buka_robots` 读到它，据此决定是否把某个节点交给这个机器人；
  - **重命名**：改机器人目录名并重建 DSH 工作区，已有会话日志保留但不再列在这个机器人下；
  - 用 `npx skills` **按需选择**安装/移除**项目级** skills（落到 `<机器人目录>/.agents/skills`，
    同时给 Claude Code 建 `<机器人目录>/.claude/skills` 链接）；
  - 编辑自己的 `<机器人目录>/AGENTS.md`（同时维护 `CLAUDE.md` 指向它的软链接）；
  - 「新会话」——进入该机器人工作区的会话；
  - 未挂载时（例如工作区在 DSH 里被手动删掉了）显示「挂载」，一键恢复工作区注册。
- **安装插件就自动获得「机器人构建」模式**：新建会话时选它，agent 会问清机器人要做什么，起草名字、头像、一句职责与 AGENTS.md，然后用只对该模式可见的 `buka_robot_build` 创建并挂到工作区；给已有机器人改名也走同一个工具（先确认再改）。

## 机器人构建模式（preset）

bundle 补丁除了插入页面本身，还插入一个 agent preset（DSH 里叫「模式」，与工作流插件的「工作流编排」同一机制）：

| 项 | 值 |
| --- | --- |
| preset id | `robot-builder` |
| 显示名 | 机器人构建 |
| 顺序 | 10（`standard` 之后、`workflow-orchestrator` 之前） |

新建会话时选「机器人构建」，agent 会先问清这个机器人要做什么，再给出名字、头像、一句职责与完整的 AGENTS.md 草稿，等用户确认后调用 `buka_robot_build` 创建机器人、写 AGENTS.md 并挂到工作区；**已有机器人要改名时也走同一个工具**：传 `name`（旧名）+ `newName`（新名）+ `update: true`，先和用户确认再改——改名会移动目录、重建工作区，旧会话不再列在该机器人下；最后告诉用户机器人在哪、怎么开新会话、建议在「技能」页装哪些 skills。它不做机器人自己的工作，也不会创建或改名用户没要求的机器人。

- 写入口 `buka_robot_build` 只对 `builderPresets` 点名的 preset 的**根会话**可见：其他 preset、由它 spawn 出来的子会话都看不到，直接调用也会被 `assertAccess` 挡住（见 `lib/access.js`）。组成里没有 `sessions` / `agentPresets` 服务时收紧为不可见——写操作宁可不可用，也不暴露给普通会话。
- 前提是组成里有 `@deepseek-ai/dsh-agent-preset` 与 `@deepseek-ai/dsh-agent-preset-registry`（Web / 桌面组合自带）；没有 preset 服务的纯 headless 组成里，页面照常工作，只是没有这个模式。
- 想换成自己的 preset：把 Config 的 `builderPresets` 改成对应 id；留空表示不按 preset 收窄（所有会话都能看到写工具，不推荐）。
- 想改预设的身份或文案：用 profile 补丁按补丁行 id `preset-robot-builder` 覆写这一行的 `config`（`id` 重复会让声明加载失败，所以不要直接再加一个同 id 的 preset）。`builderPresets` 只决定谁能调用写工具，不改变 preset 自身。

## 存放位置

| 项 | 默认位置 |
| --- | --- |
| 插件全局目录 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots` |
| 机器人根目录 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots/robots` |
| 机器人登记文件 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots/robots.json` |
| 插件设置文件 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots/settings.json` |

机器人根目录可以用插件 Config 覆盖；登记文件与设置文件固定放在机器人根目录的父目录下
（`<robotsDir>/../robots.json`、`<robotsDir>/../settings.json`）：

```yaml
- id: page-buka-robots
  name: '@buka/dsh-plugin-robots'
  config:
    robotsDir: ~/robots
    resultRetries: 2
    builderPresets: ['robot-builder']
```

`resultRetries`（默认 2）是机器人没有交回合法 JSON 结果时在原会话里追问的次数上限；`0` 表示不重试。`builderPresets`（默认 `['robot-builder']`）是能看到并调用 `buka_robot_build` 的 agent preset 名单，见上文「机器人构建模式」。

`robots.json`（version 1）是「哪些算机器人」的唯一来源：

```jsonc
{
  "version": 1,
  "robots": [
    {
      "name": "writer",
      "path": "/Users/x/.cache/dsh-plugin-robots/robots/writer",
      "createdAt": "2026-11-06T00:00:00.000Z",
      "avatar": "panda",
      "description": "把会议记录整理成三点结论"
    }
  ]
}
```

- 写入是原子的（临时文件 + rename，权限 `0600`），新建 / 删除 / 改名请求在 Host 里串行。
- `avatar` 是预设头像 id。旧登记表没有这个字段（或在别处被改坏）时，读取端按名字哈希
  兜底成一个确定的预设；下一次写登记表时会把具体 id 补上。新建机器人一定带头像。
- `description` 是给工作流选择机器人用的一句职责，最长 500 个字符；读取 / 写入时会把
  换行与连续空白折叠成一个空格。旧登记表没有这个字段时按空串处理，
  在详情页的「职责」页签里补上即可，也可以在创建机器人时直接填。
- 重命名时同一条目就地更新 `name` 与 `path`，位置、`createdAt`、`avatar`、`description` 不变；
  `avatar` 按旧名解析成具体 id 后写回，避免旧记录缺头像时改名导致头像漂移。改名同时移动机器人
  目录、重建 DSH 工作区；**已有会话日志保留，但不再挂在这个机器人下**。
- 文件缺失按空表处理；文件损坏时页面提示并**拒绝写入**——否则一次新建就会覆盖掉原有登记。
  修复或删除该文件后刷新即可恢复。
- 机器人名字规则：1–64 个字符，不能是 `.` / `..`、不能含 `/`、`\`，不能以 `.` 开头；允许字母、数字、汉字、`._-`。重命名的新名同样走这套规则，并且不能等于旧名、不能与登记表里其它机器人、机器人根目录下已存在的目录或内置「通用型机器人」重名。

`settings.json`（version 1）只放页面设置，与「哪些算机器人」无关：

```jsonc
{
  "version": 1,
  "generalRobot": { "enabled": true }
}
```

- `generalRobot.enabled` 决定通用型机器人是否出现在页面、以及是否出现在工作流的机器人清单里；清单里它与普通机器人同形，没有额外标记字段。默认 `true`，文件缺失时也按 `true` 处理。
- 写入同样是原子的（临时文件 + rename，权限 `0600`）；文件损坏或字段类型不对时读取端回落到默认值，
  下一次在设置对话框里改开关会把文件重建成合法内容——设置不是登记表，坏文件不会挡住页面。
- 通用型机器人不写进 `robots.json`。启用时它出现在 `buka_robots` 工具清单的最后（字段与普通机器人相同，职责写明没有专用机器人时使用），
  也会出现在 `avatarMap()` 里（固定 `robot` 头像 id，节点图画 🤖）；`startSession({ robot: '通用型机器人' })`
  在**调用方所在的工作区**里跑一个标准模式会话，因此该工作区的 AGENTS.md 与项目 skills 照常生效。
  停用后这三处都不再提供它，调用会直接报错。`ctx.bukaRobots.list()` 仍然只列登记表里的机器人
  （不扫描目录的轻量接口）。

## 头像

头像只存预设 id（例如 `panda`），显示用的 emoji 与底色由两个浏览器一半各自维护一份
同一 id 的映射：本插件的 `client.js`（机器人页）与工作流插件的 `client.js`（节点图）。
所以 **id 是跨插件的稳定契约**，增删预设时要同步三处：`lib/avatar.js`、`client.js`、
`plugins/workflows/client.js`。

预设：`sprout` 🌱、`sun` ☀️、`cat` 🐱、`fox` 🦊、`panda` 🐼、`owl` 🦉、`whale` 🐳、
`octopus` 🐙、`bee` 🐝、`rocket` 🚀、`dino` 🦖、`ghost` 👻、`penguin` 🐧、`unicorn` 🦄、
`mushroom` 🍄。

🤖 不在预设集合里：它固定属于通用型机器人，普通机器人不再能选到它；旧登记表里残留的
`robot` 头像 id 会按名字哈希落回其它预设。

默认分配是确定性的：新建机器人时优先挑一个还没有被占用的预设（避免刚建的一批全一样），
旧机器人 / 没传头像时按名字哈希到固定预设。`setRobotAvatar()` 只改登记表里的 `avatar`，
不碰目录、AGENTS.md 与工作区。

## 挂载状态

列表数据把登记的机器人目录和 DSH 工作区注册表按**规范路径**对上：

- `mounted: true`：已有一个 DSH 工作区指向该目录，`workspaceId` 是它的 id；「新会话」可用。
- `mounted: false`：目录还在登记表里，但工作区注册已经不在了（例如用户在 DSH 侧边栏删除了工作区）。
  页面显示「未挂载」并给出「挂载」按钮，点了就重新 `workspaces.create({ path })`。
- `exists: false`：机器人目录被外部删掉了；技能与 AGENTS.md 操作会失败，页面会提示。

## 项目级 skills

| 根目录 | 说明 |
| --- | --- |
| `<机器人目录>/.agents/skills` | 规范副本（`npx skills add -a universal` 的落点） |
| `<机器人目录>/.claude/skills` | Claude Code 的落点；由 `npx skills add -a claude-code` 建到上面的链接 |
| `<机器人目录>/.dsh/skills` | DSH 自己的项目级根目录（手工安装时可能出现在这里） |

页面把这三个根下的 `<name>/SKILL.md` 与平铺的 `<name>.md` 都列出来（同名只列一次），名称/描述取 frontmatter；安装来源从 `<机器人目录>/skills-lock.json` 读。

安装分成「读清单」和「安装」两步，先由用户勾选：

```text
npx --yes skills add <source> --list     # cwd = 机器人目录，只列可安装的 skills
npx --yes skills add <source> --skill <name> [--skill <name>…] -a universal -a claude-code -y
npx --yes skills remove <name> -y        # cwd = 机器人目录
```

- 安装对话框默认**全选**清单里的 skills，已经装过的置灰不可选；
- `-a universal -a claude-code` 一次写出 `.agents/skills/<name>` 与 `.claude/skills/<name>`，
  不用 `--all`（它会按机器上装了哪些 agent 建额外目录）；
- 来源除了手填，还可以直接用 **Skills 插件**（`@buka/dsh-plugin-skills`）里收藏的仓库：
  页面读它的 `GET /buka-skills/repos`（跨插件只读契约）。Skills 插件没安装时该路由 404，
  「收藏夹」这一块就不显示，其余功能不受影响。

`npx` 不在进程 `PATH` 上时（macOS 从 Dock 启动的桌面版常见），Host 依次尝试 `PATH`、mise、nvm、Volta、Homebrew/系统目录，最后用 `node` 直接执行 npm 自带的 `npx-cli.js`。读清单与安装/移除超时都是 180 秒，失败时把命令输出原样带回页面。同一工作区的 npx 请求在 Host 里串行执行，避免并发重写 `skills-lock.json`。

> `skills add --list` 只提供给人看的文本输出（`--json` 不能与 `--list` 同用），Host 解析其中
> `Available Skills` 段；CLI 输出格式变化导致解析不到时会明确报错并带回原始输出。

## AGENTS.md 与 CLAUDE.md

- 读取上限 256 KiB；超过上限时页面显示提示，请用外部编辑器修改。
- 保存上限 512 KiB，直接覆盖机器人目录下的 `AGENTS.md`。
- 新建机器人时若 `AGENTS.md` 不存在，会写入一段带机器人名称与路径的模板；已存在则不覆盖。
- 重命名时只有 `AGENTS.md` 内容**仍与用旧名 / 旧路径生成的模板完全一致**，才会改成新模板；
  用户改过就不动，避免覆盖用户内容。
- 机器人目录里自动把 `CLAUDE.md` 做成指向 `AGENTS.md` 的**相对符号链接**，Claude Code 因此读同一份内容。
  已存在的用户文件/其它链接不覆盖；平台不允许建链接时（如 Windows 未开开发者模式）降级为只有
  `@AGENTS.md` 的说明文件。保存 AGENTS.md、安装 skills 时都会补一次链接，旧机器人会被自动修复。

## 页面

侧边栏导航出现一个机器人图标，点开是主面板：

- **列表页**：最上面是「通用型机器人」卡片（🤖 头像；说明写「以标准模式在任意已有工作区里执行通用任务，自身没有目录、AGENTS.md 或 skills；没有专用机器人时使用」；唯一动作「进入工作区」），
  下面是登记表里的机器人卡片。标题行「刷新」右侧的「创建机器人」按钮打开对话框填名称与职责
  （创建后自动挂到工作区）；「刷新」左侧的「设置」按钮打开设置对话框，里面只有「通用型机器人」开关。
  每张卡片还会展示该机器人的职责，方便在列表里直接比较。
  页面里只有机器人卡片，**不展示机器人根目录与各机器人路径**。每张机器人卡片显示头像、名称、紧跟在
  名称后的挂载状态、项目 skills 数量、是否有 AGENTS.md，右侧是「新会话」「配置」「删除」
  （未挂载时多一个「挂载」）。删除需要二次确认，确认框说明只移除插件记录与工作区注册、保留目录与文件。
  创建对话框里有头像选择器（默认选一个还没被占用的预设）。
  通用型机器人的「进入工作区」对话框读取 DSH 现有的工作区注册表，点一行就以标准模式打开该工作区；
  它没有配置页（没有目录、AGENTS.md 与 skills 可配）。
- **配置页**：标题左侧是返回列表的图标按钮（带 tooltip），标题旁是头像（点它打开「更换头像」对话框，从预设里选一个保存），挂载状态标签紧跟在标题右侧，**不展示机器人目录**；右侧是「新会话」「打开 Finder」「刷新」。标题行还有重命名入口：一个铅笔图标按钮（tooltip / aria-label 为 `重命名 <机器人名>`，`corrupt`、目录缺失或写操作进行中时禁用），点开「重命名机器人」对话框填「新名称」（1–64 字符，与新建同一套规则）；保存后会**改机器人目录名并重建 DSH 工作区**，已有会话仍保留，但不再列在这个机器人下。名称为空、与当前名相同或保存中时保存按钮禁用，失败信息留在对话框里。正文用可切换页签分成三块：
  - **职责**：用一句话写清这个机器人负责什么 + 提示（工作流会读它决定是否把节点交给这个机器人），右侧是保存按钮，只有改动后才可用；
  - **AGENTS.md**：标题右侧是保存按钮（有改动才可用），等宽文本域占满剩余高度，不展示目录与链接状态；
  - **技能**：已安装列表（可移除）与「安装 skills」按钮。安装按钮打开对话框：填来源或点 Skills 收藏夹里的
    仓库 → 「读取 skills」拿到清单 → 勾选（默认全选、已安装禁用、支持全选/取消全选）→ 安装选中的。
  所有操作结果用 Toast 提示，失败时显示 Host 返回的错误码说明；安装失败与读清单失败都在对话框里保留命令输出。

页面只做展示与触发：目录、登记表、AGENTS.md、npx skills 都走 Host 一半的包内路由；工作区的注册/删除走 DSH 自己的 Client Service（`workspaces`），这样侧边栏工作区列表能同步刷新。

## 路由

| 路由 | 作用 |
| --- | --- |
| `GET /buka-robots/list` | 登记表里的机器人 + 挂载状态 + 项目 skills + AGENTS.md 状态 |
| `POST /buka-robots/create` | 在 `robotsDir` 下建机器人目录、写 AGENTS.md 模板、登记到 `robots.json`；可带 `avatar`（不传则自动分配）与 `description` |
| `POST /buka-robots/rename` | 把机器人目录改名为 `newName`、就地更新登记表 `name` / `path`，并在新路径重建 DSH 工作区（删除旧工作区注册）；已有会话日志保留但不再挂在该机器人下 |
| `POST /buka-robots/avatar` | 改某个机器人的头像 id（只动登记表） |
| `POST /buka-robots/description` | 改某个机器人的职责（只动登记表；工作流用它选机器人） |
| `POST /buka-robots/remove` | 只删除登记条目（目录、文件保留） |
| `POST /buka-robots/agents` | 写入某个机器人的 `AGENTS.md`（并补 `CLAUDE.md` 链接） |
| `POST /buka-robots/skills/available` | 执行 `npx skills add <source> --list`，返回可安装的 skills 与已安装名单 |
| `POST /buka-robots/skills/install` | 只安装请求里的 `skills`，同时落 `.agents/skills` 与 `.claude/skills` |
| `POST /buka-robots/skills/remove` | 在机器人目录里执行 `npx skills remove` 并返回新的 skills |
| `POST /buka-robots/reveal` | 用系统文件管理器打开机器人目录（macOS 的 Finder / Windows 资源管理器 / Linux `xdg-open`） |
| `GET /buka-robots/workspaces` | 列出 DSH 里已有的工作区（id / 标题 / 路径 / 会话数），给通用型机器人的「进入工作区」对话框用 |
| `GET /buka-robots/settings` | 读插件设置（目前只有通用型机器人开关） |
| `POST /buka-robots/settings` | 写入插件设置；设置文件与登记表同级（`settings.json`） |

除 `create` / `remove` 外，其余请求都用机器人名字（`name`）寻址（`rename` 另带 `newName`），路径由 Host 从登记表读取，客户端不能传任意路径。所有路由沿用 web 组合的信任栅栏（`connection.requestRejection`），只接受本机已认证的同源请求。

## 模型工具

- `buka_robots`（只读，所有会话可见）：返回机器人根目录、登记文件、是否损坏，以及登记表里每个机器人的名称、路径、**职责**、是否已挂载、项目级 skills 与是否有 AGENTS.md。职责是工作流编排器选择机器人的主要依据。通用型机器人启用时也会出现在清单的最后，字段与普通机器人完全同形（没有额外标记）；它的职责写明没有专用机器人时使用。本工具只读：新建、修改与**重命名**都走 `buka_robot_build`（或页面）。
- `buka_robot_build`（写，只对 `builderPresets` 点名的 preset 根会话可见）：创建、修改或重命名一个机器人并挂到工作区。参数是 `name` / `newName` / `avatar` / `description` / `agents`（完整 AGENTS.md）/ `update`；同名已存在且没传 `update: true` 时拒绝，避免模型覆盖用户的机器人。`newName` 把 `name` 指定的**已存在**机器人改名为 `newName`，必须同时传 `update: true`，同一次调用还可以继续改头像 / 职责 / AGENTS.md；改名会移动机器人目录并重建 DSH 工作区，已有会话日志保留但不再列在该机器人下，所以**应先和用户确认再改**，也不要改用户没要求改的机器人。输出增加 `renamed` 与 `previousName`（未改名时分别为 `false` / `null`）。挂载失败不算构建失败：返回 `mounted: false` 与 `mountError`，机器人本身已经建好。删除机器人、安装 skills、在页面上编辑 AGENTS.md 仍然只属于页面上的用户操作。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch`、`dsh.client`、`locale` / `icon` 导出 |
| `cordis.patch.yml` | bundle 层两条 insert：`page-buka-robots`（本插件）与 `preset-robot-builder`（随包发布的「机器人构建」preset） |
| `lib/index.js` | Host 一半：插件入口、`robotsDir` / `builderPresets` 配置、包内路由（含 `POST /buka-robots/rename`）、`buka_robots` 只读工具、`buka_robot_build` 的注册与可见性判定 |
| `lib/robot-store.js` | 名称校验、目录创建与重命名（连目录一起改、失败回滚）、AGENTS.md 模板、frontmatter、项目 skills 扫描、AGENTS.md 读写、机器人登记表与头像写入、挂载状态汇总；不依赖 DSH 运行时，便于单测 |
| `lib/avatar.js` | 预设头像 id、默认分配与校验；id 是跨插件契约，浏览器一半各自维护 emoji / 底色映射 |
| `lib/access.js` | `buka_robot_build` 的可见性判定：只放行点名 preset 的根会话；preset 服务缺失时收紧为不可见；纯函数，便于单测 |
| `lib/builder.js` | 一次「构建」的语义：请求规范化、已存在机器人要 `update: true`、改名（`newName`）移动目录并重建工作区、写 AGENTS.md、补 CLAUDE.md 链接、按规范路径判断挂载并只在需要时 `workspaceRegistry.create()`；不依赖 DSH 包，便于单测 |
| `lib/build-tool.js` | `buka_robot_build` 的工具定义、参数（含 `newName`）/ 结果 schema（含 `renamed` / `previousName`）与 `render`；`defineTool` 由入口注入，便于单测 |
| `lib/settings.js` | 插件设置（通用型机器人开关）：`settings.json` 的原子读写、默认值与坏文件回落；不依赖 DSH 包，便于单测 |
| `lib/general-robot.js` | 通用型机器人的固定名字、职责、固定 🤖 头像 id 与清单项；靠它与 `avatarMap()` / `startSession()` 对接，对外不携带任何特殊标记 |
| `lib/service.js` | 对外 Host Service `ctx.bukaRobots`：`list()`、`avatarMap()`、阻塞的 `startSession()`、非阻塞的 `dispatchSession()`（返回 `readResult` / `send` / `retryReport` / `cancel` / `dispose` 可观测句柄）与只 resume、不发 prompt 的 `openSession()`；新开会话或按 `sessionId` 续接同一会话，续接前先 compact；每个会话都要求交回 JSON（scoped `structured_output`，可用 `outputSchema` 约束），不合法时按 `resultRetries` 追问；默认不限时；不依赖 DSH 包（`defineTool` 由入口注入），便于单测 |
| `lib/npx.js` | 定位 `npx`、在机器人目录里执行 `skills add` / `skills remove`，并解析 `--list` 的文本清单 |
| `lib/reveal.js` | 按平台选择文件管理器命令（`open` / `explorer` / `xdg-open`）并打开机器人目录 |
| `client.js` | 浏览器一半：`sidebar.panellist` 图标 + `main` 面板；列表页（通用型机器人卡片 + 设置对话框）、配置页（含重命名入口与对话框）；文案走 `ctx.locale` |
| `market.json` | 只在市场上挂牌用的展示信息，不随包发布 |
| `icon.svg` | Discover 页与 Plugins 详情页图标，构建时复制到 `dist/icons/` |
| `locale/*.json` | Plugins 页读的 `meta.title` / `meta.description`，不需要激活插件 |
| 仓库根 `test/robots-plugin.test.mjs` | robot-store、头像契约 / 通用型机器人专属 🤖、settings 读写、工作区清单与 npx 输出清理的单测 |
| 仓库根 `test/robots-client.test.mjs` | 浏览器一半的渲染冒烟：通用型机器人卡片、设置对话框、进入工作区对话框 |
| 仓库根 `test/robots-builder.test.mjs` | 可见性判定、构建 / 挂载与工具映射的单测 |

## 对外 Service：`ctx.bukaRobots`

除页面与模型工具外，插件还通过 `ctx.provide('bukaRobots', ...)` 暴露一个 Host Service，供其他插件（例如工作流插件）把工作交给机器人：

```js
export const inject = ['bukaRobots']

export function apply(ctx) {
  const { robots } = await ctx.bukaRobots.list()
  const session = await ctx.bukaRobots.startSession({
    robot: robots[0].name,
    prompt: '把这份调研整理成三点结论，结束时交回 JSON：{ status, summary }。',
    // 可选：结构化结果的 JSON Schema（不传时是任意对象）；routes 用于告诉服务
    // 合法的工作流 route 名，缺省时结果里不需要 next。
    outputSchema: {
      type: 'object',
      properties: { status: { type: 'string' }, summary: { type: 'string' } },
      required: ['status', 'summary'],
    },
    title: '调研总结 · 写作者', // 会话标题；不传则由 DSH 自动命名（机器人消息不会触发自动命名）
    timeoutMs: 5 * 60 * 1000, // 可选硬超时；不传就不限时（没有默认超时）
  })
  const first = await session.result
  // { sessionId, robot, text, structured, resultRetries?, stopReason, error?, resumed?, compacted? }

  // 同一个机器人再次执行：传回上一次的 sessionId。服务会先 compact 这个会话的
  // 历史，再把新的 prompt 发进同一个会话，而不是另开一个新的。
  const again = await ctx.bukaRobots.startSession({
    robot: robots[0].name,
    prompt: '测试打回了，按下面的问题修复。',
    sessionId: first.sessionId,
  })
  const second = await again.result
  // { sessionId: first.sessionId, resumed: true, compacted: true, ... }
}
```

观察者式调用（工作流插件就是这样用的）：不 await 结果、不设默认超时，把 prompt 投进会话后自己订阅 `session/event`，`turn/end` 后读结果：

```js
const { robots } = await ctx.bukaRobots.list()
const handle = await ctx.bukaRobots.dispatchSession({
  robot: robots[0].name,
  prompt: '检查登录页并跑测试，结束时交回 JSON：{ next: "pass" | "fix", status, summary }。',
  routes: ['pass', 'fix'], // 工作流节点的出边名；结果里的 next 必须是其中之一
  outputSchema: { type: 'object', properties: { next: { enum: ['pass', 'fix'] } }, required: ['next'] },
})
// handle.startSeq 是这一轮的起点；调用方只处理自己登记过的会话事件。
const turn = handle.readResult() // { sessionId, text, stopReason, turnEnded, structured?, resultRetries? }
// turn.turnEnded 为 true 才表示这一轮真的结束；中断后恢复时先用它检查上一轮是否其实已经完成。

// 恢复：只打开已有会话（resume / attach），不发 prompt。
const resumed = await ctx.bukaRobots.openSession({ robot: robots[0].name, sessionId: turn.sessionId })
const check = resumed.readResult({ sinceSeq: handle.startSeq })
if (check.turnEnded !== true) {
  await resumed.send('继续完成刚才的任务', { compactFirst: true }) // 同一会话再发一条
  const continued = resumed.readResult({ sinceSeq: resumed.startSeq })
}
await resumed.cancel('timeout') // 取消当前轮，返回已经写下的内容
await resumed.dispose()         // 只释放 live agent，会话日志保留
```

`startSession()` 的行为（默认 `wait: true`，保持“投递后等会话结束再返回结果”的阻塞语义；传 `wait: false` 等价于 `dispatchSession()`，见下文）：

- 不传 `sessionId` 时创建一个**普通顶层会话**（`cwd = 机器人目录`），并挂到机器人自己的工作区：所以侧边栏能看到、点开就是普通对话。机器人的 AGENTS.md 与项目 skills 照常生效；创建失败直接报错，不退回 subagent，也不另开新会话；
- `robot: '通用型机器人'` 走内置兜底项：不要求登记表条目，启用时把**调用方会话所在的工作区**当 cwd（没有调用方会话时退回宿主默认工作目录），以标准模式运行；停用时直接报错。工作流只应在没有其他合适机器人时选它；
- 可传 `title` 给会话命名：新会话直接写入标题；续接时只在会话还没有标题的情况下补写，不覆盖用户手动改过的名字。机器人会话的首条消息来源是 `buka-robot`，DSH 的自动标题只看 `user` 来源的消息，所以不传 `title` 的机器人会话在侧边栏里会一直显示「未命名」——工作流插件会传「运行目标 · 机器人」；
- 传 `sessionId` 时是该会话的**续接**：通过 `ctx.agents.resume()` 把会话重新加载成 live agent，先调用 `ctx.compaction.compactNow()` 压缩历史，再把这次 `prompt` 发进同一个会话。返回的 `resumed` 为 `true`，`compacted` 表示这次是否真的压缩了内容。压缩失败（例如摘要模型不可用）不会中断这一轮：`compacted` 为 `false`，原因写进 `compactionError`，prompt 照常发送；会话不存在 / 不可恢复 / 是旧版隐藏 subagent 会话时直接报错，不新开会话，调用方按失败处理；
- 可传 `agentPreset` 显式指定该会话使用的 agent preset：不传时新会话按宿主默认组合创建，续接时优先恢复会话里记录的 preset；工作流插件用它把机器人节点落到普通工作 preset（默认 `standard`），避免继承编排器的 persona 与工具集；
- **每个会话都要交回 JSON**：服务会注册 scoped 工具 `structured_output`，结果出现在 `result.structured`。可传 `outputSchema` 约束这个工具的 JSON Schema，不传时接受任意对象；最后一条回复本身是 JSON 对象（含 ```json 代码块）时同样算交回；
- 可传 `routes`（合法的工作流 route 名列表）：结束时没有交回合法 JSON、或（工作流节点有出边时）`next` 不在 `routes` 里，服务会在**同一个会话**里补一条消息，说明当前问题和合法 route，要求重新回复，最多 `resultRetries` 次；重试用尽仍不合法时 `stopReason` 为 `error`，`error` 里写明追问了几次。工作流还可以用 `reason: 'invalid-output'` 与可选的 `detail` 追问「结果不符合节点声明的 output schema」，服务会把 detail 原样附在追问消息里；
- **走正常审批策略**：机器人是普通会话，未显式传 `approval`（或传 `'ask'`）时沿用部署的审批策略，可以在会话里请求工具审批或向用户提问；只有显式 `approval: 'never'` 才强制拒绝（无头场景）。机器人会话是**运行时根会话**，续接时也不挂回父会话；工作流不会注入行为提示词；
- **没有默认超时**：不传 `timeoutMs` 时会话按自己的节奏跑完（旧版本默认 10 分钟，已移除）。需要硬截止时显式传正的 `timeoutMs`（毫秒）；超时 / 取消时中断会话，再尽量收集已经产生的输出，`stopReason` 为 `timeout` / `aborted`；
- 读取结果后自动释放该轮的 live agent（会话日志仍然保留，可在侧边栏回看）；续接同一个会话不会新开会话。DSH 在 `session/disposed` 时会向客户端发 `api-session/removed`，所以释放后服务会用宿主 `sessionController.list()` 取回这条仍然持久化的会话并补发一次 `api-session/added`：节点结束时它不会从侧边栏消失，运行页的「打开会话」也仍然能进入。`sessionController` 不存在（headless 组合）或读列表失败时只记一条 warn，不影响节点结果；
- 续接前的压缩来自宿主 `compaction` 服务（`@deepseek-ai/dsh-compaction-basic`）。桌面 profile 默认禁用它：缺失时续接仍会继续，但 `compacted` 为 `false`，`compactionError` 说明“压缩服务不可用”，页面会提示；需要真正压缩时在插件页启用该服务。

### 非阻塞调用：`dispatchSession()` / `openSession()` / `startSession({ wait: false })`

工作流观察者不 await 会话结果，而是把 prompt 投进去后订阅全局 `session/event`、在 `turn/end` 后自己读结果。服务为此提供三个入口：

- `startSession({ ...request, wait: false })`：等价于 `dispatchSession(request)`；默认仍是 `wait: true`，既有调用方不受影响；
- `dispatchSession({ robot, prompt, sessionId?, routes?, outputSchema?, ... })`：把 prompt 投进机器人会话后立即返回一个**可观测句柄**，不在服务里等待这一轮结束，也不设默认超时；
- `openSession({ robot, sessionId, ... })`：只 resume / attach 一个已有会话，**不发 prompt**；恢复时先用 `readResult()` 检查上一轮是否其实已经结束（`turnEnded`），确认要继续再 `send()`。

句柄字段：`mode`（固定 `session`）、`sessionId`、`robot`、`cwd`、`resumed`、`compacted`、`compactionError?`、`startSeq`（这一轮的起点序号），以及：

| 方法 | 作用 |
| --- | --- |
| `readResult({ sinceSeq? })` | 从会话日志读 `sinceSeq` 之后的这一轮：`{ sessionId, text, stopReason, turnEnded, turnEndSeq?, structured?, resultRetries? }` |
| `send(text, { compactFirst? })` | 在同一会话里再发一条（恢复续跑 / 结果追问），默认先 compact；返回新的起点 seq |
| `retryReport({ routes?, reason?, detail? })` | 结果不合法时取下一条追问（会列出合法 route 与当前问题；`reason: 'invalid-output'` 时附上 `detail`）；没有额度时返回 `null` |
| `cancel(reason?)` | 取消当前轮，等它落定后返回已经写下的结果 |
| `dispose()` | 只释放这一轮的 live agent，会话日志仍然保留；释放后服务会把这条仍然持久化的会话补通告回客户端（`api-session/added`），所以侧边栏与「打开会话」都不受影响 |

所有机器人会话都是普通顶层会话；`openSession()` 遇到旧版 `origin: 'subagent'` 的隐藏会话会直接报错，不会把它当成可见会话继续。

`list()` 返回 `{ root, registry, corrupt, robots }`，每个机器人带 `name / path / avatar / description / exists / mounted / workspaceId / skills / agents` 摘要（不含 AGENTS.md 正文）。这里仍然只列登记表里的机器人；通用型机器人只通过 `buka_robots` 工具、`avatarMap()` 和 `startSession()` 暴露。

`avatarMap()` 返回 `{ [机器人名]: 头像 id }`：只读登记表，不扫描机器人目录，所以可以频繁调用（工作流运行页每次刷新都会用它画节点图上的头像）。通用型机器人启用时额外带 `通用型机器人: 'robot'`（节点图画固定 🤖，不出现在普通机器人的头像预设里）；登记表损坏时只返回这一项。

## 验证安装

在 DSH 里：**Plugins → More（Experimental plugins）→ Custom plugin markets → Discover** 添加本仓库索引地址，安装后侧边栏出现「机器人」图标、点开能看到机器人列表即成功。本地调试也可以直接装目录：

```bash
dsh plugin --profile <profile> add "link:$PWD/plugins/robots"
```

## 已知限制

- 只管理**本插件创建并登记**的机器人；在 DSH 里自己新建的工作区不会出现在这里，也不会被本插件删除。
- 重命名会移动机器人目录并重建 DSH 工作区：旧的 DSH 工作区注册被删除，**已有会话日志虽然保留（不会被删除），但不再列在这个机器人下**。内容被用户改过的 AGENTS.md 不会同步新名 / 新路径。
- 删除机器人只删除插件登记与工作区注册，不删除目录、文件与会话。要彻底清理，手动删除机器人目录后从登记表移除对应条目（或先删除机器人再删目录）。
- 工作流定义与运行记录按**机器人名字**引用机器人；改名不会自动更新这些引用，已有的定义 / 运行仍指向旧名（旧名因此可以被新机器人复用，重名引用要自己梳理）。
- 安装 skills 需要本机有 Node.js / npm，并且能访问 skill 来源（GitHub 等）；离线且 npx 缓存里没有该包时失败信息会原样显示。
- `npx skills` 的读清单/安装/移除是整进程调用，没有进度条；网络慢时按钮会一直处于「读取中… / 安装中…」直到 180 秒超时。
- 「读取 skills」每次都会重新拉取来源（CLI 侧没有 `--list` 的缓存），大仓库要等几秒；安装本身还会再做一次拉取。
- 「打开 Finder」是让**运行 DSH 的这台机器**打开目录：桌面版就是本地 Finder；DSH 跑在远程/无图形界面的机器上时，目录会开在那台机器上（没有文件管理器则提示失败）。
- AGENTS.md 只编辑机器人根目录下那一个文件，不处理子目录里的嵌套 AGENTS.md。
- 项目 skills 读 `.agents/skills`、`.claude/skills`、`.dsh/skills` 三个根，同名只列一次（优先 `.agents` 的目录形式）；`.claude/skills` 里由 CLI 建的链接不会重复显示。
