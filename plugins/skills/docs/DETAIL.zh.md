# Buka Skills

在侧边栏新增「Skills」页面，顶部两个 Tab：已安装列出对所有会话生效的全局 skills，并按来源选择正确的卸载方式（交给 npx skills，或直接删除手工安装的目录）；收藏用来记下常用的 npx skills 来源（owner/repo、GitHub/GitLab 链接、任意 git 地址、本地绝对路径、包名；包名可收藏但不能展开），点「刷新」旁边的「收藏」按钮在对话框里填写仓库与备注，有网页地址的来源点标题打开仓库、可删除收藏；每个可列出的来源都会自动判定是 npx skills 仓库、Claude Code marketplace 仓库还是不可用并显示徽标，可用仓库还能展开成带缓存的 skills 树（marketplace 按插件分组），树里每个 skill 都能一键安装到全局（交给 npx skills add -g，已经装好的显示禁用的「已安装」按钮），git 地址先浅克隆到 DSH home 缓存、本地路径直接扫描；同时通过 ctx.bukaSkills Host 服务把收藏仓库、仓库里的 skills 与 marketplace 插件列表开放给其他插件。
