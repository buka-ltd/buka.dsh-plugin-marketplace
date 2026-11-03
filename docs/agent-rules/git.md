---
description: Git 操作约束（提交由用户发起，禁止破坏用户改动）
---

# Git 操作约束

`git add`、`git commit` 这类写入暂存区与提交历史的操作由用户发起；会丢掉用户改动的回滚操作永远不做。两者的边界不同，分开约束。

## 提交由用户发起

- 只在用户**主动要求提交**时执行暂存与提交，如「提交代码」「commit 一下」「帮我提交」
- 用户没有发起时，不要主动 `git add` / `git commit`：改完文件即可，在回复里给出改动摘要与拟用的提交信息，由用户决定何时提交
- 不要用「要不要我提交」这类提问换取授权；用户没提就保持不动
- 用户要求提交后，只暂存本次改动涉及的路径（`git add <path> ...`），不要用 `git add -A` / `git add .` 把无关改动卷进来

## 始终禁止

以下操作与用户是否要求提交无关，任何时候都不要执行——它们会丢弃、隐藏或吞掉用户已有的改动：

- `git stash`：含 `push` / `pop` / `apply` / `drop` / `clear` 等一切子命令
- `git restore [--staged] <path>`、`git checkout -- <path>`
- `git reset`、`git clean`

## 提交信息

格式 `<type>(<scope>): <subject>`，`type` 用 Conventional Commits 的取值（`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `build` / `ci`）。

- `subject` 用中文，专有名词保留英文原文；字段名、命令、路径照抄
- 一个 commit 只做一件事：新增插件、改索引规则、改文档分别提交，不要混在一起
- 正文写「为什么改」与影响面，不复述 diff
- `scope` 用插件目录名（`feat(hello): 增加问候语参数`）或仓库级模块（`docs`、`ci`、`market`）

## 同步与合入

- 同步远端：`git pull --rebase`
- 分支合入 `main` 走 PR，合并方式选 **Rebase and merge**；不要产生 merge commit
- 需要更新已推送的分支用 `git push --force-with-lease`，不要 `--force`

## 版本与发布

- 本仓库不发 npm 包，索引直接钉住提交，所以**不需要手工打 tag**；插件版本以 `plugins/<dir>/package.json` 的 `version` 为准
- 索引由 CI 在 `main` 上生成并部署，`dist/` 不进版本库，也不要手改
- 改插件后忘记重新构建不会让线上错乱：CI 每次都从源码重新生成
- 不要手改 `CHANGELOG.md` 一类由工具生成的文件；本仓库目前没有 release-please 配置，需要引入时先与用户确认
