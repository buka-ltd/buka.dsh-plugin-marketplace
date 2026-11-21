# SKILL 更新提示

在当前工作区检查项目技能是否有上游更新：有更新时，在新建会话输入框的
**下方**、统计行最右侧（「上下文已用」圆环之后）显示一个 warn 色提示。
只提示，不自动更新。

检查走 `skills` 包自带的 CLI —— 也就是 `npx skills` 背后的同一套实现 ——
读取工作区根目录的 `skills-lock.json`，执行 `check -p`。插件把 `skills`
声明为运行时依赖，安装插件时会一起装好；不需要另外安装 Skills 插件。

## 出现位置

提示注册在插槽 `conversation.composer.dock`：输入框卡片下方的统计行。
统计行的 `activity` / `usage` 两个条目由插槽渲染，「上下文已用」圆环由输入框
自己追加在插槽之后；提示用 flex 的 `order` 排在所有默认项之后，也就是圆环
右侧。圆环不显示时（上下文用量还不可用，或工具栏被活动控件占用），提示仍然
落在统计行最右端。它只在有项目技能更新时出现：

- 中文界面：`3 个技能可更新`
- 英文界面：`3 skill updates`

颜色取 DSH 主题的 `--dsw-alias-state-warn-primary`；背景是同色系的浅
tint，跟随浅色 / 深色主题。悬停显示前 5 个 skill 名与「点击重新检查」。

没有更新、工作区没有项目技能、或首次检查还没跑完时，这个位置保持原来的
布局，不占宽度。检查失败时提示缩成一个 `!`（error 色），tooltip 显示原因，
点击可重试。

## 检查流程

1. 浏览器只把当前会话 id 发给 Host；不传路径，也不读文件系统。
2. Host 解析当前工作区：
   - 优先在 `workspaceRegistry` 里找 `sessionIds` 包含该会话的工作区；
   - 找不到时取会话 header 的 `cwd`，再在已注册工作区里找包含它的最长
     路径（会话在子目录里时仍检查工作区根目录）；
   - 两者都没有时返回 `unavailable`，不显示提示。
3. 读 `<工作区>/skills-lock.json`。文件不存在说明这个工作区没有由
   `npx skills` 管理的项目技能，直接结束，不启动 CLI。
4. 用插件依赖里的 `skills` CLI 执行 `check -p -y`，工作目录是工作区根目录。
   退出码 0 与 1 都是正常结论：1 表示有更新或有本地修改；其它退出码、
   超时或进程没启动起来才算检查失败。
5. 解析输出里的 `↑ <name> has an update`，排序后作为结果。本地修改
   （`✎ … has local changes`）不算更新，不会让提示出现。

同一个工作区在 5 分钟内只跑一次 CLI；多个会话同时挂载时共用同一个进行
中的 Promise。点击提示传 `refresh=1` 跳过缓存。检查是只读的：不写
lockfile，不安装、不更新任何 skill。

## 怎么更新

插件不替你做更新。确认后可以：

```bash
# 在当前工作区
npx skills update -p

# 或只更新某一个
npx skills update <skill-name> -p
```

也可以继续用 [Skills 插件](../skills/README.md) 的页面逐项更新。更新完成后
点击输入框下方的提示重新检查，提示就会消失。

## 限制

- 只检查**项目级**技能（工作区根目录的 `skills-lock.json`）。全局技能
  （`~/.agents/skills`）不在这里提示，那是 Skills 插件的页面负责的范围。
- 工作区没有 `skills-lock.json` 时没有可检查的对象；手工安装、没有记录在
  lock 里的技能也不参与。
- 不轮询：进入会话、切换会话时检查一次，之后靠点击提示刷新。
- 首次检查要访问来源仓库，可能需要几秒到几十秒；检查期间提示不占位置。
- 提示位于 `conversation.composer.dock`（输入框卡片下方的统计行），排在
  「上下文已用」圆环之后。没有会话时不渲染；新建会话的空白会话有 id，会
  正常显示。
- 提示只统计「上游有更新」。即使有本地修改（`modified`），只要没有更新，
  就不会出现提示。

## 要求

- DSH `>= 0.2.2-rc.1`。
- 插件随包安装 `skills@1.9.0`；不需要已安装 `@buka/dsh-plugin-skills`。
- Host 需要 `sessions` 服务；`workspaceRegistry` 是可选服务，没有时退回
  会话的 `cwd`。

## 安全

Host 只注册一条本机路由（`GET /buka-skill-update-check/status`），并沿用 DSH web
组合的信任栅栏（`connection.requestRejection`）：非本机或未认证的请求会被
拒绝。浏览器只能传会话 id 与 `refresh=1`，不能传路径——检查目录完全由 Host
从会话与工作区注册表解析。CLI 以工作区为 cwd 运行，只读；响应里的
`skills check` 输出尾部只用于排查失败。
