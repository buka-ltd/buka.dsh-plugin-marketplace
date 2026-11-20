# @buka/dsh-plugin-skill-update-check

在当前工作区检查项目技能是否有上游更新：有更新时，在新建会话输入框的**左下角**显示一个 warn 色提示。只提示，不自动更新。

检查走 `skills` 包自带的 CLI（与 `npx skills` 同一套实现），读取工作区根目录的 `skills-lock.json`，执行 `check -p`。插件本身声明了 `skills` 依赖，装插件时会一起装好，不需要另外安装 Skills 插件。

## 安装后看到什么

- 新建会话时，输入框工具栏左下角出现 `N 个技能可更新`（英文界面是 `N skill updates`），颜色是 DSH 主题里的 `--dsw-alias-state-warn-primary`。
- 鼠标悬停显示前几个 skill 名与「点击重新检查」。
- 点击提示会跳过 5 分钟缓存，重新跑一次检查；没有更新、没有项目技能、或正在首次检查时不占位置。
- 检查失败时提示缩成一个 `!`（error 色），tooltip 给出原因；修好后点击重试。

## 检查方式

1. 浏览器只把当前会话 id 发给 Host。
2. Host 用 `sessions` 与 `workspaceRegistry` 解析当前工作区目录：优先取 `sessionIds` 包含该会话的工作区，取不到时退回会话 header 的 `cwd`，并在已注册工作区里找包含它的最长路径。
3. 读 `<工作区>/skills-lock.json`。没有这个文件，说明工作区没有由 `npx skills` 管理的项目技能，直接结束，不跑 CLI。
4. 用插件依赖里的 `skills` CLI 执行 `check -p -y`，退出码 0 / 1 都算正常结论：1 表示有更新或本地修改。
5. 只把 `↑ <name> has an update` 计入「有更新」；本地修改（`✎ … has local changes`）不算更新，不会让提示出现。

同一个工作区在 5 分钟内只跑一次 CLI；多个会话同时挂载时共用进行中的请求。检查是只读的，不会改 lockfile、不会安装或更新任何 skill。

## 怎么更新

插件不替你做更新。确认后可以：

```bash
# 在当前工作区
npx skills update -p

# 或只更新某一个
npx skills update <skill-name> -p
```

也可以继续用 [Skills 插件](../skills/README.md) 的页面逐项更新。更新完成后，点击输入框左下角的提示重新检查，提示就会消失。

## 限制

- 只检查**项目级**技能（工作区根目录的 `skills-lock.json`）。全局技能（`~/.agents/skills`）不在这里提示，那是 Skills 插件的页面负责的范围。
- 工作区没有 `skills-lock.json` 时没有可检查的对象；手工安装、没有记录在 lock 里的技能也不参与。
- 不轮询：进入会话、切换会话时检查一次，之后靠点击提示刷新。
- 首次检查要访问来源仓库，可能需要几秒到几十秒；检查期间提示不占位置。
- 提示位于 `conversation.input.left`（输入框工具栏左侧）。没有会话时不渲染；新建会话的空白会话有 id，会正常显示。

## 要求

- DSH `>= 0.2.2-rc.1`。
- 插件随包安装 `skills@1.9.0`；不需要已安装 `@buka/dsh-plugin-skills`。
- Host 需要 `sessions` 服务；`workspaceRegistry` 是可选服务，没有时退回会话的 `cwd`。

## 安全

Host 只注册一条本机路由（`GET /buka-skill-update-check/status`），并沿用 DSH web 组合的信任栅栏（`connection.requestRejection`）：非本机或未认证的请求会被拒绝。浏览器只能传会话 id 与 `refresh=1`，不能传路径——检查目录完全由 Host 从会话与工作区注册表解析。

更完整的说明见 [`docs/DETAIL.zh.md`](docs/DETAIL.zh.md)（English: [`docs/DETAIL.md`](docs/DETAIL.md)）。
