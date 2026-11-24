# Pen 设计工具

把原本常驻的 pen（pencil）MCP 配置，变成一个只在新会话里出现的勾选框；会话开始后，标题右侧再用一个「Pen MCP」标记告诉你这条会话开着 Pen。

DSH 里挂 MCP 的常规做法是在 profile 的 `cordis.patch.yml` 里写一条
`@deepseek-ai/dsh-mcp-client`；它随 DSH 启动，所有会话都能看到
`mcp__pencil__*`，也一直占着一个 Pen 进程。这个插件把控制权挪到**会话**：
新建会话时勾上「Pen」（勾选框文字前是 Pen 的 logo），这条会话才加载 Pen 工具；不勾的会话完全看不到，
也不会为它启动 Pen。会话开始后勾选框不再显示，标题右侧会出现一个描边图标加
「Pen MCP」的普通文字标记，用来确认这条会话开着 Pen。

## 安装

1. 在 Plugins → Discover 里安装 `Pen 设计工具`（包名 `@buka/dsh-plugin-pen`）。
2. 删掉 profile 里原来的 pen MCP 条目，否则全局仍会常驻一份：

   ```yaml
   # ~/.dsh/profiles/<profile>/cordis.patch.yml
   - insert:
       - id: mcp-pencil
         name: "@deepseek-ai/dsh-mcp-client"
         config:
           serverName: pencil
           transport: stdio
           command: /Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64
           args: [ "--app", "desktop" ]
   ```

   删掉后重启 DSH（或让 profile 重新加载）。保留它也能用，只是每个勾选的
   会话会多开一个 Pen 进程，全局那份工具也会一直存在。
3. 新建会话，在右上角（工作区 / 预设控件之后）勾选「Pen」，然后发消息。

## 勾选后发生什么

- 会话开始时，插件的 Host 一半在该**会话的 Agent 作用域**里挂载一个
  `@deepseek-ai/dsh-mcp-client`。它的工具名是 `mcp__pencil__<tool>`，只对
  这条会话可见；其它会话、子 Agent 都不会继承。
- 勾选发生在空会话阶段，此时 Agent 还没创建。插件记住会话 id，等
  `agent/created` 再连接；这个事件会等监听器完成，因此**勾选后的第一轮
  消息就能用上 Pen 工具**（首轮会等连接和工具列表，默认最多 20 秒）。
- 取消勾选会立刻断开连接并注销工具。会话结束（Agent 销毁）时也会自动断开。
- 会话开始后，标题右侧显示「Pen MCP」标记（描边图标 + 品牌名，位于标题与
  官方工具按钮之间）。它只是「这条会话开了 Pen」的一行文字提示，没有悬浮
  说明，也没有取消入口。
- 连接失败（例如 Pen.app 不在默认路径）不会阻止会话开始：错误写进日志，
  这个会话就没有 Pen 工具。tooltip 会显示失败原因。

## 配置

插件设置里可以改这些字段（对应一条 `dsh-mcp-client` 的 stdio 配置）：

| 字段                | 默认值                                            | 含义                                |
| ------------------- | ------------------------------------------------- | ----------------------------------- |
| `serverName`        | `pencil`                                          | 工具名前缀：`mcp__<serverName>__`   |
| `command`           | macOS 上 Pen.app 自带的 `mcp-server-darwin-arm64` | stdio 可执行文件                    |
| `args`              | `["--app", "desktop"]`                            | 传给可执行文件的参数                |
| `env`               | `{}`                                              | 合并到 DSH 清洗过的环境上的额外变量 |
| `cwd`               | `""`（继承 Host）                                 | 子进程工作目录                      |
| `toolCallTimeoutMs` | `60000`                                           | 单次工具调用超时                    |
| `startupTimeoutMs`  | `20000`                                           | 首次连接 + 拉取工具列表的预算       |

`command` 是唯一的平台相关项：Pen 装在别处、或不是 macOS arm64 时，把它
改成对应的可执行文件路径即可。

## 状态与限制

- 勾选状态按 **Host 进程内存**保存：页面刷新、切换会话都还在；DSH 重启后
  会丢。已经发过消息的会话不再显示新会话勾选框，因此重启后恢复的会话不会
  自动挂载 Pen。想继续用 Pen，请在新会话里重新勾选。
- 一个勾选的会话对应一个 Pen MCP 子进程；多个勾选会话会并行启动多个进程。
- 勾选框只出现在新会话（空会话）的右上角，和官方 worktree 勾选框同一位置；
  会话开始后这个位置不再显示，改由标题右侧的「Pen MCP」标记表示这条会话
  开启了 Pen。
- 工具只在会话的 Agent 作用域里注册，不会出现在其它会话的工具列表里。

## 安全

Host 只注册两条本机路由（`/buka-pen/state`、`/buka-pen/toggle`），并沿用
DSH web 组合的信任栅栏（`connection.requestRejection`）：非本机或未认证的
请求会被拒绝。请求体上限 16 KiB，`sessionId` 只用于查 Host 自己的状态表，
不会拼进文件路径或命令。
