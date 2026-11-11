---

## description: 项目结构与文件归属

# 项目结构

```text
.
├── AGENTS.md                    # 协作规则索引
├── GLOSSARY.md                  # 术语表：文档与提交信息都用这里的词
├── README.md                    # 项目介绍、安装入口与开发命令
├── market.json                  # 索引自身：标题、简介、分类/标签表、publicUrl
├── package.json                 # 根脚本与开发依赖；所有构建工具装在这里
├── pnpm-workspace.yaml          # workspace：plugins/* 与 packages/*
├── tsconfig.base.json           # TypeScript 基线（strict、NodeNext、paths）
├── biome.json                   # 格式与静态检查配置
├── plugins/<dir>/               # 一个插件一个目录，目录名 = 包名后缀
│   ├── package.json             # 包身份、engines.dsh、dsh.bundle.patch、dsh.client
│   ├── tsconfig.json            # 继承根基线，outDir 指向 ../../.build/<dir>
│   ├── cordis.patch.yml         # bundle 补丁层
│   ├── market.json              # 挂牌信息（只用于市场展示，不随包发布）
│   ├── icon.svg                 # 市场图标，构建时复制到 dist/icons/
│   ├── README.md                # 面向使用者的插件说明
│   ├── src/                     # 人手写的 TypeScript 源码
│   │   ├── index.ts             # 宿主一半入口：只装配
│   │   ├── *.ts                 # 路由、服务、存储等宿主侧模块
│   │   └── client/              # 界面一半（可选）
│   │       ├── index.ts         # 界面入口：只装配
│   │       └── **               # 页面、组件、状态、样式
│   ├── lib/                     # 编译产物，提交进 git，不手改
│   │   ├── index.js             # 宿主一半
│   │   └── client.js            # 界面一半（有 dsh.client 时）
│   ├── locale/{en,zh}.json      # 展示文案的唯一来源（meta.title/description/detail）
│   └── docs/{DETAIL.md,DETAIL.zh.md}  # 市场详情页长文，由 meta.detail 指向
├── packages/
│   ├── plugin-kit/              # 宿主侧公共包（构建时内联进插件）
│   │   ├── src/{index,errors,http,npx,store}.ts
│   │   └── lib/                 # 编译产物，gitignored，不提交
│   └── plugin-ui/               # 界面侧公共包（构建时内联进插件）
├── scripts/                     # 索引与构建脚本，Node 直接执行 .ts
│   ├── build.ts                 # 生成 dist/index.json 与 dist/icons/
│   ├── build-code.ts            # tsc -p：packages/* 再 plugins/*，产出 .build/
│   ├── build-clients.ts         # tsdown：从 .build/ 产出 plugins/*/lib/
│   ├── check.ts                 # 发布前自检
│   ├── serve.ts                 # 本地 http 预览 dist/
│   ├── official-check.ts        # 用 DSH 自带校验器复核（可选）
│   ├── tsconfig.json            # 给 tsc / 编辑器用的脚本类型检查配置（没有 npm 脚本调用）
│   └── lib/{envelope,format,market,report,semver}.ts
├── types/dsh.d.ts               # 官方缺失的服务与 Context 增强
├── schemas/index.schema.json    # format 1 的 JSON Schema（编辑期提示用）
├── test/                        # node --test；测试直接 import src/** 的 .ts
├── docs/
│   ├── adr/                     # 架构决策记录（0001~0004）
│   ├── agent-rules/             # 本仓库的协作规则
│   └── agents/                  # 工程技能配置（issue tracker、领域文档等）
├── .build/                      # tsc 中间产物，gitignored，不手改
└── dist/                        # 市场索引产物，gitignored，不手改
```

## 文件归属

