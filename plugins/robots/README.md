# @buka/dsh-plugin-robots

在**侧边栏**新增一个「机器人」页面。机器人是**本插件自己创建并登记**的目录，不是 DSH 里已有的工作区：

- **只有这里创建的机器人才归本插件管理**；DSH 里用户自己建的工作区不会出现在「机器人」页面。
- 新建机器人 = 在插件根目录下建同名目录（并写入 AGENTS.md 模板）→ 登记到插件的 `robots.json` →
  再挂到 DSH 的**工作区列表**（`workspaces.create`），侧边栏工作区里立刻出现。
- 删除机器人 = 移除插件登记 + 删除对应的工作区注册；**机器人目录、文件与会话保留**（与 DSH 删除工作区的语义一致）。
- 每个机器人可以：
  - 用 `npx skills` **按需选择**安装/移除**项目级** skills（落到 `<机器人目录>/.agents/skills`，
    同时给 Claude Code 建 `<机器人目录>/.claude/skills` 链接）；
  - 编辑自己的 `<机器人目录>/AGENTS.md`（同时维护 `CLAUDE.md` 指向它的软链接）；
  - 「新会话」——进入该机器人工作区的会话；
  - 未挂载时（例如工作区在 DSH 里被手动删掉了）显示「挂载」，一键恢复工作区注册。

## 存放位置

| 项 | 默认位置 |
| --- | --- |
| 插件全局目录 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots` |
| 机器人根目录 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots/robots` |
| 机器人登记文件 | `${XDG_CACHE_HOME:-~/.cache}/dsh-plugin-robots/robots.json` |

机器人根目录可以用插件 Config 覆盖；登记文件固定放在机器人根目录的父目录下（`<robotsDir>/../robots.json`）：

```yaml
- id: page-buka-robots
  name: '@buka/dsh-plugin-robots'
  config:
    robotsDir: ~/robots
```

`robots.json`（version 1）是「哪些算机器人」的唯一来源：

```jsonc
{
  "version": 1,
  "robots": [
    {
      "name": "writer",
      "path": "/Users/x/.cache/dsh-plugin-robots/robots/writer",
      "createdAt": "2026-11-06T00:00:00.000Z"
    }
  ]
}
```

- 写入是原子的（临时文件 + rename，权限 `0600`），新建/删除请求在 Host 里串行。
- 文件缺失按空表处理；文件损坏时页面提示并**拒绝写入**——否则一次新建就会覆盖掉原有登记。
  修复或删除该文件后刷新即可恢复。
