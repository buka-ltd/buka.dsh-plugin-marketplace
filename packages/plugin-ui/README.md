# `@buka/plugin-ui`

插件界面侧（浏览器一半）的公共包：React 元素工厂、JSON 请求封装、头像预设，
以及宿主与界面共用的纯数据模块。

它只在构建期使用——`tsdown` 把这些模块内联进每个插件的 `lib/client.js`，
用户安装插件时不会装到这个包；`lib/` 是 gitignored 的中间产物。

## 子路径导出

| 子路径           | 内容                                                      | 谁用                 |
| ---------------- | --------------------------------------------------------- | -------------------- |
| `.`              | `h()`、`requestJson()`、头像预设、`worker-label` 的再导出 | 浏览器一半           |
| `./worker-label` | `workerDisplayName()` / `workerIdentityLabel()`           | 浏览器一半与宿主一半 |

## `./worker-label`：宿主与界面共用的纯模块

`src/worker-label.ts` 不 import React，也不依赖 DOM，只按「名称 · 标识符」的
规则拼展示文本。Workers 的宿主一半（列表、详情、改名路由）与界面一半（列表
卡片、详情、对话框）都要用同一套规则，所以它同时被两侧引用。

- 宿主侧必须走子路径导入 `@buka/plugin-ui/worker-label`，不要从包根导入：
  包根会带上 `h.ts` 的 React 依赖，等于把 React 带进 Host。
- 界面侧从包根或子路径导入都可以；新增纯函数时保持模块无副作用、不碰 React，
  才能继续被宿主使用。
- 其它导出（`h`、`requestJson`、`avatars`）只属于界面一半，宿主不要 import。

## 公共包的边界

两个共享包都只在构建时内联，不随插件发布：

- 宿主侧共享工具（HTTP 辅助、错误文案、原子写、`npx` 包装）进
  `packages/plugin-kit`（`@buka/plugin-kit`）；
- 界面侧共享组件与请求封装进本包；
- 插件之间不互相 import，需要跨插件协作时走 DSH 服务或包内路由。
