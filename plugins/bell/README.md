# @buka/dsh-plugin-bell

任务结束、DSH 停下来等你操作、计划被退回修改、或你手动终止任务时，播放一声提示音。**设置 → 提示音** 里点一行就进入该时机的独立声音列表，点一项即选中并试听，听完点「返回」回到四行总览；候选是 macOS 系统自带音与插件自带的「你干嘛~哎哟」梗语音，每个时机都可以设成「无」表示不播放。

装好以后你就不必盯着屏幕等模型跑完：Agent 一轮任务真正结束会响**完成音**，DSH 弹出问题或审批等待你回复时会响**等待音**。计划被退回修改默认静音——这个时机人通常就在屏幕前，想要提示的人可以单独打开；手动终止默认播放插件自带的「你干嘛~哎哟」。

## 什么时候响

| 提示音 | 触发时机 | 依据 |
| --- | --- | --- |
| 完成音 | 顶层 Agent 从 `running` 变回 `idle`，即这一轮任务真正结束（成功、报错都算） | Host 事件 `agent/status` + `ctx.agents.roots()`，完成前先看 `turn/end` 的原因 |
| 等待音 | `ask_user_question` 发起提问、plan review 等待确认、工具调用请求审批 | Host waterfall 事件 `user-questions/request`、`approval/request` |
| 计划被退回音 | plan review 卡片里点「要求修改」把计划退回给模型 | 旁听 `user-questions/request` 的拒绝结果 + `turn/end` 原因 |
| 手动终止音 | 你点 GUI 的终止按钮（或按停止快捷键）结束当前任务 | `turn/end` 的 `reason.kind === 'aborted'` 且取消来源是 `user` |

**手动终止不响完成音**：点终止按钮会走 `session/cancel` → `agent.cancel({ kind: 'user' })`，这一轮以 `turn/end` 的 `reason.kind === 'aborted'` 收尾，随后才发 `agent/status` idle。插件旁听会话日志里的 `turn/end` 记住最近一轮的结束原因：`aborted` 且取消来源是 `user` 时改播手动终止音（默认「你干嘛~哎哟」）；会话归档、父级取消、插件卸载同样以 aborted 收尾，但它们不是手动停止，保持静音。记「最近一轮」而不是布尔标记，是因为终止后队列里若还有消息，DSH 会接着跑下一轮，真正跑完时仍然按那一轮的原因响。

**计划被退回不算任务完成**：plan review 卡片上的「要求修改」不会回答批准/拒绝选项，而是由 Web UI 以 `ASK_CANCELLED` 取消这次提问。`dsh-plan-mode` 收到取消后调用 `concludeTurn()`，这一轮随即以 `turn/end` `completed` 收尾，因此看起来和任务完成一模一样。插件在旁听 `user-questions/request` 时接住 `next()` 的拒绝结果：看到 `ASK_CANCELLED` 且请求带 `plan-review` 意图，就记下这个会话；等 idle 时改播计划被退回音（默认「无」），而不是完成音。如果退回后用户紧接着发消息、DSH 在同一驱动里直接开下一轮（中间没有 idle），标记会在 `turn/start` 时清掉，避免把下一轮真正的完成错当成计划退回。

四个信号都来自 DSH 自己的生命周期，插件不轮询、不改会话日志、不截胡 waterfall 事件（只旁听后继续 `next()`）。

等待音的监听器用 `prepend: true` 注册：Web UI 的回答器由 `api-remotes` 更早注册，它会把请求转发给浏览器并等用户作答、期间不调用 `next()`；普通顺序的监听器会被它挡在后面收不到事件。排在前面响铃、再 `next()` 交回决定，才能既响铃又不影响 UI。计划被退回的音也是靠这个排在前面的监听器旁听 `next()` 的结果。

子 Agent（subagent、workflow 子运行）结束时不会响：它们也发 `agent/status`，但不在 `ctx.agents.roots()` 里，插件按运行时归属过滤掉了。

## 设置页

**设置 → 提示音** 分两级页面。

第一级是四行，对应四个时机（任务结束 / 等待输入 / 计划被退回修改 / 手动终止），行上显示当前声音：

```text
任务结束              Basso      ›
等待输入              Submarine  ›
计划被退回修改          无         ›
手动终止               你干嘛~哎哟  ›
```

点一行就**整页进入该时机的独立声音列表页**（这一级替换掉四行，不是弹窗、也不是行内展开）。列表是该时机的完整候选：

```text
← 返回
任务结束
单选：选中哪个就试听哪个；点「返回」回到上一页。
──────────────────────────────
○ 无
○ 你干嘛~哎哟                    ← 插件自带：assets/voice.mp3
◉ Basso
○ Blow
...
○ Glass
```

在列表页里：

1. **单选 = 选中 + 试听**：列表是原生 `radio`，点一项就是选中它，同时立刻通过 `ctx.configForms` 写入 Host 的 volatile 配置字段，并请求 `POST /buka-bell/preview` 让 Host 播一次。没有额外的试听按钮——选哪个听哪个；已经选中的那一项再点一次会重播，方便反复听。点「无」只取消，不播放。
2. **不自动返回**：点完还留在列表里，可以接着点下一项挨个听，满意后点左上角「返回」回到四行页面——「先听，再定」不用来回改配置，也不会被打断。

