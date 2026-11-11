# @buka/dsh-plugin-skills

在**侧边栏**新增一个「Skills」页面，顶部两个 Tab：

- **已安装**：列出本机**全局安装**的 skills（对所有会话生效），自动识别哪些由 [`npx skills`](https://github.com/vercel-labs/skills) 安装和管理，并按来源决定卸载方式；
- **收藏**：记下常用的 `npx skills` 来源（`owner/repo`、GitHub/GitLab 等链接、任意 git 地址、本地绝对路径、npm 包名），属于用户自己的书签；标题行右侧「刷新」旁边的「收藏」按钮打开对话框，填「仓库」与「备注」后提交；有网页地址的来源点标题直接打开仓库页，卡片右侧的「删除」按钮（与已安装列表的卸载按钮同款样式）移除收藏；可列出的来源还会自动判定类型并在卡片上标出 —— `npx skills` 仓库、Claude Code marketplace 仓库，或都不可用的「不可用」；前两种还能展开成一棵 skills 树（Host 读取并缓存，展开状态跨重启保留），看清仓库里有哪些可安装的 skill；树里每个 skill 右侧有「安装」按钮，点一下就把**这一个** skill 装到全局（Host 交给 `npx skills add -g`），已经装过的显示禁用的「已安装」按钮。

页面之外，插件还把收藏与仓库内容开放成一个 Host Service `ctx.bukaSkills`：其他插件用 `inject: ['bukaSkills']` 就能列出收藏的仓库、某个仓库里的 skill 列表，或某个 Claude Code marketplace 里的插件列表，见下方[对外服务](#对外服务host-service)。

## 列出什么

DSH 的 skill 提供方（`@deepseek-ai/dsh-skill-filesystem`）会扫描几个根目录，其中两个是全局的：

| 来源          | 根目录                                            | 典型写入方                    |
| ------------- | ------------------------------------------------- | ----------------------------- |
| `user-agents` | `~/.agents/skills`（可用 `DSH_AGENTS_HOME` 覆盖） | `npx skills add -g`、手工安装 |
| `user-dsh`    | `~/.dsh/skills`（可用 `DSH_HOME` 覆盖）           | 手工安装                      |

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

| skill 来源           | 卸载动作                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 被 `npx skills` 管理 | `npx skills remove <name> --global --yes`：由该工具同时删除规范副本、各 agent 目录里的链接/副本，以及 lockfile 记录 |
| 手工安装             | 直接删除扫描到的目录（或平铺的 `.md` 文件）                                                                         |

两种方式都会在执行后确认目标真的消失；命令退出码为 0 但目录仍在时按失败返回原因。卸载是破坏性操作，安装会改写全局目录与 `npx skills` 的 lockfile；两者都只放在页面按钮上，不开放给模型工具。

`npx` 不在进程 `PATH` 上时（macOS 从 Dock 启动的桌面版可能出现），Host 先按 `PATH` 找，再依次尝试 `~/.local/share/mise/shims`、mise/nvm 的 Node 安装目录、Volta、Homebrew 与系统路径（Windows 还会找 npm 全局目录，并用 `npx.cmd`），最后用 `node` 直接执行 npm 自带的 `npx-cli.js`。都找不到时返回一条可照做的错误信息，不会退化成「悄悄删目录」。

卸载请求在 Host 里串行执行：`npx skills` 会整份重写共享的 lockfile，两个卸载并发可能互相覆盖条目。

## 收藏

第二个 Tab 是用户自己的书签，和已安装列表互不影响：

- 点标题行右侧的「收藏」按钮弹出对话框，填仓库与备注后提交；仓库支持 `owner/repo`、GitHub/GitLab 等网页链接、任意 git 地址（`https://`、`ssh://`、`git://`、`git@host:path`）、本地绝对路径（含 `file://`），以及 `npx skills add` 支持的包名（如 `notion`、`@scope/pkg`）；
- 来源在写入前规范化：`https://github.com/foo/bar.git`、`www.github.com/foo/bar` 都会收敛成 `foo/bar`，本地路径做 `path.normalize` 并去掉尾部斜杠，其余 git 地址原样保留（只去掉尾部 `/`）；再用小写值去重，所以同一个来源的链接形式不会重复收藏；
- 每行右侧的「删除」按钮移除收藏（outline + 危险色，与已安装列表的卸载按钮一致）；标题在来源有网页地址时（GitHub 与 `http(s)` 链接）是仓库页链接，`ssh` / `git` / 本地路径显示为纯文本；已安装列表里出现的来源会标「已安装」；
- 数据存在 DSH home 下：`<DSH_HOME 或 ~/.dsh>/buka-skills/repos.json`。写入是原子的（临时文件 + rename），文件权限 `0600`；
- 文件存在却解析不了（不是 JSON、结构不对、版本比插件新）时，页面提示、禁用「收藏」按钮并**拒绝写入**——否则「收藏一条」会悄悄清掉其它收藏。

### 仓库判定、徽标与 skills 树

收藏页打开后，Host 会对每个可列出的收藏（GitHub、任意 git 地址、本地绝对路径）做一次判定，卡片标题行显示结果徽标（`npx skills` / `Claude Code 市场` / `不可用`）。包名与已知不是仓库根的子页面链接只能收藏，没有判定徽标、也没有仓库树。判定按下面的顺序进行，命中即停：

1. **npx skills 仓库（标准布局）**：读仓库的递归树，按 `npx skills add` 的**优先级前缀**在标准目录（`skills/`、`.agents/skills/`、`skills/.curated/` 等，见 CLI 的 `PRIORITY_PREFIXES`）里找 basename 为 `SKILL.md` 的文件（大小写不敏感，`foo-skill.md` 这类普通 Markdown 不算）。命中至少一个就按 npx skills 仓库处理；判定只看这棵树，不依赖仓库清单文件；
2. **Claude Code marketplace 仓库**：没有优先级命中时，看仓库根有没有 `.claude-plugin/marketplace.json`。文件存在且能解析成合法 marketplace，就按 marketplace 仓库处理；
3. **npx skills 仓库（兜底布局）**：没有可用的 marketplace 文件（没有、JSON 不合法或结构不对）时，npx 的兜底规则仍然生效 —— 树里任意不超过 6 段的 `SKILL.md` 都算发现，按 npx skills 仓库处理；
4. **不可用**：以上都不是，卡片标「不可用」，展开时提示原因。

第 2 步先于第 3 步，是因为 npx 的兜底规则非常宽松：Claude Code marketplace 的 `plugins/<plugin>/skills/<name>/SKILL.md` 正好是 5 段，会被兜底命中；若兜底也算 npx 且排在前，marketplace 仓库就永远显示成 npx。把顺序拆成「标准 npx 布局 → marketplace → npx 兜底」后，标准 npx 仓库仍然优先，marketplace 也能被正确识别并分组。

判定与建树都走同一层「读仓库」抽象，按来源分三种：

- **GitHub `owner/repo`**：走 GitHub API 拉递归树与文件内容，可用 `GITHUB_TOKEN` / `GH_TOKEN` 提高限额、访问私有仓库；
- **本地绝对路径**：Host 直接扫描目录（跳过 `node_modules`、`.git`、`dist`、`build` 等，遍历有深度 / 条数 / 单文件大小上限，超过就截断），不复制也不缓存内容，刷新即重新扫描；
- **任意 git 地址**：先 `git clone --depth 1` 到 `<DSH_HOME 或 ~/.dsh>/buka-skills/cache/git/<url 的 hash>/`，再按本地目录扫描；刷新时 `git fetch` 更新，失败（如离线）就复用旧克隆继续读。需要本机 `git` 在 `PATH` 上，私有仓库用本机 git 凭据 / SSH key。

展开可用的仓库才拉每个 `SKILL.md` 的 frontmatter 并建树：

- **npx skills 仓库**：展示方式与 `npx skills add --list` 一致，**不按仓库的物理目录分组**。`skills/<bucket>/<skill>/SKILL.md` 这种 catalog 布局里 bucket 只对发现有作用，skill 一律平铺；只有仓库根的 `.claude-plugin/plugin.json` 或 `.claude-plugin/marketplace.json` 里**显式声明**某个 skill 目录属于哪个插件时，才把该 skill 放进以插件名命名的目录节点（与 CLI 的 `getPluginGroupings()` 一致，同名插件的 skill 合并；没有声明清单、清单读不到或不合法时全部平铺）。frontmatter 里 `metadata.internal: true` 的内部 skill 默认不列（与 `npx skills` 一致，它只在被显式按名字请求时才安装）；skill 名字与描述取自各自 `SKILL.md` 的 frontmatter，名称缺失时回退目录名、仓库根 `SKILL.md` 回退仓库名；
- **Claude Code marketplace 仓库**：按 `.claude-plugin/marketplace.json` 的 `plugins` 逐个插件分组，目录节点就是插件名，只列该插件目录下的 `SKILL.md`（`skills/` 默认目录、插件根的单文件 skill、以及 manifest 里自定义的 skills 目录都能覆盖）；`source` 指向仓库外（github / url / git-subdir / npm 等）的插件无法在本仓库里列出，直接跳过；marketplace 里没有任何可列 skill 时展开为空树，但仍算有效市场；
- 判定与树都会缓存：`<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`（version 5；npx 树的分组方式变了，旧缓存自动作废），TTL 30 分钟；探测只记判定结果（不写整棵树），展开时补全；marketplace 的清单也随完整树一起缓存，所以「列出市场里有哪些插件」不必重拉，没有 skill 的插件也能列出来。缓存写入是串行的「读最新内容 → 改 → 原子写」，并发探测不会互相覆盖条目；页面顶部「刷新」会绕过缓存：重新判定全部可列出的收藏、重拉已展开仓库的树；缓存文件坏了直接重建（它是易失数据，和收藏文件不同，不需要用户修）；
- 页面状态也会缓存：展开过哪些仓库、收起了哪些目录、每个仓库上次拿到的树都存在浏览器 localStorage（键 `dsh.buka-skills.view.v1`）。关掉 DSH 再打开时，收藏页先按上次的样子渲染（不显示加载中、不等网络），切到「收藏」后后台再向 Host 校正一次，Host 磁盘缓存过期才会重新读取仓库；徽标来自探测，不进 localStorage，重启后会先短暂不显示；localStorage 不可用或写满时自动退回不缓存，功能不受影响；
- 包名照样收藏，但没有判定徽标、也没有仓库树；已知不是仓库根的子页面链接（如 `https://github.com/o/r/tree/main/...`）同样只能收藏，展开会提示不支持；
- 私有仓库与接口限流：GitHub 用 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量给 Host 提供 token（提高限额、访问私有仓库），匿名请求限额用尽时页面提示稍后再试；任意 git 地址的私有仓库用本机 git 凭据 / SSH key。

### 一键安装收藏里的 skill

展开一个可用的收藏后，每个 skill 右侧都有操作入口：

| 状态   | 显示                                                   | 行为                                                                |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------- |
| 未安装 | 「安装」按钮（下载图标）                               | 点一下把这个 skill 装到全局，其它行的按钮在请求期间一并禁用         |
| 安装中 | 状态点 + 「安装中…」                                   | Host 正在执行 `npx skills add`，只影响请求的那一行                  |
| 已安装 | 禁用的「已安装」按钮（对勾图标，与安装按钮同款同尺寸） | 两个全局根里任何一个已有同名 skill 都算；要重装先去「已安装」里卸载 |

安装命令等价于：

```bash
npx skills add <收藏来源> --skill <skill 名字> --global --yes -a universal
```

所以装的是 `npx skills` 的全局规范副本 `~/.agents/skills/<目录名>`（也是 DSH 的 `user-agents` 根，对所有会话生效），lockfile 由 `npx skills` 自己维护。`-a universal` 是 CLI 自带的「通用 agent」：只写规范副本，不往本机其它 agent 目录（`~/.claude/skills` 等）建链接——DSH 页面上的安装只改 DSH 会扫描的全局目录。想顺便给别的 agent 用，自己跑一次不带 `-a` 的 `npx skills add` 即可。CLI 版本如果不认识 `universal` 这个 agent，Host 会自动退回不带 `-a` 的默认命令，错误信息照常上报。装完切到「已安装」就能看到它，并标成 npx 管理、来源是这条收藏。

Host 侧的约束：

- 只允许安装**收藏过**的来源；浏览器只传来源与 skill 在仓库里的路径，名字和「这个 skill 是否存在」都以 Host 这次读到的仓库列表为准，页面过期的缓存不会让它装错东西；
- 已安装（两个全局根里任一命中同名目录）时直接拒绝并提示先去卸载，不会覆盖；
- 安装目标固定是 `~/.agents/skills`：`DSH_AGENTS_HOME` 指到别处时拒绝安装，避免装到 DSH 扫描不到的目录；
- 安装与卸载共用一条串行队列，因为 `npx skills` 会整份重写共享的 lockfile；
- 命令退出码为 0 但 `SKILL.md` 不在目标目录时按失败上报，错误信息带上命令输出。

安装失败用页面底部的 Toast 提示（仓库读取失败、限流、skill 已不在列表里、npx 失败等）；成功同样用 Toast 提示并只重读「已安装」列表，已经展开的仓库树不会重建。

## 页面

侧边栏导航里（Plugins、Automation tasks 之后）出现一个「Skills」图标，点开就是主面板页面。视觉与控件直接复用 DSH 的基座模块 `@deepseek-ai/dsh-client-ui-primitives`（`Button` / `Input` / `Modal` / `SegmentedTabs` / `Tag` / `Tooltip` / `Toast` / `StateDot` 与图标），布局照 Plugins 页面：20px 标题行 + 右侧「刷新」与「收藏」两个同尺寸按钮 + 下方分段 Tab，内容区 960px、卡片列表（无前置图标）。标题与 Tab 行吸顶，列表在页面自身的纵向滚动容器里滚动，横向不出滚动条。页面不放说明文字：

- **已安装**：标题行是名称 + 两个标签 —— 第一个是来源根（`agents` / `dsh`），第二个是安装来源（npx 管理时显示来源仓库，如 `vercel-labs/skills`；否则显示 `manual`）；卸载按钮在标题行右侧，点开后先二次确认再按上表选择方式执行。下面展示 skill 自己的 description（最多三行，超出显示 `…`），不展示安装时间；空列表会提示两个全局根目录的位置；
- **收藏**：标题行右侧常驻的「收藏」按钮（两个 Tab 都有，与「刷新」同尺寸）打开对话框，填「仓库」与「备注」后提交；页面本身只有卡片列表（来源有网页地址时标题可点开仓库页，否则是纯文本；标题行还会标出 `npx skills` / `Claude Code 市场` / `不可用`；右侧是「删除」按钮，已安装的会带标记；可列出的仓库左侧箭头展开 skills 树，目录可再折叠，树里每个 skill 右侧是「安装」按钮 /「安装中…」/ 禁用的「已安装」按钮）；操作结果用页面底部的 Toast 提示，对话框里的失败留在对话框内提示。

页面只做展示与触发：列表、卸载、安装、收藏、仓库判定与仓库树的读写都走 Host 一半注册的包内路由（`GET /buka-skills/list`、`POST /buka-skills/uninstall`、`POST /buka-skills/install`、`GET|POST /buka-skills/repos`、`POST /buka-skills/repos/remove`、`GET /buka-skills/repo-skills?source=…[&refresh=1][&probe=1]`），沿用 web 组合的信任栅栏，只接受本机同源请求。`probe=1` 是轻量判定（只回仓库类型与 skill 数量，不拉 `SKILL.md`），收藏页打开时对每张卡片各发一次。例外只有收藏页自己的展开状态与上次拿到的树：它们是纯页面状态，缓存在浏览器 localStorage（`dsh.buka-skills.view.v1`），重开 DSH 时先用它恢复视图，再找 Host 校正。

## 模型工具

`buka_skills`（只读）：返回全局 skills 的 `name` / `description` / `scope` / `managedByNpx` / `source`。模型可以用它回答「本机装了哪些全局 skill、它们是怎么装的」；安装与卸载仍由用户在页面上完成。

## 对外服务（Host Service）

插件在 Host 一侧注册一个 Cordis 服务 `ctx.bukaSkills`（服务名常量 `SERVICE_NAME = 'bukaSkills'`，定义在 `src/service.ts`）。页面与 `buka_skills` 工具用的是同一个实例，所以页面展开过的树、另一个插件随后调服务，命中的是同一份缓存与同一批在途请求。

消费方声明依赖即可，不要 `import` 本包的实现：

```js
export const inject = ['bukaSkills']

export function apply(ctx) {
  ctx.effect(() => ctx.bukaSkills.listRepositories(), 'my-plugin: saved repos')
}
```

服务实例本身不注册 effect：插件卸载时 Cordis 自动把它从 `ctx` 上摘除，并唤醒/重载依赖它的插件。

### 方法

| 方法                                | 返回                                                                          | 说明                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRepositories({ refresh? })`    | `{ file, exists, corrupt, repositories }`                                     | 收藏的仓库，按收藏文件顺序；每条带 `kind`（`npx-skills` / `claude-code-marketplace` / `unavailable` / `unknown`）、预计 `skills` 数与探测失败原因                                       |
| `listSkills({ source, refresh? })`  | `{ ok: true, source, kind, ref, sha, fetchedAt, cached, truncated, skills }`  | 仓库里所有可安装 skill 的扁平列表；每条 `{ name, description, path, plugin }`，`plugin` 是仓库清单里显式声明它所属的插件名（npx skills 与 marketplace 都适用），没有归入插件时为 `null` |
| `listPlugins({ source, refresh? })` | `{ ok: true, source, kind, ref, sha, fetchedAt, cached, truncated, plugins }` | Claude Code marketplace 里声明的插件，每个 `{ name, root, description, skills }`；没有 skill 的插件也会出现（`skills: []`）                                                             |

本地路径来源的 `ref` 是 `worktree`、`sha` 为空串；git 来源的 `ref` 是 `HEAD`、`sha` 取克隆当前的提交号。

失败统一返回 `{ ok: false, code, message }`，`code` 与仓库层一致：`invalid-source`、`unsupported-source`（包名与不是仓库根的子页面链接）、`repo-not-found`、`rate-limited`、`fetch-failed`、`repo-unavailable`、`git-unavailable`（本机找不到 `git`）、`git-failed`（clone / fetch / 读仓库失败）；`listPlugins()` 对非 marketplace 仓库另加 `not-a-marketplace`。`listRepositories()` 不会整体失败：单条探测失败降级为 `kind: 'unknown'`，`code` / `error` 带上原因。

### 语义

- 只读：收藏的增删与 skill 的安装 / 卸载都是页面上的用户操作，不通过服务暴露；
- 仓库读取（GitHub API、本地目录扫描、git 克隆）复用 `src/repo-skills.ts` 的 TTL 缓存（30 分钟），`refresh: true` 绕过；同一来源的并发调用合并成一次请求；
- `listPlugins()` 的完整插件列表来自 `.claude-plugin/marketplace.json`，`listSkills()` 与页面展开的树来自同一次拉取；
- 收藏文件损坏时 `listRepositories()` 如实返回 `corrupt: true` 与空列表，不猜测、不写回。

对外只通过 `ctx.bukaSkills` 使用服务；不要 import 本包的实现（`package.json` 没有导出 `/service` 子路径）。

## 结构

| 文件                                           | 作用                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                 | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch`、`dsh.client`、`files` 含 `lib`、`locale` / `icon` 导出                                                                                                                                                                                                                                            |
| `cordis.patch.yml`                             | bundle 层唯一的一行：把自己作为 `skill-buka-skills` 插入组成                                                                                                                                                                                                                                                                                          |
| `src/index.ts`                                 | Host 入口：装配路由与 `buka_skills` 工具、把 `ctx.bukaSkills` 服务注册进 composition；安装与卸载共用一条 npx 串行队列；只做装配                                                                                                                                                                                                                       |
| `src/service.ts`                               | 对外服务 `ctx.bukaSkills`：`listRepositories()` / `listSkills()` / `listPlugins()`；持有仓库请求的并发合并与 TTL 缓存入口，不依赖 DSH 包，便于单独测试                                                                                                                                                                                                |
| `src/skill-store.ts`                           | 不含 DSH 依赖的扫描 / frontmatter 描述回退 / lockfile / 卸载决策逻辑，便于单独测试                                                                                                                                                                                                                                                                    |
| `src/skill-install.ts`                         | 「安装」按钮背后的逻辑：只接受收藏来源、按 Host 读到的仓库列表定位 skill、交给 `npx skills add -g`，安装后确认 `SKILL.md` 落到 `~/.agents/skills`；拒绝已安装与 `DSH_AGENTS_HOME` 指到 npx 不会写的位置，不依赖 DSH 包，便于单独测试                                                                                                                  |
| `src/repo-store.ts`                            | 收藏来源的规范化与分类（GitHub / 任意 git 地址 / 本地路径 / 网页链接 / 包名）/ 去重 / 原子读写（DSH home 下的 JSON 文件），不依赖 DSH 包                                                                                                                                                                                                              |
| `src/repo-skills.ts`                           | 读仓库（GitHub API、本地目录、git 克隆）并按判定顺序识别 `npx skills` / Claude Code marketplace 仓库（都不是则不可用）；`probeRepoKind()` 只做轻量判定，`fetchRepoSkills()` 读 `SKILL.md` frontmatter 建树（npx 仓库按 CLI 的清单方式平铺 / 按仓库清单显式声明的插件分组）并带回 marketplace 清单；结果按 TTL 缓存到 DSH home，写入串行化避免并发覆盖 |
| `src/repo/**`                                  | 仓库读取的实现细节：缓存、发现规则、分组、GitHub API、marketplace 清单、失败分类、本地 / git 来源与树模型                                                                                                                                                                                                                                             |
| `src/local-source.ts`                          | 本地目录的读取抽象：递归遍历（跳过依赖 / 构建目录，有深度、条数、单文件大小上限）与限定在根目录内的文件读取，输出与 GitHub 树一致的形状，便于单独测试                                                                                                                                                                                                 |
| `src/git-source.ts`                            | 任意 git 地址的克隆缓存：`git clone --depth 1` 到 `buka-skills/cache/git/`，刷新时 fetch / reset，离线复用旧克隆；git 不在 `PATH` 与 clone 失败分别报 `git-unavailable` / `git-failed`，便于单独测试                                                                                                                                                  |
| `src/routes.ts`、`src/tools.ts`、`src/http.ts` | 包内路由、`buka_skills` 只读工具与请求 / 响应辅助；npx 的定位与执行来自 `@buka/plugin-kit` 的 `createNpxRunner`                                                                                                                                                                                                                                       |
| `src/client/index.ts`                          | 浏览器一半入口：往 `sidebar.panellist` 注册侧边栏图标，往 `main` 注册同 id 的面板页面；只导出 `inject` / `apply`                                                                                                                                                                                                                                      |
| `src/client/**`                                | 两个 Tab（已安装 / 收藏）、页面状态、请求、词典与样式；收藏页自动探测来源类型并显示徽标，展开状态与树另存 localStorage                                                                                                                                                                                                                                |
| `lib/index.js`                                 | 构建产物（ESM）：Host 一半的运行文件；不手改                                                                                                                                                                                                                                                                                                          |
| `lib/client.js`                                | 构建产物：界面一半的运行文件，外层是 `window.__ModuleLoader__.load({...})` 外壳；不手改                                                                                                                                                                                                                                                               |
| `market.json`                                  | 只在市场上挂牌用的展示信息（分类、标签、关键词、图标等），不随包发布                                                                                                                                                                                                                                                                                  |
| `icon.svg`                                     | Discover 页与 Plugins 详情页图标，构建时复制到 `dist/icons/`                                                                                                                                                                                                                                                                                          |
| `locale/*.json`                                | 展示文案的唯一来源：`meta.title` / `meta.description` / `meta.detail`，不需要激活插件                                                                                                                                                                                                                                                                 |
| `docs/DETAIL.md`、`docs/DETAIL.zh.md`          | 市场详情页长文，由对应 locale 的 `meta.detail` 指向                                                                                                                                                                                                                                                                                                   |

Host 一半依赖 `@deepseek-ai/dsh-tools` 的 `defineTool` 来注册工具；它由 DSH 运行时提供。本地 `link:` 调试时若解析不到，先确认仓库根已经跑过 `pnpm install`（开发依赖都在根），不要把开发依赖写进插件清单。

## 验证安装

在 DSH 里：**Plugins → More（Experimental plugins）→ Custom plugin markets → Discover** 添加本仓库索引地址，安装后侧边栏出现「Skills」图标、点开能看到列表即成功。本地调试也可以直接装目录（先确保 `plugins/skills/lib/` 已由 `pnpm run build:code && pnpm run build:clients` 生成）：

```bash
dsh plugin --profile <profile> add "link:$PWD/plugins/skills"
```

## 已知限制

- 只管理全局根目录；项目级 `.agents/skills` 由项目自己负责。
- 识别依赖 `npx skills` 当前的 lockfile 结构（version 3，位置随 `XDG_STATE_HOME` 变化）；更旧版本的 lockfile 会被当作不可用并拒绝自动卸载。
- `npx skills remove` 需要本机有 Node.js / npm；离线且 npx 缓存里没有该包时会失败，错误会原样显示在页面上。
- 同名 skill 同时存在于两个全局根时，两行都会列出；卸载其中一行只影响对应根目录。
- 「安装」一次只装一个 skill，且这个 skill 必须能出现在仓库列表里：包名与网页子页面不能安装；命令等价于 `npx skills add <收藏来源> --skill <名字> --global --yes -a universal`，需要网络与可用的 `npx`（GitHub 列表走 Host 缓存，git 来源用本机 git / SSH 凭据）。CLI 不认识 `universal` agent 时会退回不带 `-a` 的命令，那种版本可能同时给其它 agent 目录建链接。
- 安装目标固定是 `~/.agents/skills`（`npx skills` 的全局规范副本目录）：把 `DSH_AGENTS_HOME` 指到别处时「安装」会拒绝执行，避免装到 DSH 扫描不到的目录。
- 两个全局根里已有同名 skill 时，那一行显示禁用的「已安装」按钮并拒绝重装；要重装先在「已安装」里卸载。
- 同一仓库里出现同名 skill 时按名字安装，由 `npx skills` 自己的发现顺序决定装哪一个（与手动执行该命令一致，页面无法指定物理目录）。
- 安装成功但 `npx skills` 没有写 lockfile 时（例如手工改坏了 lockfile），「已安装」里的新 skill 会按手工安装展示；这不影响使用，只是解锁时会走直接删目录。
- 收藏文件损坏时页面只读不写，修复或删除 `buka-skills/repos.json` 后刷新即可恢复。
- 非 GitHub 的 `http(s)` 链接会被当作 git 仓库尝试 `git clone`：普通网页链接在展开时报错；已知不是仓库根的子页面链接（如 `https://github.com/o/r/tree/main/...`）只能收藏、不判定。
- 任意 git 地址依赖本机 `git` 在 `PATH` 上，找不到时判定与展开都报 `git-unavailable`，页面提示没有找到 git；clone / fetch 在 Host 进程里执行，私有仓库用本机 git 凭据 / SSH key，交互式认证被关掉，不会弹登录。
- 克隆缓存放在 `<DSH_HOME 或 ~/.dsh>/buka-skills/cache/git/`，不会被自动清理；删除收藏只删记录，不会删除已克隆的目录，需要时手动清理。
- 本地路径直接扫描目录、不复制文件：`node_modules` / `.git` / `dist` 等目录被跳过，巨型仓库超过遍历上限时树会被截断。
- GitHub 私有仓库与匿名限额：给 Host 进程设置 `GITHUB_TOKEN` / `GH_TOKEN`，否则匿名请求限额用尽时页面提示稍后再试。
- marketplace 判定优先于 npx 的宽松兜底：仓库根有合法的 `.claude-plugin/marketplace.json` 时，`plugins/**` 下的 skills 会按插件分组展示，而不是平铺成 npx 树。
- npx 仓库的展示分组只认仓库根的 `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` 里**显式声明**的 skills 目录（与 `npx skills` CLI 相同）；`source` 指向仓库外、或清单放在子目录的插件不会参与分组，它们的 skill 仍然平铺列出。
- npx skills CLI 会把清单里声明的 skills 目录追加为搜索目录；这里不追加，skill 只在仓库的常规布局（优先级前缀 / ≤6 段兜底）里发现，清单声明只用于分组。
- npx skills CLI 会把 frontmatter 解析失败、或缺少 `name` / `description` 的 `SKILL.md` 跳过；这里不做严格 YAML 校验，只按 frontmatter 取名称与描述并在缺失时回退目录名，所以这类文件仍会出现在列表里。
- Claude Code marketplace 只列 skills（插件的 `SKILL.md`），不列 commands / agents；`source` 指向仓库外（github / url / git-subdir / npm 等）的插件不会展开。
- marketplace 只认仓库根目录的 `.claude-plugin/marketplace.json`：放在别处、或通过 `extraKnownMarketplaces` 的 `path` 指到子目录的市场不会被识别。
- 判定结果也按 30 分钟 TTL 缓存：仓库刚变成可用/不可用时，点顶部「刷新」可以立刻重新判定。
- 卡片上的「预计 skill 数」来自探测，探测只读仓库树，不知道 frontmatter 里 `metadata.internal` 的内部 skill，所以可能比展开后的列表多；展开时以实际列表为准。
- 仓库树按 30 分钟 TTL 缓存，仓库里的 skill 刚更新时可能还是旧列表；点顶部「刷新」可以强制重拉已展开的仓库。重开 DSH 后看到的是上次缓存在浏览器里的列表，后台校正完成前可能短暂显示旧内容。
