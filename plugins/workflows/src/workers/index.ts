/**
 * 执行者一半的宿主装配：`@buka/dsh-plugin-workflows` 合并包的执行者部分。
 *
 * 执行者是**插件自己创建并登记**的对象，不是 DSH 的全部工作区：新建
 * 执行者时在插件全局目录下的 `workers/` 里按不可变标识符建目录并写进
 * `workers.json`，再由浏览器一半把它挂到 DSH 工作区列表。Host 负责所有磁盘
 * 操作，提供一组包内 HTTP 路由给页面；执行者一律按 **id**（标识符）寻址，
 * `name` 只是可选展示名，改名不移动目录：
 *
 * | 路由 | 作用 |
 * | --- | --- |
 * | `GET /buka-workers/list` | 列出登记表里的执行者、挂载状态、skills 与 AGENTS.md |
 * | `POST /buka-workers/create` | 按标识符建目录 + AGENTS.md 模板，并把执行者（含可选展示名 / 描述）插到登记表最前 |
 * | `POST /buka-workers/avatar` | 只改登记表里的头像 id |
 * | `POST /buka-workers/description` | 只改登记表里的一行描述（工作流用它选执行者） |
 * | `GET /buka-workers/models` | 读宿主模型目录（按提供方分组，供「模型」页签选择） |
 * | `POST /buka-workers/model` | 设置 / 清除智能体新会话使用的模型 |
 * | `POST /buka-workers/rename` | 只改展示名 + 同步工作区标题（不移动目录、不重建工作区） |
 * | `POST /buka-workers/remove-impact` | 删除影响面：阻塞的运行中作业、受影响的工作流、历史作业数与目录 |
 * | `POST /buka-workers/remove` | 硬删登记条目 + 执行者目录 + 工作区注册；有 running 作业引用时 409 |
 * | `GET /buka-workers/files` | 只读列出执行者目录树（跳过 `.git` / `node_modules`） |
 * | `GET /buka-workers/file` | 只读读取执行者目录里的一个文本文件（`path` 限定在目录内） |
 * | `GET /buka-workers/skills/repos` | 读 Skills 插件的「技能仓库」：收藏来源、类型与预计 skill 数 |
 * | `POST /buka-workers/skills/available` | 只从已收藏来源里列出可安装的 skills（不再接受手填第三方来源） |
 * | `POST /buka-workers/skills/install` | 只安装收藏仓库里选中的 skills，同时落 `.agents/skills` 与 `.claude/skills` |
 * | `POST /buka-workers/skills/remove` | 在执行者目录里执行 `npx skills remove <skill> -y` |
 * | `POST /buka-workers/skills/check` | 只读检查执行者目录里项目级 skill 的更新状态（进入「技能」页签时自动调用） |
 * | `POST /buka-workers/skills/update` | 更新执行者的项目级 skill（可用 `skills` 收窄到某一项） |
 * | `POST /buka-workers/skills/update-all` | 列表页「更新全部执行者」：顺序更新所有符合条件的执行者 |
 * | `POST /buka-workers/reveal` | 兜底：用系统文件管理器打开执行者目录（页面优先用内核 open-in-app 的应用清单） |
 *
 * 工作区的注册、删除与打开必须走 DSH 自己的 Client Service（侧边栏才会同步），
 * 所以都在浏览器一半，这里不重复实现。另注册两个模型工具：只读的 `buka_workers`
 * 让模型回答「有哪些执行者、挂没挂载、是否写了 AGENTS.md、装了什么技能」
 * （见 `lib/list-tool.js`）；写工具 `buka_worker_build`（见 `lib/builder.js`、
 * `lib/build-tool.js`）按标识符创建 / 修改执行者（改名只改展示名）、写 AGENTS.md
 * 并挂到工作区，但**只对随包发布的 `Workflow` 预设的根会话可见**
 * （Config.builderPresets，判定见 `lib/access.js`）。删除执行者与安装 skills
 * 仍然只留给用户；页面上的「文件」页签只读，不提供编辑 / 保存。
 *
 * 删除通过可选的 `ctx.bukaWorkflows` 服务读引用面（同一合并包内始终存在；
 * 兜底分支仍按服务缺失处理）。唯一阻塞是引用该标识符的运行中作业。
 *
 * 另通过 `ctx.provide('bukaWorkers', ...)` 对外提供一个 Host Service（见
 * `lib/service.js`）：`list()` 列出执行者（每条带 `id` / `name`，以及内建
 * 机器人 clock 的 `driver` / `program`），`avatarMap()` 按标识符
 * 给出执行者头像，`dispatchSession()` 新开一条会话并返回观测句柄，
 * `openSession()` 只续接同一条会话（不压缩）。工作流引擎用它把每个任务交给
 * 一个执行者、并在节点图上画出执行者头像。
 *
 * 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
 * （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
 *
 * 本文件只导出装配函数与配置字段定义；合并后的插件入口
 * （`../index.ts`）负责把两份装配拼在一起。
 *
 * @module @buka/dsh-plugin-workflows/workers
 */
import z from '@deepseek-ai/schemastery'

