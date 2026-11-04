# @buka/dsh-plugin-bell

任务结束、或 DSH 停下来等你操作时，播放一声系统提示音。两个声音都在 **设置 → 提示音** 里选，选中即试听。

装好以后你就不必盯着屏幕等模型跑完：Agent 一轮任务真正结束会响**完成音**，DSH 弹出问题或审批等待你回复时会响**等待音**。

## 什么时候响

| 提示音 | 触发时机 | 依据 |
| --- | --- | --- |
| 完成音 | 顶层 Agent 从 `running` 变回 `idle`，即这一轮任务真正结束（成功、报错都算） | Host 事件 `agent/status` + `ctx.agents.roots()` |
| 等待音 | `ask_user_question` 发起提问、plan review 等待确认、工具调用请求审批 | Host waterfall 事件 `user-questions/request`、`approval/request` |

**手动终止不响完成音**：点 GUI 的终止按钮（或按停止快捷键）会走 `session/cancel` → `agent.cancel({ kind: 'user' })`，这一轮以 `turn/end` 的 `reason.kind === 'aborted'` 收尾，随后才发 `agent/status` idle。插件旁听会话日志里的 `turn/end` 记住最近一轮的结束原因，`aborted`（手动终止、会话归档、Agent 卸载）就跳过完成音；记「最近一轮」而不是布尔标记，是因为终止后队列里若还有消息，DSH 会接着跑下一轮，真正跑完时仍然要响。

两个信号都来自 DSH 自己的生命周期，插件不轮询、不改会话日志、不截胡 waterfall 事件（只旁听后继续 `next()`）。

等待音的两个监听器用 `prepend: true` 注册：Web UI 的回答器由 `api-remotes` 更早注册，它会把请求转发给浏览器并等用户作答、期间不调用 `next()`；普通顺序的监听器会被它挡在后面收不到事件。排在前面响铃、再 `next()` 交回决定，才能既响铃又不影响 UI。

子 Agent（subagent、workflow 子运行）结束时不会响：它们也发 `agent/status`，但不在 `ctx.agents.roots()` 里，插件按运行时归属过滤掉了。

## 设置页

**设置 → 提示音** 里有两个下拉框（任务结束 / 等待输入），选项是 macOS 系统自带提示音：

```text
Basso  Blow  Bottle  Frog  Funk  Glass  Hero  Morse
Ping   Pop   Purr    Sosumi  Submarine  Tink
```

选中某个声音后：

1. 浏览器一半通过 `ctx.configForms` 把选择写回 Host（插件 Config 的 volatile 字段）；
2. Loader 不重载插件，只更新配置引用并派发 `loader/volatile-update`；
3. Host 一半在这个事件里播放新选中的声音 —— 这就是试听。

默认：任务结束 `Glass`，等待输入 `Ping`。

这些名字是 macOS 的 `/System/Library/Sounds/<name>.aiff`；Windows / Linux 上会回退到平台默认提示音（Windows `SystemSounds`，Linux `paplay` / `canberra-gtk-play` / `aplay`）。找不到播放器时只在日志里警告一次，不影响任务执行。

## 平台

| 平台 | 完成音 | 等待音 |
| --- | --- | --- |
| macOS | 设置页选中的系统声音（默认 `Glass`） | 设置页选中的系统声音（默认 `Ping`） |
| Windows | `SystemSounds.Exclamation` | `SystemSounds.Asterisk` |
| Linux | `complete.oga`（`paplay`，退路 `canberra-gtk-play` / `aplay`） | `message.oga`（同上） |

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch` 声明它是 bundle、`dsh.client` 声明浏览器一半、`locale` / `icon` 导出让 Plugins 页展示 |
| `cordis.patch.yml` | bundle 层唯一的一行：把自己作为 `sound-buka-bell` 插入组成 |
| `lib/index.js` | Host 一半：导出 `name` / `inject` / `Config` / `apply`，监听生命周期事件、读写 volatile 声音配置并调用系统播放器 |
| `client.js` | 浏览器一半：在 设置 → 提示音 注册页面，两个下拉框通过 `ctx.configForms` 读写 Host 配置 |
| `market.json` | 只在市场上挂牌用的展示信息，不随包发布 |
| `icon.svg` | Discover 页与 Plugins 详情页图标，构建时复制到 `dist/icons/` |
| `locale/*.json` | Plugins 页读的 `meta.title` / `meta.description`，不需要激活插件 |

Host 一半依赖 `@deepseek-ai/schemastery` 来声明 Config（只有 `.volatile()` 字段能被设置页热更新）。市场安装时会由 pnpm 自动安装；本地 `link:` 安装调试时，如果缺少该依赖，可以在插件目录单独装一次：

```bash
cd plugins/bell && pnpm install --ignore-workspace
```

## 验证安装

在 DSH 里：**Plugins → More（Experimental plugins）→ Custom plugin markets → Discover** 添加本仓库的索引地址，安装后在 **设置 → 提示音** 看到两个下拉框即成功。

本地调试也可以直接装目录：`dsh plugin --profile <profile> add "link:$PWD/plugins/bell"`。
