---
description: 构建、校验、本地预览与验证插件
paths:
  - scripts/**
  - test/**
---

# 常用命令

要求 Node.js 22.20 及以上，pnpm 11。仓库没有第三方依赖，不需要 `pnpm install`；脚本用到的 `git` 必须在 `PATH` 上。

```bash
pnpm run check    # 发布前自检：清单、format 1、钉住的提交是否真含插件
pnpm test         # 校验器、生成器、SemVer 的单测
pnpm run build    # 生成 dist/index.json 与 dist/icons/
pnpm run serve    # 本地 http 预览 dist/，默认 127.0.0.1:4180
```

参数：

```bash
pnpm run build --out /tmp/market        # 换个输出目录
pnpm run build --source-url https://github.com/buka-ltd/buka.dsh-plugin-marketplace
pnpm run serve --port 4180 --dir dist
```

`--source-url` 一般不用给：默认取 `origin` 并归一成 https（`git@` / `ssh://` 都认）。CI 里用环境变量 `DSH_MARKET_SOURCE_URL` 固定成公司仓库，避免 PR 的 fork 地址混进索引。这个变量只由 `scripts/build.mjs`、`scripts/check.mjs` 两个入口读，生成器只认显式 `sourceUrl`——所以 `pnpm test` 不受 CI 环境变量影响，改生成器时不要让它去读 `process.env`。

> 空仓库第一次跑 `pnpm run check` 会报「目录还没有提交」：索引要钉住插件目录的提交。先 `git commit` 再跑。

## 本地预览

```bash
pnpm run build
pnpm run serve
# 另一个窗口：在 DSH 的 Plugins → More → Custom plugin markets → Discover 里
# 添加 http://127.0.0.1:4180/index.json
```

DSH 拒绝重定向与 `file:`，所以必须走 `serve` 起的 http 服务。改完插件重新 `pnpm run build`，Discover 里刷新即可（索引本身有 10 分钟缓存）。

## 用官方校验器复核

本机装了 DSH 时，用 DSH 自带的 `parseMarketIndex` 再校验一次生成结果（`app.asar` 只能用 Electron 的 node 读）：

```bash
pnpm run build
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals scripts/official-check.mjs dist/index.json
```

路径不同时用 `DSH_APP_ASAR` 指向 `.../Resources/app.asar`。输出里会给出官方实现算出的安装 spec，可与 `pnpm run build` 打印的结果对照。

## 验证插件真的能装

用一份**临时 profile** 从本地目录安装，不会碰你正在用的配置：

```bash
export DSH_HOME=$(mktemp -d)/dsh-home
mkdir -p "$DSH_HOME/profiles"
cp -R ~/.dsh/profiles/desktop "$DSH_HOME/profiles/verify"
# 把 $DSH_HOME/profiles/verify/package.json 的 name 改成 dsh-profile-verify
# （web / desktop 这两个 profile 名由应用独占，--dump-config 会拒绝）

dsh plugin --profile verify add "link:$PWD/plugins/hello"
dsh --profile verify --dump-config | grep -A2 tool-buka-hello
```

第二行能在输出里看到 `- id: tool-buka-hello` 与 `name: '@buka/dsh-plugin-hello'`，说明补丁层被应用、插件行进了 composition。想再往前一步，用 `dsh --profile verify` 启动这套配置（会占用一个本地端口，先关掉），日志里没有该插件的加载错误即可。

没有 `dsh` 命令时，用 DSH 应用自带的 CLI：

```bash
APP="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
ELECTRON_RUN_AS_NODE=1 "$APP" --expose-internals "$CLI" --profile verify --dump-config
```

验证完 `rm -rf "$DSH_HOME"`，不要把它留在 `~/.dsh` 里。
