/**
 * 侧边栏「打工人」页面的 Host 一半。
 *
 * 打工人是**插件自己创建并登记**的对象，不是 DSH 的全部工作区：新建
 * 打工人时在插件全局目录下的 `workers/` 里建同名目录并写进 `workers.json`，
 * 再由浏览器一半把它挂到 DSH 工作区列表。Host 负责所有磁盘操作，提供一组
 * 包内 HTTP 路由给页面，除工作区 / 设置外都按打工人 **name** 操作：
 *
 * | 路由 | 作用 |
 * | --- | --- |
 * | `GET /buka-workers/list` | 列出登记表里的打工人、挂载状态、skills 与 AGENTS.md |
 * | `POST /buka-workers/create` | 建目录 + AGENTS.md 模板，并把打工人（含可选描述）插到登记表最前 |
 * | `POST /buka-workers/avatar` | 只改登记表里的头像 id |
 * | `POST /buka-workers/description` | 只改登记表里的一行描述（工作流用它选打工人） |
 * | `GET /buka-workers/models` | 读宿主模型目录（按提供方分组，供「模型」页签选择） |
 * | `POST /buka-workers/model` | 设置 / 清除智能体新会话使用的模型 |
 * | `POST /buka-workers/assistant` | 标记 / 取消智能体的助理身份（机器人只读） |
 * | `POST /buka-workers/rename` | 改打工人目录名 + 更新登记表 + 按新路径重建 DSH 工作区 |
 * | `POST /buka-workers/remove` | 从登记表移除（目录、文件与会话保留） |
 * | `POST /buka-workers/agents` | 写入某打工人的 AGENTS.md，并补 CLAUDE.md 链接 |
 * | `POST /buka-workers/skills/available` | 执行 `npx skills add <source> --list` 列出可安装的 skills |
 * | `POST /buka-workers/skills/install` | 只安装选中的 skills，同时落 `.agents/skills` 与 `.claude/skills` |
 * | `POST /buka-workers/skills/remove` | 在打工人目录里执行 `npx skills remove <skill> -y` |
 * | `POST /buka-workers/reveal` | 用系统文件管理器（macOS 的 Finder）打开打工人目录 |
 *
 * 工作区的注册、删除与打开必须走 DSH 自己的 Client Service（侧边栏才会同步），
 * 所以都在浏览器一半，这里不重复实现。另注册两个模型工具：只读的 `buka_workers`
 * 让模型回答「有哪些打工人、挂没挂载、是否写了 AGENTS.md、装了什么技能」
 * （见 `lib/list-tool.js`；工作流编排 preset 固定看不到技能清单）；写工具
 * `buka_worker_build`（见 `lib/builder.js`、`lib/build-tool.js`）负责创建 /
 * 修改 / 重命名打工人、写 AGENTS.md 并挂到工作区，但**只对随包发布的
 * 「打工人」preset 的根会话可见**（Config.builderPresets，判定见
 * `lib/access.js`）。删除打工人、安装 skills、页面上的编辑仍然只留给用户。
 *
 * 另通过 `ctx.provide('bukaWorkers', ...)` 对外提供一个 Host Service（见
 * `lib/service.js`）：`list()` 列出打工人（含内建机器人 clock 的
 * `driver` / `assistant` / `program`），`avatarMap()` 给出打工人头像，
 * `dispatchSession()` 新开一条会话并返回观测句柄，`openSession()` 只续接同一条
 * 会话（不压缩）。工作流插件用它把每个任务交给一个打工人、并在节点图上画出
 * 打工人头像；注册在这里而不是拆成第二个插件，是因为本包入口需要同时保留页面
 * 路由与工具。
 *
 * 路由在 `webServer` 就绪后注册，并沿用 web 组合的信任栅栏
 * （`connection.requestRejection`）：只接受本机、已认证的浏览器请求。
 *
 * @module @buka/dsh-plugin-workers
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

/** Cordis 插件名，出现在 composition 里；与补丁行的 `id` 保持一致。 */
export const name = 'page-buka-workers'

/** 依赖的服务：这里用它判断打工人是否已经挂到 DSH 工作区。 */
export const inject = ['workspaceRegistry']

/** 打工人根目录的默认位置：`<插件全局目录>/workers`。 */
const DEFAULT_WORKERS_DIR = defaultWorkersRoot()

/**
 * 随本插件发布的「打工人」preset；`buka_worker_build` 默认只对这个
 * preset 的根会话可见（见 Config.builderPresets）。
 */
const DEFAULT_BUILDER_PRESETS = ['worker-builder']

/**
 * 可在设置页配置的打工人根目录。
 *
 * 打工人目录建在这里；登记文件固定为该目录同级的 `workers.json`，插件只管理
 * 登记表里列出的打工人，不碰用户自己的 DSH 工作区。
 */
export const Config = z.object({
  workersDir: z
    .string()
    .default(DEFAULT_WORKERS_DIR)
    .description(
      '打工人根目录：打工人目录建在插件全局目录下；登记文件固定为该目录同级的 workers.json，支持 ~ 前缀。',
    ),
  builderPresets: z
    .array(z.string())
    .default(DEFAULT_BUILDER_PRESETS)
    .description(
      '能看到并调用 buka_worker_build（创建 / 修改打工人）的 agent preset 名单。留空表示不按 preset 收窄（所有会话可见，不推荐）；推荐只保留随插件发布的 `worker-builder`。',
    ),
  seedPresets: z
    .boolean()
    .default(true)
    .description(
      '全新安装（登记表为空）时是否自动补上「软件工程师」与「质量保障工程师」两个预设打工人；设为 false 则不初始化预设。',
    ),
})

/**
 * 注册 HTTP 路由、只读工具与「打工人」preset 的写工具。
 *
 */
export function apply(
  ctx: import('@deepseek-ai/cordis').Context,
  config?:
    | {
        workersDir?: string
        builderPresets?: string[]
        seedPresets?: boolean
      }
    | undefined,
) {
  const workersDir = resolveWorkersDir(config?.workersDir)
  const registryFile = resolveWorkerRegistryFile(workersDir)

  // 对外服务：工作流插件通过 ctx.bukaWorkers 列出打工人、开启打工人会话。
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

  // 启动迁移与内建打工人登记走同一个写队列：先把旧插件的缓存目录 / 文件名 /
  // 登记格式搬过来，再补内建机器人（clock）。两步都幂等；失败只记日志，页面
  // 仍会从读视图里看到内建打工人。
  void serializeRegistry(async () => {
    await migrateWorkerStore({ workersDir, registryFile, logger: ctx.logger })
    return ensureBuiltinWorkers({ file: registryFile })
  })
    .then((result) => {
      if (result.corrupt) {
        ctx.logger?.warn?.('buka-workers: 登记文件损坏，跳过内建打工人登记：%s', registryFile)
      } else if (result.added.length > 0) {
        ctx.logger?.info?.('buka-workers: 已登记内建打工人：%s', result.added.join('、'))
      }
    })
    .catch((error) => {
      ctx.logger?.warn?.('buka-workers: 启动迁移或登记内建打工人失败：%s', describeError(error))
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

  // ---- 模型工具：只读列举 + 「打工人」preset 的写工具 -------------------
  registerWorkerTools(ctx, { workersDir, registryFile, builderPresets, serializeRegistry })

  // ---- 模型：给打工人目录里新开的会话套用登记的模型 ---------------------
  registerWorkerModelEnforcement(ctx, registryFile)
}
