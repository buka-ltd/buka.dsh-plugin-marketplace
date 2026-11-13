---

description: 构建、校验、本地预览与验证插件
paths:

- scripts/**
- test/**

---

# 常用命令

要求 Node.js `>=22.20`、pnpm 11（根 `package.json` 的 `packageManager` 是 `pnpm@11.28.5`）。首次工作先 `pnpm install`：TypeScript、tsdown、Biome 与 `@deepseek-ai/*` 类型包都在仓库根的开发依赖里。

`scripts/**/*.ts` 由 Node 直接执行，不产出编译文件，所以只能使用可被擦除的 TypeScript 语法（不用 `enum` / `namespace`）。`pnpm run build:code` 只编译 `packages/*` 与 `plugins/*`，不编译 `scripts/`；脚本没有单独的编译步骤。

## 命令一览

| 命令                                    | 实际入口                   | 做什么                                                                                                                  |
| --------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm run build:code`                   | `scripts/build-code.ts`    | 先 `tsc -p packages/*`、再 `tsc -p plugins/*`；产出 `packages/*/lib` 与 `.build/<插件>/`。任何类型错误都失败            |
| `pnpm run build:clients`                | `scripts/build-clients.ts` | 从 `.build/` 用 tsdown 打出 `plugins/<dir>/lib/index.js` 与 `lib/client.js`；每次清空重建 `lib/`，必须先跑 `build:code` |
| `pnpm run build`                        | `scripts/build.ts`         | 生成 `dist/index.json` 与 `dist/icons/`；**不编译插件**，也不检查类型                                                   |
| `pnpm run check`                        | `scripts/check.ts`         | 发布前自检：清单、locale、format 1、钉住的提交、图标等                                                                  |
| `pnpm run serve`                        | `scripts/serve.ts`         | 把 `dist/` 以 http 暴露，供 Discover 填索引地址                                                                         |
| `pnpm test`                             | `node --test`              | 跑 `test/` 下的单测；`pretest` 会自动先跑 `build:code`                                                                  |
| `pnpm run lint`                         | `biome check .`            | 格式 + 静态检查，不自动改文件                                                                                           |
| `pnpm run lint:fix` / `pnpm run format` | Biome                      | 自动修复 / 只格式化；按需使用                                                                                           |
| `pnpm run pretest`                      | `scripts/build-code.ts`    | 单独执行 `test` 前置的编译                                                                                              |

## 改完源码后的标准流程

```bash
pnpm install
pnpm run build:code
pnpm run build:clients
pnpm test
pnpm run check
```

- 只改 `src/` 而没重建 `plugins/*/lib`，提交后 CI 会失败。`lib/` 是随插件发布的运行文件，必须和源码一起提交。
- `pnpm test` 会经 `pretest` 重跑 `build:code`，但不会自动跑 `build:clients`；需要更新 `lib/` 时仍要显式跑 `build:clients`。
- `pnpm run check` 不做类型检查；类型检查是 `build:code` 的一部分。

## 产物一致性检查

CI 的 `check` 任务会重跑构建，然后确认 `plugins/*/lib` 与提交内容完全一致。本地复现：

```bash
pnpm run build:code
pnpm run build:clients

# 已跟踪的产物不能被构建改动
git diff --exit-code -- 'plugins/*/lib'

