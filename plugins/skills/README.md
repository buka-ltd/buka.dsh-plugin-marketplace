# @buka/dsh-plugin-skills

在**侧边栏**新增一个「Skills」页面，顶部两个 Tab：

- **已安装**：列出本机**全局安装**的 skills（对所有会话生效），自动识别哪些由 [`skills`](https://github.com/vercel-labs/skills)（原 `npx skills`）安装和管理；可以检查更新、应用更新，并按来源决定卸载方式；
- **收藏**：记下常用的 skills 来源（`owner/repo`、GitHub/GitLab 等链接、任意 git 地址、本地绝对路径、npm 包名），属于用户自己的书签；可列出的来源会自动判定为「标准 npx 仓库」或「不可用」，并展开成一棵带缓存的 skills 树；树里每个 skill 可以安装到全局、某个打工人或某个已注册工作区。

页面之外，插件把收藏、仓库内容与按目录检查 / 更新的能力开放成 Host Service `ctx.bukaSkills`，见下方[对外服务](#对外服务host-service)。

## 运行时依赖

插件把 `skills` 固定到确切版本写在 `dependencies` 里（不使用 `^` / `~`），安装到 profile 时由 DSH 一并安装：

- 安装与卸载用库 API：`installSkills` / `removeSkills`；
- 检查与更新用同一个包自带的 CLI（`node <skills>/bin/cli.mjs check|update`），调用时设置 `DISABLE_TELEMETRY=1`、`NO_COLOR=1`；
- 仓库发现与「已安装」列表仍由插件自己扫描：`skills` 的 `resolveSource` / `listSkills` 只认它自己的 agent 目录与默认发现规则，无法满足「只认仓库根 `skills/`」、`DSH_AGENTS_HOME` / `DSH_HOME` 两个全局根、持久克隆缓存与刷新失败保留旧克隆这些约束；发现规则与库、CLI 对齐，安装 / 卸载仍复用库的 lock 语义；
- 运行时不再 spawn `npx`，也不再出现「找不到 npx」一类提示。

`scripts/build-clients.ts` 把 `skills` 保持为外部依赖，不打包进 `lib/index.js`。

## 列出什么

DSH 的 skill 提供方（`@deepseek-ai/dsh-skill-filesystem`）会扫描几个根目录，其中两个是全局的：

| 来源          | 根目录                                            | 典型写入方          |
| ------------- | ------------------------------------------------- | ------------------- |
| `user-agents` | `~/.agents/skills`（可用 `DSH_AGENTS_HOME` 覆盖） | skills 库、手工安装 |
| `user-dsh`    | `~/.dsh/skills`（可用 `DSH_HOME` 覆盖）           | 手工安装            |

页面对这两个目录做与 DSH 相同的一层扫描：`<name>/SKILL.md` 目录或平铺的 `<name>.md`。工作区里的 `项目/.agents/skills` 只对那个项目生效，不在「已安装」里列出。

每个 skill 显示名称、描述、来源根与安装来源标签。描述优先取 DSH skills 注册表解析出的 frontmatter；注册表拿不到时回退到直接读 `SKILL.md` 的 `description`。

## 已安装：检查与更新

`skills` 的全局 lockfile 记录安装来源：默认 `~/.agents/.skill-lock.json`，设置了 `XDG_STATE_HOME` 时是 `$XDG_STATE_HOME/skills/.skill-lock.json`（版本 3）。判定一个 skill 由库管理需要两条同时成立：位于 `~/.agents/skills` 下，**且**名字出现在 lockfile 里。`~/.dsh/skills` 下的 skill 永远按手工安装处理。

「检查更新」按 skill 返回五种状态：

| 状态                 | 含义                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `update`             | 上游有更新                                                                   |
| `modified`           | 本地文件与项目 `skills-lock.json` 的内容哈希不一致（目标目录的项目级 skill） |
| `up-to-date`         | 已是最新                                                                     |
| `unsupported-source` | 来源里已经没有可再解析的 skill（典型是旧 Claude Code marketplace 安装）      |
| `failed`             | 检查失败，带原因                                                             |

「更新」只应用 `update`：`modified` 默认跳过并在结果里说明，不覆盖本地修改；`unsupported-source` 与 `failed` 同样跳过。每个失败项带命令输出；没有可更新项时明确返回「已是最新」。手工安装的条目不在候选里，不参与检查 / 更新。

项目级 skill 的本地修改判定由 `src/skill-hash.ts` 按 `skills` 包 README 的内容哈希规则计算，与 CLI 的 `computedHash` 一致。

全局检查 / 更新固定操作 `~/.agents`：`DSH_AGENTS_HOME` 指到别处时拒绝执行，避免更新到 DSH 扫描不到的位置。

## 卸载方式

| skill 来源       | 卸载动作                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| 由 skills 库管理 | `removeSkills([name], { scope: 'global' })`：同时删除规范副本、各 agent 目录里的链接/副本与 lockfile 记录 |
| 手工安装         | 直接删除扫描到的目录（或平铺的 `.md` 文件）                                                               |

两种方式都会在执行后确认目标真的消失。lockfile 存在却解析不了时，`~/.agents` 下的 skill 拒绝卸载（无法判断归属），`~/.dsh` 下的仍可本地删除。

## 收藏

第二个 Tab 是用户自己的书签，和已安装列表互不影响：

- 点标题行右侧的「收藏」按钮弹出对话框，填仓库与备注后提交；仓库支持 `owner/repo`、GitHub/GitLab 等网页链接、任意 git 地址（`https://`、`ssh://`、`git://`、`git@host:path`）、本地绝对路径（含 `file://`），以及安装库支持的包名（如 `notion`、`@scope/pkg`）；
- 来源在写入前规范化：`https://github.com/foo/bar.git`、`www.github.com/foo/bar` 都会收敛成 `foo/bar`，本地路径做 `path.normalize` 并去掉尾部斜杠；再用小写值去重；
- 数据存在 `<DSH_HOME 或 ~/.dsh>/buka-skills/repos.json`，原子写入、权限 `0600`；文件损坏时只读不写并提示用户先修复。

### 发现规则与仓库树

收藏只支持一种格式：仓库根 `skills/` 下（允许任意层级子目录）的 `SKILL.md`。

- 根 `SKILL.md`、`.claude/skills/**`、`.codex/skills/**` 等任何 agent 目录里的 `SKILL.md` 都不算可安装来源；
- Claude Code marketplace 的清单、插件分组、徽标与相关文案已全部删除；
- `metadata.internal: true` 的内部 skill 不列；
- 一个 `SKILL.md` 都没有的仓库标记为「不可用」。

所有可列出的来源都读到本地浅克隆缓存：

- **GitHub `owner/repo`**：转成 `https://github.com/owner/repo.git` 浅克隆；不再调用 GitHub API，也不需要 token；
- **任意 git 地址**：`git clone --depth 1 --single-branch --no-tags` 到 `<DSH_HOME 或 ~/.dsh>/buka-skills/cache/git/<url 的 sha256 前 32 位>/`；
- **本地绝对路径**：直接扫描目录（跳过 `node_modules`、`.git`、`dist`、`build` 等，有深度 / 条数 / 单文件大小上限）。

展开仓库时读每个 `SKILL.md` 的 frontmatter 并建树：目录节点保留仓库里的物理目录结构，skill 节点保留完整仓库路径。名称取 frontmatter `name`，缺失时回退目录名。

判定与树都会缓存到 `<DSH_HOME 或 ~/.dsh>/buka-skills/cache/repo-skills.json`（version 6），TTL 30 分钟；探测只写轻量结论（不写整棵树），展开时补全；缓存写入串行化，探测不会覆盖完整树。页面「刷新」绕过缓存重新判定 / 重拉已展开仓库。刷新本地克隆失败时保留旧克隆继续展示，并在结果 `warning` 里报告原因。

## 一键安装

展开一个可用的收藏后，每个 skill / 目录右侧固定三个入口：

| 入口         | 行为                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| 全局安装     | 装到 `~/.agents/skills`；两个全局根里已有同名 skill 时变成禁用的「全局已安装」                |
| 安装到打工人 | 选择框列出智能体（`ctx.bukaWorkers`），装进 `<打工人目录>/.agents/skills` 与 `.claude/skills` |
| 安装到工作区 | 选择框列出已注册工作区（`ctx.workspaceRegistry`），装进 `<工作区路径>/.agents/skills`         |

Host 侧的约束：

- 只允许安装**收藏过**的来源；浏览器只传来源与 skill 在仓库里的路径，名字与是否存在以 Host 读到的仓库列表为准；
- 安装把**原始来源**交给 `installSkills`，lock 里保持上游身份（GitHub 简写 / git URL / 本地路径），不是本插件的克隆缓存路径；
- 打工人只传标识符、工作区只传路径，Host 安装时按 `ctx.bukaWorkers` / `ctx.workspaceRegistry` 重新解析成可信目录；
- 安装目标库为 `scope: 'global'` + `agents: ['universal']`，项目级为 `scope: 'project'` + `cwd` + `agents`（打工人额外 `claude-code`）；
- 所有安装 / 卸载 / 检查 / 更新共用一条串行队列，避免并发写 `skills-lock.json`；
- 库报告成功但目标目录没有 `SKILL.md` 时按失败上报。

## 打工人页面

workers 插件通过 `ctx.bukaSkills` 提供更新入口（目录由调用方解析后传入）：

- 单个打工人的 Skills 页签有「更新」按钮；
- 列表页工具栏有「更新全部打工人」：只对智能体、目录存在且有 skill 的 worker 顺序执行，机器人 / 空 skill 的 worker 跳过；单个失败不中断，最后汇总每个 worker 的结果。

## 页面与路由

侧边栏出现一个「Skills」图标。视觉与控件复用 DSH 的基座模块，布局照 Plugins 页面。页面只做展示与触发，数据都走 Host 路由：

`GET /buka-skills/list`、`POST /buka-skills/uninstall`、`GET /buka-skills/check`、`POST /buka-skills/update`、`GET /buka-skills/targets`、`POST /buka-skills/install`、`GET|POST /buka-skills/repos`、`POST /buka-skills/repos/remove`、`GET /buka-skills/repo-skills?source=…[&refresh=1][&probe=1]`。

展开状态与上次拿到的树缓存在浏览器 localStorage（`dsh.buka-skills.view.v1`）。

## 模型工具

`buka_skills`（只读）：返回全局 skills 的 `name` / `description` / `scope` / `managedByNpx` / `source`。安装、卸载、更新仍是用户在页面上的操作。

## 对外服务（Host Service）

插件在 Host 一侧注册 `ctx.bukaSkills`（`SERVICE_NAME = 'bukaSkills'`）。消费方声明依赖，不要 import 本包实现：

```js
export const inject = ['bukaSkills']

export function apply(ctx) {
  ctx.effect(() => ctx.bukaSkills.listRepositories(), 'my-plugin: saved repos')
}
```

### 方法

| 方法                               | 返回                                                                         | 说明                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `listRepositories({ refresh? })`   | `{ file, exists, corrupt, repositories }`                                    | 收藏的仓库；每条带 `kind`（`npx-skills` / `unavailable` / `unknown`）、预计 `skills` 数与探测失败原因 |
| `listSkills({ source, refresh? })` | `{ ok: true, source, kind, ref, sha, fetchedAt, cached, truncated, skills }` | 仓库里所有可安装 skill 的扁平列表；每条 `{ name, description, path }`                                 |
| `checkSkills({ dir? })`            | `{ ok: true, scope, results[, message] }`                                    | 检查全局（省略 `dir`）或某个目标目录；每条 `{ name, source, status, message? }`                       |
| `updateSkills({ dir? })`           | `{ ok: true, scope, updated, skipped, failed, message }`                     | 只应用 `update`；`modified` 跳过并说明；失败项带 `message` / `output`                                 |

本地路径来源的 `ref` 是 `worktree`、`sha` 为空串；远端来源的 `ref` 是 `HEAD`、`sha` 取克隆当前的提交号。失败统一返回 `{ ok: false, code, message }`：`invalid-source`、`unsupported-source`、`repo-not-found`、`rate-limited`、`fetch-failed`、`repo-unavailable`、`git-unavailable`、`git-failed`，检查 / 更新另加 `check-failed`、`lock-unreadable`、`unsupported-home`。

### 语义

- 收藏的增删与 skill 的安装 / 卸载 / 更新都是页面上的用户操作；服务只读收藏与仓库，另开放检查 / 更新；
- 仓库读取复用 `src/repo-skills.ts` 的 TTL 缓存（30 分钟），`refresh: true` 绕过；同一来源的并发调用合并成一次；
- 收藏文件损坏时 `listRepositories()` 如实返回 `corrupt: true` 与空列表，不猜测、不写回。

## 结构

| 文件                                           | 作用                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                                 | Host 入口：装配路由、工具与 `ctx.bukaSkills`；安装 / 卸载 / 检查 / 更新共用一条串行队列                |
| `src/service.ts`                               | 对外服务：`listRepositories()` / `listSkills()` / `checkSkills()` / `updateSkills()`                   |
| `src/skill-install.ts`                         | 安装流程：收藏来源校验、目标解析、`installSkills` 调用与结果核对                                       |
| `src/skill-update.ts`                          | 检查 / 更新：状态合成、`skills check` / `skills update` CLI 调用、跳过`modified` 与旧 marketplace 来源 |
| `src/skill-hash.ts`                            | 与 CLI 一致的 skill 目录内容哈希（项目级 `modified` 判定）                                             |
| `src/skill-store.ts`                           | 全局扫描、lockfile、卸载决策（库 API 或本地删除）                                                      |
| `src/npx-lock.ts`                              | `skills` 全局 lockfile 的位置与记录解析                                                                |
| `src/repo-store.ts`                            | 收藏来源规范化 / 分类 / 去重 / 原子读写                                                                |
| `src/repo-skills.ts`、`src/repo/**`            | 仓库发现与缓存：只认根 `skills/`，远端浅克隆，本地扫描，请求合并与 TTL 缓存                            |
| `src/git-source.ts`                            | git 克隆缓存与刷新；刷新失败保留旧克隆并返回 warning                                                   |
| `src/local-source.ts`                          | 本地目录读取抽象：递归遍历与限定在根目录内的文件读取                                                   |
| `src/install-targets.ts`                       | 打工人 / 工作区目标解析                                                                                |
| `src/routes.ts`、`src/tools.ts`、`src/http.ts` | 包内路由、只读工具与请求 / 响应辅助                                                                    |
| `src/client/**`                                | 两个 Tab（已安装 / 收藏）、页面状态、请求、词典与样式                                                  |
| `lib/index.js`、`lib/client.js`                | 构建产物：Host / 浏览器一半的运行文件；不手改                                                          |

## 已知限制

- 「已安装」页只列出全局根目录；项目级 skills 不在这里列出，由打工人 / 工作区自己负责。
- 检查 / 更新复用 `skills` CLI 的文本输出（`↑ … has an update` / `✎ … has local changes`），状态解析依赖固定版本 `1.9.0`；升级 `skills` 时要同步核对 `parseCheckOutput()`。
- 全局检查 / 更新固定写 `~/.agents`；`DSH_AGENTS_HOME` 指到别处时拒绝执行。
- 本地修改只在项目级（带 `skills-lock.json` 内容哈希）时能识别；全局 lock 不记内容哈希。
- 旧 Claude Code marketplace 来源安装的 skill 仍列出并参与检查，但状态为 `unsupported-source`，不会被自动更新。
- 克隆缓存放在 `<DSH_HOME 或 ~/.dsh>/buka-skills/cache/git/`，不会自动清理；删除收藏只删记录。
- 本地路径直接扫描目录：巨型目录超过遍历上限时树会被截断。
- 非 GitHub 的普通网页链接会被当作 git 仓库尝试 clone，展开时报错；GitHub 子页面等已知不是仓库根的链接只能收藏。
- 同一仓库里出现同名 skill 时按名字安装，由 `skills` 自己的发现顺序决定装哪一个。
