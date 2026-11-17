---

## description: Git 规范（提交由用户发起，禁止破坏用户改动）

# Git 规范

## 提交信息

按 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 书写即可，`type` 语义、`!` / `BREAKING CHANGE` 标记以规范原文为准，这里不再复述。本仓库没有 commit hook，格式靠自觉与评审。

本仓库只补充以下几点：

- **`subject` 与正文用中文，专有名词保留英文**：字段名、命令、文件路径、插件与工具名一律照抄原文，不音译、不意译
- **一个 commit 只做一件事**：新增插件、改索引规则、改文档分别提交；无关的格式化、重命名、顺手修复不要混进来，确实必须同改的（如依赖变更连带 `pnpm-lock.yaml`）在正文说明原因
- **正文写「为什么改」与影响面**，不复述 diff
- **`scope` 用插件目录名**（`feat(bell): 增加试听音量`）或仓库级模块（`docs`、`ci`、`market`）
- **处理完一个 issue 的提交必须带关闭信息**：只要这个 commit 让 issue 完成，正文末尾单独一行写 `Closes #<n>`（多个 issue 写 `Closes #1, #2`），合入 `main` 后 GitHub 自动关单
- 跨多个 commit 完成同一个 issue：最后一个 commit 写 `Closes`，前面的写 `Refs #<n>`，避免中途就宣告关闭
- 只关联、不打算关单时才写 `Refs #<n>`

## 提交前检查

本仓库没有 `.husky` 之类的本地 hook，下面这些命令要自己跑，CI 也会重跑：

- 改过 `plugins/*/src` 或 `packages/*/src` 后，跑 `pnpm run build:code && pnpm run build:clients`，把 `plugins/*/lib` 的改动一起提交；CI 会用 `git diff` / `git ls-files --others` 校验产物与源码一致，不一致直接失败
- 跑 `pnpm run check`：校验索引字段、locale、docs 与挂牌信息的一致性
- 发布前再跑 `pnpm run build` 生成索引预览；`dist/` 不进版本库
- 不要用 `--no-verify` 绕过 hook；没有 hook 也不能跳过上面的命令

## 发版与索引

- 本仓库不发 npm 包：索引直接钉住提交，`dist/` 由 CI 在 `main` 上生成并部署
- 插件版本以 `plugins/<dir>/package.json` 的 `version` 为准，提交类型决定版本变化（`feat` → minor，`fix` → patch，`!` → major）
- **不要手工打 tag**：本仓库没有 release-please 配置；需要引入时先与用户确认
- 索引由脚本从 `package.json`、locale、`market.json` 与 git 生成，不要往 `dist/` 里手填内容

## 不要手改或手工创建

- `plugins/*/lib`：由构建生成、**必须提交**，但不能手改
- `dist/`、`.build/`、`packages/*/lib/`：构建中间产物，不进版本库
- `CHANGELOG.md` 一类工具生成的文件：本仓库目前没有，需要时由工具生成

## 同步与合入

- 同步远端：`git pull --rebase`
- 分支合入 `main` 走 PR，合并方式选 **Rebase and merge**；不要产生 merge commit
- 需要更新已推送的分支用 `git push --force-with-lease`，不要 `--force`

## git 写操作必须由用户主动发起

未经用户主动、明确地要求「提交代码」「commit 一下」「帮我提交」「push」，不要执行 `git add`、`git commit`、`git push`，也包括 `--amend`、强推与 `git tag`。

- 用户没发起时改完文件即可，在回复里给出改动摘要与拟用的提交信息，由用户决定何时提交
- 授权只能来自用户主动提出：不要用「要不要我提交」这类提问去换取授权
- 用户要求提交后，只暂存本次改动涉及的路径（`git add <path> ...`），不要用 `git add -A` / `git add .` 把无关改动卷进来

## 始终禁止

以下操作会丢弃、隐藏或吞掉用户已有的改动，任何情况下都不要执行：

- `git stash`：含 `push` / `pop` / `apply` / `drop` / `clear` 等一切子命令
- `git restore [--staged] <path>`、`git checkout -- <path>`
- `git reset`、`git clean`

## 不要提交

- `node_modules`、`dist/`、`.build/`、`packages/*/lib/`、`.tmp/` 等构建产物与临时目录：已在 `.gitignore` 中，别用 `-f` 强推
- `.agents/` 与 `skills-lock.json`：技能安装产物，不在仓库内维护
- 任何凭据：`.env` 与真实密钥禁止入库，也不要贴进提交信息或 PR
