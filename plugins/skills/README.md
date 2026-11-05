# @buka/dsh-plugin-skills

在**侧边栏**新增一个「Skills」页面，顶部两个 Tab：

- **已安装**：列出本机**全局安装**的 skills（对所有会话生效），自动识别哪些由 [`npx skills`](https://github.com/vercel-labs/skills) 安装和管理，并按来源决定卸载方式；
- **收藏**：记下常用的 `npx skills` 来源（`owner/repo`、GitHub 链接、npm 包名），属于用户自己的书签；标题行右侧「刷新」旁边的「收藏」按钮打开对话框，填「仓库」与「备注」后提交；点仓库标题直接打开仓库页，卡片右侧的「删除」按钮（与已安装列表的卸载按钮同款样式）移除收藏；GitHub 仓库还能展开成一棵 skills 树（Host 拉取并缓存），看清仓库里有哪些可安装的 skill。

## 列出什么

DSH 的 skill 提供方（`@deepseek-ai/dsh-skill-filesystem`）会扫描几个根目录，其中两个是全局的：

| 来源 | 根目录 | 典型写入方 |
| --- | --- | --- |
| `user-agents` | `~/.agents/skills`（可用 `DSH_AGENTS_HOME` 覆盖） | `npx skills add -g`、手工安装 |
| `user-dsh` | `~/.dsh/skills`（可用 `DSH_HOME` 覆盖） | 手工安装 |

页面对这两个目录做与 DSH 相同的一层扫描：`<name>/SKILL.md` 目录或平铺的 `<name>.md`。工作区里的 `项目/.agents/skills` 只对那个项目生效，不在此列出。

每个 skill 显示名称、描述、来源根与安装来源标签。描述优先取 DSH skills 注册表解析出的 frontmatter；注册表拿不到（不可用或路径未命中）时回退到直接读 `SKILL.md` 的 `description`，保证页面上总能看到 skill 自己的描述。

## 怎么识别 npx skills

`npx skills` 安装全局 skill 时：

1. 把「规范副本」放在 `~/.agents/skills/<name>`；
2. 在其它 agent 目录（如 `~/.claude/skills`）建立指向它的链接或副本；
3. 把安装记录写进全局 lockfile：默认 `~/.agents/.skill-lock.json`，设置了 `XDG_STATE_HOME` 时是 `$XDG_STATE_HOME/skills/.skill-lock.json`（与 CLI 的 `getSkillLockPath()` 一致）。文件是 `version: 3`，键是 skill 名，值带 `source` / `sourceUrl` / `installedAt` / `updatedAt`。

所以判定条件是两条同时成立：skill 位于 `~/.agents/skills` 下，**且**名字出现在该 lockfile 里。`~/.dsh/skills` 下的 skill 永远按手工安装处理，即使 lockfile 里恰好有同名记录。

lockfile 不存在时，所有 skill 按手工安装展示；存在但无法解析、或版本比 3 旧时，页面顶部提示 lockfile 不可用，并**拒绝**卸载 `~/.agents` 下的 skill —— 这时无法判断它是否由 npx 管理，直接删目录会留下 lock 记录与悬空链接。`~/.dsh` 下的 skill 不依赖这个文件，仍然可以本地删除。

## 卸载方式

| skill 来源 | 卸载动作 |
| --- | --- |
| 被 `npx skills` 管理 | `npx skills remove <name> --global --yes`：由该工具同时删除规范副本、各 agent 目录里的链接/副本，以及 lockfile 记录 |
| 手工安装 | 直接删除扫描到的目录（或平铺的 `.md` 文件） |

两种方式都会在执行后确认目标真的消失；命令退出码为 0 但目录仍在时按失败返回原因。卸载是破坏性操作，只放在页面按钮上，不开放给模型工具。

`npx` 不在进程 `PATH` 上时（macOS 从 Dock 启动的桌面版可能出现），Host 先按 `PATH` 找，再依次尝试 `~/.local/share/mise/shims`、mise/nvm 的 Node 安装目录、Volta、Homebrew 与系统路径（Windows 还会找 npm 全局目录，并用 `npx.cmd`），最后用 `node` 直接执行 npm 自带的 `npx-cli.js`。都找不到时返回一条可照做的错误信息，不会退化成「悄悄删目录」。

卸载请求在 Host 里串行执行：`npx skills` 会整份重写共享的 lockfile，两个卸载并发可能互相覆盖条目。

## 收藏

第二个 Tab 是用户自己的书签，和已安装列表互不影响：

- 点标题行右侧的「收藏」按钮弹出对话框，填仓库与备注后提交；仓库支持 `owner/repo`、GitHub 链接、任意 http(s) 链接，或 `npx skills add` 支持的包名（如 `notion`、`@scope/pkg`）；
- 来源在写入前规范化：`https://github.com/foo/bar.git`、`www.github.com/foo/bar` 都会收敛成 `foo/bar`，再用小写值去重，所以同一个仓库的链接形式不会重复收藏；
- 每行右侧的「删除」按钮移除收藏（outline + 危险色，与已安装列表的卸载按钮一致）；标题本身就是仓库页链接，已安装列表里出现的来源会标「已安装」；
- 数据存在 DSH home 下：`<DSH_HOME 或 ~/.dsh>/buka-skills/repos.json`。写入是原子的（临时文件 + rename），文件权限 `0600`；
- 文件存在却解析不了（不是 JSON、结构不对、版本比插件新）时，页面提示、禁用「收藏」按钮并**拒绝写入**——否则「收藏一条」会悄悄清掉其它收藏。

### 仓库 skills 树

GitHub 仓库的标题左侧有展开箭头，点开后 Host 会把该仓库里可安装的 skills 列成一棵树：

- 发现规则与 `npx skills add` 一致：拉 GitHub 的递归仓库树，找 `SKILL.md`，按官方 CLI 的优先级前缀（`skills/`、`.agents/skills/` 等）过滤，目录层级直接变成树的分组；skill 名字与描述取自各自 `SKILL.md` 的 frontmatter；
- 树会缓存：`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`，TTL 30 分钟，页面顶部「刷新」会绕过缓存重拉已展开的仓库；缓存文件坏了直接重建（它是易失数据，和收藏文件不同，不需要用户修）；
- 只列 GitHub 的 `owner/repo`：包名、非 GitHub 链接照样收藏，但没有仓库树；
- 私有仓库与 GitHub 接口限流：可用 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量给 Host 提供 token（提高限额、访问私有仓库）；匿名请求限额用尽时页面提示稍后再试。

## 页面

侧边栏导航里（Plugins、Automation tasks 之后）出现一个「Skills」图标，点开就是主面板页面。视觉与控件直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`（`Button` / `Input` / `Modal` / `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标），布局照 Plugins 页面：20px 标题行 + 右侧「刷新」与「收藏」两个同尺寸按钮 + 下方分段 Tab，内容区 960px、卡片列表（无前置图标）。标题与 Tab 行吸顶，列表在页面自身的纵向滚动容器里滚动，横向不出滚动条。页面不放说明文字：

- **已安装**：标题行是名称 + 两个标签 —— 第一个是来源根（`agents` / `dsh`），第二个是安装来源（npx 管理时显示来源仓库，如 `vercel-labs/skills`；否则显示 `manual`）；卸载按钮在标题行右侧，点开后先二次确认再按上表选择方式执行。下面展示 skill 自己的 description（最多三行，超出显示 `…`），不展示安装时间；空列表会提示两个全局根目录的位置；
- **收藏**：标题行右侧常驻的「收藏」按钮（两个 Tab 都有，与「刷新」同尺寸）打开对话框，填「仓库」与「备注」后提交；页面本身只有卡片列表（标题可点开仓库页；标题行右侧是「删除」按钮，已安装的会带标记；GitHub 仓库左侧箭头展开 skills 树，目录可再折叠）；操作结果用页面底部的 Toast 提示，对话框里的失败留在对话框内提示。

页面只做展示与触发，列表、卸载、收藏与仓库树的读写都走 Host 一半注册的包内路由（`GET /buka-skills/list`、`POST /buka-skills/uninstall`、`GET|POST /buka-skills/repos`、`POST /buka-skills/repos/remove`、`GET /buka-skills/repo-skills?source=…&refresh=1`），沿用 web 组合的信任栅栏，只接受本机同源请求。

## 模型工具

`buka_skills`（只读）：返回全局 skills 的 `name` / `description` / `scope` / `managedByNpx` / `source`。模型可以用它回答「本机装了哪些全局 skill、它们是怎么装的」，卸载仍由用户在页面上完成。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch`、`dsh.client` 与 `locale` / `icon` 导出 |
| `cordis.patch.yml` | bundle 层唯一的一行：把自己作为 `skill-buka-skills` 插入组成 |
| `lib/index.js` | Host 一半：注册列表 / 卸载 / 收藏 / 仓库 skills 树路由与 `buka_skills` 工具 |
| `lib/skill-store.js` | 不含 DSH 依赖的扫描 / frontmatter 描述回退 / lockfile / 卸载决策逻辑，便于单独测试 |
| `lib/npx.js` | 定位 `npx`（PATH → mise/nvm/Volta/Homebrew → npm 自带 `npx-cli.js`）并执行 `npx skills remove` |
| `lib/repo-store.js` | 收藏来源的规范化 / 去重 / 原子读写（DSH home 下的 JSON 文件），不依赖 DSH 包 |
| `lib/repo-skills.js` | 拉 GitHub 仓库树、按 `npx skills` 的规则找 `SKILL.md`、读 frontmatter 建树，并把结果按 TTL 缓存到 DSH home |
| `client.js` | 浏览器一半：往 `sidebar.panellist` 注册侧边栏图标，往 `main` 注册同 id 的面板页面；顶部两个 Tab（已安装 / 收藏）都通过 Host 路由取数与操作，收藏用 `Modal` 对话框录入仓库与备注；UI 复用 DSH 基座模块 `@deepseek-ai/dsh-client-ui-primitives`，不需要额外声明 external |
| `market.json` | 只在市场上挂牌用的展示信息，不随包发布 |
| `icon.svg` | Discover 页与 Plugins 详情页图标，构建时复制到 `dist/icons/` |
| `locale/*.json` | Plugins 页读的 `meta.title` / `meta.description`（插件安装卡片），不需要激活插件 |

Host 一半依赖 `@deepseek-ai/dsh-tools` 的 `defineTool` 来注册工具；它由 DSH 运行时提供，本地 `link:` 调试时若解析不到，可在插件目录单独装一次（`pnpm install --ignore-workspace`）。

## 验证安装

在 DSH 里：**Plugins → More（Experimental plugins）→ Custom plugin markets → Discover** 添加本仓库索引地址，安装后侧边栏出现「Skills」图标、点开能看到列表即成功。本地调试也可以直接装目录：

```bash
dsh plugin --profile <profile> add "link:$PWD/plugins/skills"
```

## 已知限制

- 只管理全局根目录；项目级 `.agents/skills` 由项目自己负责。
- 识别依赖 `npx skills` 当前的 lockfile 结构（version 3，位置随 `XDG_STATE_HOME` 变化）；更旧版本的 lockfile 会被当作不可用并拒绝自动卸载。
- `npx skills remove` 需要本机有 Node.js / npm；离线且 npx 缓存里没有该包时会失败，错误会原样显示在页面上。
- 同名 skill 同时存在于两个全局根时，两行都会列出；卸载其中一行只影响对应根目录。
- 收藏页只记录来源，不会替你安装、也不生成安装命令：安装仍要自己执行 `npx skills add <来源> -g`，安装范围与 skill 选择由该命令决定。
- 收藏文件损坏时页面只读不写，修复或删除 `buka-skills/repos.json` 后刷新即可恢复。
- 仓库树只支持 GitHub；要访问私有仓库或避开匿名限额，给 Host 进程设置 `GITHUB_TOKEN` / `GH_TOKEN`。
- 仓库树按 30 分钟 TTL 缓存，仓库里的 skill 刚更新时可能还是旧列表；点顶部「刷新」可以强制重拉已展开的仓库。