import { normalizePresets } from './access.ts'
import { registerWorkerModelEnforcement } from './model-apply.ts'
import { describeError } from './routes/http.ts'
import { registerRoutes } from './routes.ts'
import { seedWorkersOnStartup } from './seed.ts'
import { SERVICE_NAME, WorkerSessionService } from './service.ts'
import { migrateWorkerStore } from './store/migrate.ts'
import { registerWorkerTools } from './tools.ts'
import {
  defaultWorkersRoot,
  ensureBuiltinWorkers,
  resolveWorkerRegistryFile,
  resolveWorkersDir,
} from './worker-store.ts'

/** 执行者根目录的默认位置：`<插件全局目录>/workers`。 */
const DEFAULT_WORKERS_DIR = defaultWorkersRoot()

/**
 * 能看到并调用 `buka_worker_build` 的 preset 名单；默认是随包发布的唯一
 * `Workflow` 预设（id `workflow-orchestrator`，同时承担工作流编排）。
 */
const DEFAULT_BUILDER_PRESETS = ['workflow-orchestrator']

/** 执行者一半的配置字段；合并后的插件入口把它与工作流配置拼成一份 `Config`。 */
export const workerConfigFields = {
  workersDir: z
    .string()
    .default(DEFAULT_WORKERS_DIR)
    .description(
      '执行者根目录：执行者目录建在插件全局目录下；登记文件固定为该目录同级的 workers.json，支持 ~ 前缀。',
    ),
  builderPresets: z
    .array(z.string())
    .default(DEFAULT_BUILDER_PRESETS)
    .description(
      '能看到并调用 buka_worker_build（创建 / 修改执行者）的 agent preset 名单。留空表示不按 preset 收窄（所有会话可见，不推荐）；推荐只保留随插件发布的 `workflow-orchestrator`（Workflow）。',
    ),
  seedPresets: z
    .boolean()
    .default(true)
    .description(
      '全新安装（登记表为空）时是否自动补上「软件工程师」与「质量保障工程师」两个预设执行者；设为 false 则不初始化预设。',
    ),
}

/** 执行者一半的装配入参（合并插件配置里取出的子集）。 */
export interface WorkerAssemblyConfig {
  workersDir?: string
  builderPresets?: string[]
  seedPresets?: boolean
}

/**
 * 装配执行者一半：注册服务、HTTP 路由与模型工具。
 *
 * @param ctx 插件上下文
 * @param config 合并插件配置
 */
export function applyWorkers(
  ctx: import('@deepseek-ai/cordis').Context,
  config?: WorkerAssemblyConfig,
): void {
  const workersDir = resolveWorkersDir(config?.workersDir)
  const registryFile = resolveWorkerRegistryFile(workersDir)

  // 对外服务：工作流引擎通过 ctx.bukaWorkers 列出执行者、开启执行者会话。
  ctx.provide(
    SERVICE_NAME,
    new WorkerSessionService({
      ctx,
      workersDir,
      registryFile,
    }),
  )

  // 登记文件的读改写（create / remove）也要串行：连点「创建」时后一次写入
  // 不能基于旧快照把前一次刚插进去的条目覆盖掉。
  let registryQueue: Promise<unknown> = Promise.resolve()
  function serializeRegistry<T>(work: () => Promise<T>): Promise<T> {
    const run = registryQueue.then(work, work)
    registryQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // 启动迁移与内建执行者登记走同一个写队列：先把旧插件的缓存目录 / 文件名 /
  // 登记格式搬过来，再补内建机器人（clock）。两步都幂等；失败只记日志，页面
  // 仍会从读视图里看到内建执行者。
  void serializeRegistry(async () => {
    await migrateWorkerStore({ workersDir, registryFile, logger: ctx.logger })
    return ensureBuiltinWorkers({ file: registryFile })
  })
    .then((result) => {
      if (result.corrupt) {
        ctx.logger?.warn?.('buka-workers: 登记文件损坏，跳过内建执行者登记：%s', registryFile)
      } else if (result.added.length > 0) {
        ctx.logger?.info?.('buka-workers: 已登记内建执行者：%s', result.added.join('、'))
      }
    })
    .catch((error) => {
      ctx.logger?.warn?.('buka-workers: 启动迁移或登记内建执行者失败：%s', describeError(error))
    })

  // 全新安装（只补过内建机器人）时补上两个预设智能体；串行进队列，
  // 避免与页面上的首次新建抢写。异步完成、不阻塞启动，失败只记日志。
  // `seedPresets: false` 时跳过。
  seedWorkersOnStartup({
    ctx,
    workersDir,
    registryFile,
    serializeRegistry,
    enabled: config?.seedPresets !== false,
  })

  // 能看到 / 调用 `buka_worker_build` 的 preset 名单（Config 可覆盖）。
  const builderPresets = normalizePresets(config?.builderPresets ?? DEFAULT_BUILDER_PRESETS)

  // ---- HTTP 路由：浏览器一半的列表与配置 ---------------------------------
  registerRoutes(ctx, { workersDir, registryFile, serializeRegistry })

  // ---- 模型工具：只读列举 + 编排 preset 的写工具 -----------------------
  registerWorkerTools(ctx, { workersDir, registryFile, builderPresets, serializeRegistry })

  // ---- 模型：给执行者目录里新开的会话套用登记的模型 ---------------------
  registerWorkerModelEnforcement(ctx, registryFile)
}
