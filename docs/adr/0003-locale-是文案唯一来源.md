# ADR 0003：locale 是文案的唯一来源

- 状态：已采纳（2026-11-12）
- 影响面：`plugins/*/market.json`、`plugins/*/locale/*.json`、`plugins/*/package.json`、索引生成

## 背景

同一个插件的展示文案曾经同时写在四个地方：`package.json` 的 `description`、
每个插件目录的 `market.json`、`locale/{en,zh}.json` 的 `meta`、以及 README。
四处手写、没有生成、没有检查，于是越写越不一样（迁移前的实测：`skills` 的英文描述
分别是 661 / 1285 / 352 字符；`workflows` 是 8602 / 7080 / 7080）。

## 决定

1. **`locale/{en,zh}.json` 的 `meta` 是唯一来源。**
   DSH 装载插件后，插件页卡片读的就是它；格式由 DSH 规定，插件不能自己加字段。

2. **索引文案由构建生成，不手写。**
   根索引里每个插件的 `title` / `description` 从该插件的 `locale/*.json` 生成。
   理由：索引里的本地化文案是**可选**的（缺了会回退成包名），而 `locale` 是**必需**的，
   所以应该拿必需的那份生成可选的，反过来会在某个插件上悄悄丢文案。

3. **`market.json` 只保留索引专属字段**：分类、标签、关键词、作者、主页、图标。
   删掉 `title` / `description`。

4. **长文案走 `meta.detail` 指向的 `docs/DETAIL.md`（中英各一份）。**
   七八千字的说明放进市场卡片没有意义；DSH 的插件详情页会渲染 `meta.detail`
   指向的 Markdown，这是官方给的富文本通道。

5. **`package.json` 的 `description` 只写一句简短中文**，当 npm 元数据用，不参与展示。

## 后果

- 索引生成脚本要新增一步「从 locale 读文案」，并校验 `en` 键存在（format 1 强制要求）。
- 改文案只改 `locale/`（短文案）或 `docs/DETAIL.md`（长文案），不再散落四处。
- 各插件的 `market.json` 变短，只剩挂牌字段。
