---
description: 项目结构与文件归属
---

# 项目结构

```text
market.json                 # 索引自身：标题、简介、分类/标签表、publicUrl
plugins/<dir>/              # 一个插件一个目录，目录名 = 包名后缀
  package.json              # 包身份、engines.dsh、dsh.bundle.patch
  market.json               # 挂牌信息（不随包发布）
  cordis.patch.yml          # bundle 层补丁
  lib/index.js              # Cordis 插件入口
  icon.svg                  # 展示图标
scripts/
  build.mjs                 # 生成 dist/
  check.mjs                 # 发布前自检
  serve.mjs                 # 本地 http 预览
  lib/format.mjs            # format 1 校验（对齐 DSH 官方实现）
  lib/market.mjs            # 读插件 + 读 git + 组装索引
  lib/semver.mjs            # 版本比较与范围语法
  lib/report.mjs            # 问题列表输出
schemas/index.schema.json   # format 1 的 JSON Schema
test/                       # node --test
docs/agent-rules/           # 本仓库的协作规则
dist/                       # 构建产物（gitignored）
```

## 文件归属

- `market.json`（根目录）只放**索引级**信息：标题、简介、`publicUrl`、包名前缀、分类与标签的声明表
- `plugins/<dir>/package.json` 是包的事实来源：名称、版本、`engines.dsh`、`dsh.bundle.patch`、peer 依赖
- `plugins/<dir>/market.json` 只放**挂牌**信息：标题、简介、图标、`category`、`labels`、`keywords`、`homepage`、`author`，以及 `listed: false`
- 两者冲突时以 `package.json` 为准：版本、包名、兼容范围都不在 `market.json` 里重复

## 约束

- 一个插件一个目录，目录名即包名后缀：`plugins/<dir>` ↔ `@buka/dsh-plugin-<dir>`
- 插件之间不互相 import；共享逻辑要么复制，要么先做成独立包
- `plugins/` 下不出现不以 `.` 开头的构建产物；`dist/` 只由脚本写入
- 不在仓库内安装技能或依赖：`.agents/`、`skills-lock.json`、`node_modules/` 都不进版本库
- `market.json` 与各插件的 `market.json` 不写未定义字段：`pnpm run check` 会把它们当警告报出来，避免拼错后静默失效
- 新增、重命名、删除插件后同步更新根 [README](../../README.md) 与本文档的结构说明