| 内容               | 放在哪                                         | 规则                                                                                                            |
| ------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 宿主一半的逻辑     | `plugins/<dir>/src/**`                         | TypeScript；入口只装配，路由 / 服务 / 存储拆成模块                                                              |
| 界面一半的逻辑     | `plugins/<dir>/src/client/**`                  | TypeScript；入口只装配，页面与组件拆成模块                                                                      |
| 插件入口           | `plugins/<dir>/src/index.ts`                   | 导出 `name` / `inject` / `Config` / `apply`（可再导出公开常量），只做装配；具体实现不放这里                     |
| 界面入口           | `plugins/<dir>/src/client/index.ts`            | 只导出 `inject` 与 `apply`；外壳由构建脚本生成                                                                  |
| 宿主侧共享工具     | `packages/plugin-kit/src/**`                   | HTTP 辅助、错误文案、原子写、`npx` 包装；插件从 `@buka/plugin-kit` 导入                                         |
| 界面侧共享组件     | `packages/plugin-ui/src/**`                    | 请求封装、抽屉、头像表、基础样式等界面一半的公共代码                                                            |
| 插件专属的类型补丁 | `plugins/<dir>/src/dsh-extra.d.ts`             | 只补官方类型或根 `types/dsh.d.ts` 没覆盖、且只有该插件用到的形状                                                |
| 展示文案           | `plugins/<dir>/locale/{en,zh}.json`            | `meta.title` / `meta.description` / `meta.detail`；唯一来源                                                     |
| 市场详情长文       | `plugins/<dir>/docs/DETAIL.md`、`DETAIL.zh.md` | 由 `meta.detail` 指向；`check` 校验文件存在                                                                     |
| 挂牌信息           | `plugins/<dir>/market.json`                    | 只放 `listed` / `icon` / `author` / `homepage` / `repository` / `category` / `labels` / `keywords` / `sortKeys` |
| 索引级配置         | 根 `market.json`                               | 标题、简介、`publicUrl`、包名前缀、分类 / 标签声明表                                                            |
| 编译产物           | `plugins/<dir>/lib/**`                         | 由构建生成、提交进 git；不手改                                                                                  |
| 公共包编译产物     | `packages/*/lib/**`                            | 由构建生成、gitignored；不提交                                                                                  |
| tsc 中间产物       | `.build/**`                                    | gitignored；`build-clients` 的输入                                                                              |
| 市场索引产物       | `dist/**`                                      | gitignored；`build` 的输出                                                                                      |

## 放置规则

- 一个插件一个目录，目录名即包名后缀：`plugins/<dir>` ↔ `@buka/dsh-plugin-<dir>`。
- **插件之间不互相 import。** 需要共享的宿主逻辑进 `packages/plugin-kit`，共享的界面逻辑进 `packages/plugin-ui`；跨插件协作只走 DSH 服务或包内 HTTP 路由。
- `packages/*` 是私有包，不发布到 npm；构建时由 `tsdown` 内联进 `plugins/*/lib`，用户安装插件时拿不到它们。
- 两个入口文件保持“只装配”：`src/index.ts` 与 `src/client/index.ts` 里不写页面、路由或存储实现；实现放到旁边的模块，入口只注册与连接。
- 浏览器一半绝不能手写 `window.__ModuleLoader__.load({...})`：源码只导出 `inject` / `apply`，`scripts/lib/envelope.ts` 会在构建时套上外壳。
- 新增 / 修改插件后同步更新根 [README](../../README.md) 与插件自己的 `README.md`；目录结构变化时更新本文档。
- `.agents/`、`skills-lock.json`、`node_modules/`、`.tmp/` 都不进版本库；不要在仓库内安装技能。

## 新增一个插件时

1. 建 `plugins/<dir>/`，目录名决定包名。
2. 写 `package.json`（`dsh.bundle.patch`、`dsh.client`、`files` 含 `lib`）、`cordis.patch.yml`、`tsconfig.json`。
3. 写 `src/index.ts` 与可选的 `src/client/index.ts`，把实现拆到模块里。
4. 写 `locale/{en,zh}.json`、`docs/DETAIL.md`、`docs/DETAIL.zh.md`、`market.json`、`icon.svg`。
5. 跑 `pnpm run build:code && pnpm run build:clients`，确认 `plugins/<dir>/lib/` 生成并提交。
6. 跑 `pnpm run check`；涉及索引字段时再跑 `pnpm run build` 本地预览。