# 也不能出现未提交的新产物
test -z "$(git ls-files --others --exclude-standard -- 'plugins/*/lib')"
```

- 有输出就说明 `src/` 改了但产物没提交，或反过来产物被手改过。
- 检查范围只是 `plugins/*/lib`。`packages/*/lib` 是构建中间产物（gitignored），不参与这项检查；它会在 `build:clients` 时被内联进插件的 `lib/`。
- 不要用 `git add -A` 顺手把 `.build/`、`dist/`、`node_modules/` 提交进去。

## 参数与环境变量

```bash
pnpm run build --out /tmp/market
pnpm run build --source-url https://github.com/buka-ltd/buka.dsh-plugin-marketplace
pnpm run serve --port 4180 --host 127.0.0.1 --dir dist
pnpm run build:clients bell workers        # 只构建指定插件
```

- `--source-url` 一般不用给：默认取 `origin` 并归一成 https（`git@` / `ssh://` 都认）。
- CI 用环境变量 `DSH_MARKET_SOURCE_URL` 把安装地址固定成上游仓库，避免 PR 的 fork 地址混进索引。这个变量只由 `scripts/build.ts` 与 `scripts/check.ts` 通过 `sourceUrlFromEnvironment()` 读取；索引生成器 `scripts/lib/market.ts` 只认显式传入的 `sourceUrl`，所以 `pnpm test` 不受 CI 环境变量影响。改生成器时不要让它去读 `process.env`。
- `pnpm run build` 会在输出末尾打印索引里每个插件钉住的版本与来源，以及索引地址。

> 插件目录还没有任何提交时，`pnpm run check` 会报「目录还没有提交」：索引要钉住插件目录的提交。先 `git commit` 再跑。

## 本地预览

```bash
pnpm run build
pnpm run serve
# 另一个窗口：在 DSH 的 Plugins → More（Experimental plugins）
# → Custom plugin markets → Discover 里添加 http://127.0.0.1:4180/index.json
```

- DSH 拒绝重定向与 `file:`，所以本地预览必须走 `serve` 起的 http 服务。
- `serve` 默认只监听 `127.0.0.1:4180`，根路径 `/` 会返回 `index.json`。
- 索引与图标同源同目录；`serve` 的根目录就是 `dist/`。
- 改完插件重新 `pnpm run build`，在 Discover 里刷新；DSH 对索引有缓存，必要时重新添加索引地址。

## 用官方校验器复核

本机装了 DSH 时，用 DSH 自带的 `parseMarketIndex` 再校验一次生成结果（`app.asar` 只能用 Electron 的 node 读）：

```bash
pnpm run build
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals scripts/official-check.ts dist/index.json
```

- 索引地址默认取根 `market.json` 的 `publicUrl`，也可以作为第二个参数传入。
- 路径不同时用 `DSH_APP_ASAR` 指向 `.../Resources/app.asar`，或用 `DSH_MARKET_INDEX_PACKAGE` 直接指定官方包的入口文件。
- 输出里会给出官方实现算出的安装 spec，可与 `pnpm run build` 打印的结果对照。

## 验证插件真的能装

用一份**临时 profile** 从本地目录安装，不会碰你正在用的配置：

```bash
export DSH_HOME=$(mktemp -d)/dsh-home
mkdir -p "$DSH_HOME/profiles"
cp -R ~/.dsh/profiles/desktop "$DSH_HOME/profiles/verify"
# 把 $DSH_HOME/profiles/verify/package.json 的 name 改成 dsh-profile-verify
# （web / desktop 这两个 profile 名由应用独占，--dump-config 会拒绝）

pnpm run build:code && pnpm run build:clients

dsh plugin --profile verify add "link:$PWD/plugins/bell"
dsh --profile verify --dump-config | grep -A2 sound-buka-bell
```

第二行能在输出里看到 `- id: sound-buka-bell` 与 `name: '@buka/dsh-plugin-bell'`，说明补丁层被应用、插件行进了 composition。想再往前一步，用 `dsh --profile verify` 启动这套配置（会占用一个本地端口，先关掉），日志里没有该插件的加载错误即可。

没有 `dsh` 命令时，用 DSH 应用自带的 CLI：

```bash
APP="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
ELECTRON_RUN_AS_NODE=1 "$APP" --expose-internals "$CLI" --profile verify --dump-config
```

验证完 `rm -rf "$DSH_HOME"`，不要把它留在 `~/.dsh` 里。

## 提交前的最小检查

```bash
pnpm run build:code
pnpm run build:clients
pnpm test
pnpm run lint
pnpm run check
```

`pnpm run lint` 在本地是建议步骤；CI 的 `check` 任务目前跑的是 `build:code`、`build:clients`、产物一致性检查、`pnpm test`、`pnpm run check` 与 `pnpm run build`。
