/**
 * DSH 运行时提供、但没有对外发布类型声明的服务与工具。
 *
 * 官方包（`@deepseek-ai/*`）在 npm 的 `next` 标签下发布了与宿主同版本的 `0.2.2-rc.1`，
 * `ctx.agents`、`ctx.sessions`、`ctx.tools`、`ctx.workspaceRegistry`、`ctx.userQuestions`
 * 等都能直接引用它们的类型。下面这些要么包本身未公开（`dsh-server`、`dsh-connection`、
 * `dsh-client-config-forms`），要么官方没有导出 `Context` 增强，只能由本仓库声明。
 *
 * 声明的形状以本仓库**实际调用的 API** 为准，不追求覆盖上游全部字段：超集没有意义，
 * 写错反而会掩盖问题。改动这里时，以真机装一次插件、跑一遍页面为验证标准。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 宿主侧 HTTP 服务器：插件按精确路径注册路由。 */
    webServer: WebServerService
    /** 连接服务：判断一条请求是否来自可信的本机浏览器。 */
    connection: ConnectionService
    /** 界面侧插槽服务：把页面注册进 shell 的具名位置。 */
    slots: SlotsService
    /** 界面侧文案服务：按命名空间注册词典、取翻译函数。 */
    locale: LocaleService
    /** 界面侧设置表单镜像：读写 Host 的 volatile 配置。 */
    configForms: ConfigFormsService
  }

  interface Events {
    /**
     * 审批请求（waterfall）：只在 DSH 等用户回复审批时派发。
     * 插件只旁听，必须把 `next()` 的结果原样返回，不能截胡。
     */
    'approval/request'(request: unknown, next: () => Promise<unknown>): Promise<unknown>
  }
}

/** 撤销一次注册。 */
export type Disposer = () => void

/** 一条宿主路由。`kind: 'exact'` 按路径全等匹配，`prefix` 按前缀匹配。 */
export interface WebServerRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebServerService {
  /** 注册一条路由，返回撤销注册的函数。 */
  register(route: WebServerRoute): () => void
}

export interface ConnectionService {
  /**
   * 复用 Web 组合的信任栅栏：返回拒绝状态码表示这条请求不该被处理，
   * 返回 `undefined` 表示放行。被拒绝时响应**尚未**写入，由调用方决定怎么回。
   */
  requestRejection(req: IncomingMessage): number | undefined
}

/** 插槽里显示的文案来源：注册时绑定的词典命名空间。 */
export type LocaleBinding = (key: string) => string

export interface LocaleService {
  /** 注册一份词典，返回撤销注册的函数。 */
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
  /** 取某个命名空间下的翻译函数。 */
  bind(namespace: string): LocaleBinding
}

export interface LocaleDictionaries {
  readonly [language: string]: Readonly<Record<string, string>>
}

/** 一个插槽位置的注册信息；具体字段由 shell 侧消费。 */
export interface SlotDefinition {
  readonly name: string
  readonly id: string
  readonly order?: number
  readonly label?: () => string
  readonly locale?: string
  readonly inject?: () => unknown
  readonly [extra: string]: unknown
}

export interface SlotsService {
  /** 等某个插槽可用后再执行注册；返回撤销函数（没有时忽略）。 */
  inject(name: string, install: () => Disposer | undefined): void
  /**
   * 往插槽里注册一个组件，返回撤销函数。
   * 组件的 props 由插槽位置与其 `inject()` 决定，这里不约束。
   */
  register(definition: SlotDefinition, component: (props: never) => unknown): () => void
}

/** 一份可读写的配置表单快照。 */
export interface ConfigFormSnapshot {
  readonly status: string
  readonly value?: Readonly<Record<string, string>>
  readonly writable?: boolean
}

export interface ConfigForm {
  getSnapshot(): ConfigFormSnapshot
  subscribe(listener: () => void): () => void
  /** 写入一个字段；返回是否成功。 */
  set(field: string, value: string): boolean | Promise<boolean>
}

export interface ConfigFormsService {
  /** 按 Host 插件行的命名空间取表单镜像。 */
  get(namespace: string): ConfigForm
}

/**
 * 配置里一个可热更新的字符串字段：值是引用，读取要经 `.get()`。
 *
 * 上游的 `Volatile<T>` 定义在 `@deepseek-ai/cosmokit`（schemastery 的传递依赖，
 * 不在本仓库的直接依赖里），这里按结构声明它的最小形状。
 */
export interface VolatileRef<T> {
  get(): T
}

export type VolatileString = VolatileRef<string>
