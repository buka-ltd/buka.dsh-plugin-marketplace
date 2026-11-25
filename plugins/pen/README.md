# @buka/dsh-plugin-pen

把原本常驻的 pen（pencil）MCP 配置，变成一条会话自己的开关：新会话框右上角的「Pen」勾选框（文字前是 Pen 的 logo），以及会话进行中的 `/pen`、`/pen off` 命令。

开启后，这条会话才注入 Pen（pen.dev）的 MCP 工具（`mcp__pencil__*`）；没开启的会话既看不到这些工具，也不会为它启动 Pen 进程。开关状态按会话隔离，不会影响其它会话。会话开始后，标题右侧会显示一个「Pen MCP」标记（前面是一个描边图标），提示这条会话已经开启 Pen。

## 安装后第一步

删掉 profile 里原来的 pen MCP 条目，否则全局仍会常驻一份：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: mcp-pencil
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: pencil
        transport: stdio
        command: /Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64
        args: ["--app", "desktop"]
```

重启 DSH 后新建会话，在右上角勾选「Pen」，发消息即可。

## 行为

- 勾选发生在空会话阶段，Agent 还没创建。Host 记住会话 id，等 `agent/created` 再挂载 `@deepseek-ai/dsh-mcp-client`；该事件是串行的，所以勾选后的**第一轮消息**就能看到 Pen 工具（首轮会等连接，默认最多 20 秒）。
- 会话进行中（已发过消息也可以）随时发 `/pen` 开启、`/pen off` 关闭；命令不进入模型对话，结果以命令卡片回到会话。工具列表在每轮请求前组装，所以会话中开启的 Pen 从**下一轮**消息开始可见。
- 会话开始后，标题右侧显示「Pen MCP」标记（描边图标 + 品牌名），只表示这条会话开启了 Pen；它不提供悬浮说明，关闭请用 `/pen off`。标记会随命令结果刷新。
- 工具只在**该会话的 Agent 作用域**注册，其它会话与子 Agent 都看不到。
- 取消勾选、`/pen off` 或 Agent 销毁时断开连接、注销工具。
- 连接失败不会阻止会话开始：错误写日志，tooltip / 命令卡片显示原因，这条会话只是没有 Pen 工具。

## 配置

| 字段                | 默认值                                            | 含义                                  |
| ------------------- | ------------------------------------------------- | ------------------------------------- |
| `serverName`        | `pencil`                                          | 工具名前缀 `mcp__<serverName>__`      |
| `command`           | macOS 上 Pen.app 自带的 `mcp-server-darwin-arm64` | stdio 可执行文件                      |
| `args`              | `["--app", "desktop"]`                            | 启动参数                              |
| `env`               | `{}`                                              | 额外环境变量                          |
| `cwd`               | `""`（继承 Host）                                 | 子进程工作目录                        |
| `toolCallTimeoutMs` | `60000`                                           | 单次工具调用超时（毫秒）              |
| `startupTimeoutMs`  | `20000`                                           | 首次连接 + 拉取工具列表的预算（毫秒） |

## 限制

- 开关状态在 Host 进程内存里，DSH 重启后丢失；已经开始的会话不再显示新会话勾选框，因此恢复的会话不会自动挂载 Pen（标题旁的标记也不会出现）——在会话里发一次 `/pen` 即可重新打开。
- 一个开启的会话对应一个 Pen 子进程；多个会话会并行启动多个进程。
- 勾选框只在空会话的新会话行出现（与官方 worktree 勾选框同一位置）；会话开始后由标题右侧的「Pen MCP」标记表示这条会话开启了 Pen。
- 宿主没有组合 `commands` 服务时 `/pen` 命令不可用，勾选框不受影响。

更完整的说明见 [`docs/DETAIL.zh.md`](docs/DETAIL.zh.md)（English: [`docs/DETAIL.md`](docs/DETAIL.md)）。
