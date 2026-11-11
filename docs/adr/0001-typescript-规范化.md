# ADR 0001：用 TypeScript 重写插件并提交编译产物

- 状态：已采纳（2026-11-12）
- 影响面：四个插件（`plugins/*`）与市场索引脚本（`scripts/`）

## 背景

仓库长期由 AI 直接写 JavaScript：没有类型检查、没有格式与静态检查、没有共享代码层、
`plugins/*/lib` 与 `client.js` 全是手写。四个插件加起来约 15k 行宿主代码、10k 行界面代码，
重复逻辑分散（`npx` 包装两份 86% 相同、`access` 门禁两份 83% 相同、原子写五份、
HTTP 辅助四份上限各不相同、`describeError` 十六份），文档里的规则与代码多次互相矛盾。

## 决定

1. **源码用 TypeScript，编译产物提交进 git。**
   结构按 DSH 官方插件形状：`plugins/<插件>/src/**`（人手写）→ `.build/**`（tsc 中间产物，
   不进版本库）→ `plugins/<插件>/lib/{index.js,client.js}`（随插件发布的运行文件，提交进 git）。

2. **为什么产物必须提交，而不是安装时编译。**
   插件市场钉住的是 git 提交，用户安装时机器上不会编译；若改成安装时构建，则每个用户都要
   批准运行构建脚本并下载编译工具。产物进 git 让安装体验保持不变。代价是仓库里有生成文件，
   因此 CI 增加"重跑构建后 `plugins/*/lib` 不得有改动"的检查。

3. **界面一半由自造的包壳生成。**
   DSH 只认 `window.__ModuleLoader__.load({ id, factory })` 这种交付形式，官方没有把生成它的
   构建工具发布出来。我们用 `tsdown` 打成 CJS，再由 `scripts/lib/envelope.ts` 包进工厂外壳；
   `id` 取 `package.json` 的 `name`。基线模块（`react` 等）从外壳的 `require` 取，不打包。

4. **开发依赖只放仓库根目录。**
   插件的 `package.json` 不新增任何 `devDependencies`，类型通过根 `tsconfig.base.json` 的
   `paths` 解析。理由：插件是从 git 单独装进用户 profile 的，若清单里带开发依赖，用户会被
   迫安装 TypeScript、tsdown 等编译工具，插件包也不再自包含。

5. **官方类型包按精确版本引入。**
   `@deepseek-ai/*` 在 npm 上的 `latest` 是旧版，但 `next` 标签下有与宿主一致的 `0.2.2-rc.1`；
   `cordis 4.1.0`、`schemastery 3.19.0` 与宿主一致。类型依赖一律写精确版本，仅用于编译期。

6. **拿不到官方类型的服务，自己写模块增强。**
   `@deepseek-ai/dsh-server`、`dsh-connection`、`dsh-web-server`、`dsh-workspace-registry`、
   `dsh-client-config-forms` 未对外发布，客户端服务（`ctx.slots`、`ctx.configForms` 等）也没有
   官方导出的 `Context` 增强。这些声明集中在根目录的 `types/dsh.d.ts`（各插件 tsconfig 的 `include` 里带上它），经
   `import type` 引入，形状以本仓库实际调用的 API 为准。

7. **测试改为 TypeScript，直接 import `src/**`。**
   "测的就是发出去的东西"这一环由 CI 的产物一致性检查承担，而不是靠测试去跑 `lib/`。

8. **索引脚本也用 TypeScript，由 Node 直接运行，不产出编译文件。**
   Node 22.18 起默认支持直接执行 `.ts`（仓库要求 `>=22.20`），类型检查单独用 `tsc --noEmit`。
   代价：只能写可被擦除的语法（不用 `enum` / `namespace`）。

9. **TypeScript 7 的差异**：`baseUrl` 已被移除，`paths` 相对配置文件的写法不再需要 `baseUrl`。

## 后果

- `pnpm install` 成为必需步骤（此前仓库零依赖），CI 必须加 `--frozen-lockfile` 安装。
- 仓库里出现生成文件（`plugins/*/lib`、`packages/*/lib` 的声明产物），必须靠检查保证同步。
- 插件之间不再复制粘贴公共工具：`npx`、git、原子写、HTTP 辅助、错误文案进
  `packages/plugin-kit`；请求封装、抽屉、头像表、基础样式进 `packages/plugin-ui`。
  两个包在构建时内联进插件产物，用户安装不到它们。