- 机器人名字规则：1–64 个字符，不能是 `.` / `..`、不能含 `/`、`\`，不能以 `.` 开头；允许字母、数字、汉字、`._-`。

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
- 机器人目录里自动把 `CLAUDE.md` 做成指向 `AGENTS.md` 的**相对符号链接**，Claude Code 因此读同一份内容。
  已存在的用户文件/其它链接不覆盖；平台不允许建链接时（如 Windows 未开开发者模式）降级为只有
  `@AGENTS.md` 的说明文件。保存 AGENTS.md、安装 skills 时都会补一次链接，旧机器人会被自动修复。

## 页面

侧边栏导航出现一个机器人图标，点开是主面板：

- **列表页**：标题行「刷新」右侧的「创建机器人」按钮打开对话框填名称（创建后自动挂到工作区），两个按钮同一尺寸；页面里只有机器人卡片，**不展示机器人根目录与各机器人路径**。每张卡片显示名称、紧跟在名称后的挂载状态、项目 skills 数量、是否有 AGENTS.md，右侧是「新会话」「配置」「删除」（未挂载时多一个「挂载」）。删除需要二次确认，确认框说明只移除插件记录与工作区注册、保留目录与文件。
- **配置页**：标题左侧是返回列表的图标按钮（带 tooltip），挂载状态标签紧跟在标题右侧，**不展示机器人目录**；右侧是「新会话」「打开 Finder」「刷新」。正文用可切换页签分成两块：
  - **AGENTS.md**：标题右侧是保存按钮（有改动才可用），等宽文本域占满剩余高度，不展示目录与链接状态；
  - **技能**：已安装列表（可移除）与「安装 skills」按钮。安装按钮打开对话框：填来源或点 Skills 收藏夹里的
    仓库 → 「读取 skills」拿到清单 → 勾选（默认全选、已安装禁用、支持全选/取消全选）→ 安装选中的。
  所有操作结果用 Toast 提示，失败时显示 Host 返回的错误码说明；安装失败与读清单失败都在对话框里保留命令输出。

页面只做展示与触发：目录、登记表、AGENTS.md、npx skills 都走 Host 一半的包内路由；工作区的注册/删除走 DSH 自己的 Client Service（`workspaces`），这样侧边栏工作区列表能同步刷新。

## 路由

| 路由 | 作用 |
| --- | --- |
| `GET /buka-robots/list` | 登记表里的机器人 + 挂载状态 + 项目 skills + AGENTS.md 状态 |
| `POST /buka-robots/create` | 在 `robotsDir` 下建机器人目录、写 AGENTS.md 模板、登记到 `robots.json` |
| `POST /buka-robots/remove` | 只删除登记条目（目录、文件保留） |
| `POST /buka-robots/agents` | 写入某个机器人的 `AGENTS.md`（并补 `CLAUDE.md` 链接） |
| `POST /buka-robots/skills/available` | 执行 `npx skills add <source> --list`，返回可安装的 skills 与已安装名单 |
| `POST /buka-robots/skills/install` | 只安装请求里的 `skills`，同时落 `.agents/skills` 与 `.claude/skills` |
| `POST /buka-robots/skills/remove` | 在机器人目录里执行 `npx skills remove` 并返回新的 skills |
| `POST /buka-robots/reveal` | 用系统文件管理器打开机器人目录（macOS 的 Finder / Windows 资源管理器 / Linux `xdg-open`） |

除 `create` / `remove` 外，其余请求都用机器人名字（`name`）寻址，路径由 Host 从登记表读取，客户端不能传任意路径。所有路由沿用 web 组合的信任栅栏（`connection.requestRejection`），只接受本机已认证的同源请求。

## 模型工具

`buka_robots`（只读）：返回机器人根目录、登记文件、是否损坏，以及登记表里每个机器人的名称、路径、是否已挂载、项目级 skills 与是否有 AGENTS.md。创建/删除机器人、安装 skills、改 AGENTS.md 都是页面上的用户操作，不开放给模型。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch`、`dsh.client`、`locale` / `icon` 导出 |
| `cordis.patch.yml` | bundle 层唯一的一行：把自己作为 `page-buka-robots` 插入组成 |
| `lib/index.js` | Host 一半：插件入口、`robotsDir` 配置、包内路由、`buka_robots` 工具 |
| `lib/robot-store.js` | 名称校验、目录创建与 AGENTS.md 模板、frontmatter、项目 skills 扫描、AGENTS.md 读写、机器人登记表、挂载状态汇总；不依赖 DSH 运行时，便于单测 |
| `lib/npx.js` | 定位 `npx`、在机器人目录里执行 `skills add` / `skills remove`，并解析 `--list` 的文本清单 |
| `lib/reveal.js` | 按平台选择文件管理器命令（`open` / `explorer` / `xdg-open`）并打开机器人目录 |
| `client.js` | 浏览器一半：`sidebar.panellist` 图标 + `main` 面板；列表页与配置页；文案走 `ctx.locale` |
| `market.json` | 只在市场上挂牌用的展示信息，不随包发布 |
| `icon.svg` | Discover 页与 Plugins 详情页图标，构建时复制到 `dist/icons/` |
| `locale/*.json` | Plugins 页读的 `meta.title` / `meta.description`，不需要激活插件 |
| 仓库根 `test/robots-plugin.test.mjs` | robot-store 与 npx 输出清理的单测 |

## 验证安装

在 DSH 里：**Plugins → More（Experimental plugins）→ Custom plugin markets → Discover** 添加本仓库索引地址，安装后侧边栏出现「机器人」图标、点开能看到机器人列表即成功。本地调试也可以直接装目录：

```bash
dsh plugin --profile <profile> add "link:$PWD/plugins/robots"
```

## 已知限制

- 只管理**本插件创建并登记**的机器人；在 DSH 里自己新建的工作区不会出现在这里，也不会被本插件删除。
- 删除机器人只删除插件登记与工作区注册，不删除目录、文件与会话。要彻底清理，手动删除机器人目录后从登记表移除对应条目（或先删除机器人再删目录）。
- 安装 skills 需要本机有 Node.js / npm，并且能访问 skill 来源（GitHub 等）；离线且 npx 缓存里没有该包时失败信息会原样显示。
- `npx skills` 的读清单/安装/移除是整进程调用，没有进度条；网络慢时按钮会一直处于「读取中… / 安装中…」直到 180 秒超时。
- 「读取 skills」每次都会重新拉取来源（CLI 侧没有 `--list` 的缓存），大仓库要等几秒；安装本身还会再做一次拉取。
- 「打开 Finder」是让**运行 DSH 的这台机器**打开目录：桌面版就是本地 Finder；DSH 跑在远程/无图形界面的机器上时，目录会开在那台机器上（没有文件管理器则提示失败）。
- AGENTS.md 只编辑机器人根目录下那一个文件，不处理子目录里的嵌套 AGENTS.md。
- 项目 skills 读 `.agents/skills`、`.claude/skills`、`.dsh/skills` 三个根，同名只列一次（优先 `.agents` 的目录形式）；`.claude/skills` 里由 CLI 建的链接不会重复显示。