列表页是整页替换，不用浮层：设置本身已经是浮层，再叠 Modal 或者行内展开都会打乱操作预期（弹窗套弹窗 / 布局跳动）。

试听路由沿用 web 组合的信任栅栏（`connection.requestRejection`），只接受本机、已认证的浏览器请求；Host 侧再用 `isPlayableSound` 校验声音名，不认识的直接返回 400，不把浏览器发来的任意字符串交给播放器。

默认：任务结束 `Basso`，等待输入 `Submarine`，计划被退回 `无`，手动终止 `你干嘛~哎哟`（`ikun`）。

系统声音名对应 macOS 的 `/System/Library/Sounds/<name>.aiff`；Windows / Linux 上没有系统声音表，未选自带音频时回退到平台默认提示音（Windows `SystemSounds`，Linux `paplay` / `canberra-gtk-play` / `aplay`）。找不到播放器时只在日志里警告一次，不影响任务执行。

「你干嘛~哎哟」不走系统声音表，直接播放包里的 mp3（`import.meta.url` 定位，随包发布）：macOS 用 `afplay`；Windows / Linux 依次试 `ffplay`、`mpv`（Linux 先试 `paplay`），都没装时这个选项静音，同一时机换回系统声音即可。

## 平台

| 平台 | 完成音 | 等待音 | 计划被退回音 | 手动终止音 |
| --- | --- | --- | --- | --- |
| macOS | 设置页选中的声音（默认 `Basso`） | 设置页选中的声音（默认 `Submarine`） | 设置页选中的声音（默认「无」） | 设置页选中的声音（默认「你干嘛~哎哟」） |
| Windows | `SystemSounds.Exclamation` | `SystemSounds.Asterisk` | `SystemSounds.Question` | 设置页选中的声音（默认「你干嘛~哎哟」，文件播放器） |
| Linux | `complete.oga`（`paplay`，退路 `canberra-gtk-play` / `aplay`） | `message.oga`（同上） | `dialog-information.oga`（同上） | 设置页选中的声音（默认「你干嘛~哎哟」，文件播放器） |

Windows / Linux 的完成 / 等待 / 计划三列是**没选**「你干嘛~哎哟」时的平台默认声音；选中梗语音时（手动终止的默认就是它）改由上面说的文件播放器播放，与系统声音表无关，播放器都没装时静音。

## 素材版权

`assets/voice.mp3` 是网络公开的二创梗语音片段（含公众人物声音），版权归原作者所有，**仅供个人学习交流使用**，请勿用于商业用途。仓库里代码的 MIT 许可（见根目录）**不覆盖**这个文件；要商用请自行替换成无版权素材（换文件即可，路径写在 `lib/sounds.js` 的 `CUSTOM_SOUNDS` 里；不用就把这个候选从 `CUSTOM_SOUNDS` 与 `client.js` 的 `CUSTOM_SOUNDS` 里一起删掉）。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包身份、`engines.dsh` 兼容范围、`dsh.bundle.patch` 声明它是 bundle、`dsh.client` 声明浏览器一半、`locale` / `icon` 导出让 Plugins 页展示 |
| `cordis.patch.yml` | bundle 层唯一的一行：把自己作为 `sound-buka-bell` 插入组成 |
| `lib/index.js` | Host 一半：导出 `name` / `inject` / `Config` / `apply`，监听生命周期事件、读 volatile 声音配置、调用播放器，并注册试听路由 `POST /buka-bell/preview` |
| `lib/sounds.js` | 零依赖的候选表与播放命令：macOS 系统声音清单、自带音频、四个默认值、各平台播放器、试听路由路径、`isPlayableSound` 校验；单测直接导入它 |
| `client.js` | 浏览器一半：在 设置 → 提示音 注册两级页面——四行总览，点一行进入该时机的独立声音列表；点一项同时写配置（`ctx.configForms`）并请求 Host 试听路由，点「返回」才回到总览 |
| `assets/voice.mp3` | 声音列表里「你干嘛~哎哟」的音频；随包发布，播放时按 `import.meta.url` 定位 |
| `market.json` | 只在市场上挂牌用的展示信息，不随包发布 |
| `icon.svg` | Discover 页与 Plugins 详情页图标，构建时复制到 `dist/icons/` |
| `locale/*.json` | Plugins 页读的 `meta.title` / `meta.description`，不需要激活插件 |

Host 一半依赖 `@deepseek-ai/schemastery` 来声明 Config（只有 `.volatile()` 字段能被设置页热更新）。市场安装时会由 pnpm 自动安装；本地 `link:` 安装调试时，如果缺少该依赖，可以在插件目录单独装一次：

```bash
cd plugins/bell && pnpm install --ignore-workspace
```

## 验证安装

在 DSH 里：**Plugins → More（Experimental plugins）→ Custom plugin markets → Discover** 添加本仓库的索引地址，安装后在 **设置 → 提示音** 看到四行提示音、点一行进入独立声音列表即成功。

本地调试也可以直接装目录：`dsh plugin --profile <profile> add "link:$PWD/plugins/bell"`。
