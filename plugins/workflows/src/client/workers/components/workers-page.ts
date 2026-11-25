/**
 * 「执行者」页签（首页 Worker Tab 的内容）。
 *
 * 页面只保存 UI 状态；执行者列表（登记表）来自 Host 的 `/workflow/workers/list`，
 * 挂载 / 摘除 / 打开工作区则通过注入的 `getService` 取 DSH 的 Client
 * Service，两者都失败时用 Toast 说明原因。
 *
 * 本文件只做装配：状态在 `state.ts`，动作在 `actions/`，各视图与对话框在
 * `components/`。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/components/workers-page
 */

import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import { createDetailActions } from '../actions/detail.ts'
import { createSkillActions } from '../actions/skills.ts'
import { createWorkerActions } from '../actions/workers.ts'
import { h } from '../h.ts'
import { useWorkersState } from '../state.ts'
import type { Translate } from '../types.ts'
import { InstallSkillsModal } from './install-dialog.ts'
import { PageHeader } from './page-header.ts'
import { WorkerDetail } from './worker-detail.ts'
import { AvatarDialog, CreateWorkerDialog, DeleteWorkerDialog } from './worker-dialogs.ts'
import { WorkerList } from './worker-list.ts'

/**
 * 「执行者」页签（首页 Worker Tab 的内容）。
 *
 */
export function WorkersPage(props: {
  t: Translate
  getService: (name: string) => unknown
  /** 首页装配好的顶部页签；列表视图才放进页签带左侧。 */
  topTabs?: ReactElement
}): ReactElement {
  const t = props.t
  const getService = typeof props.getService === 'function' ? props.getService : () => null
  const state = useWorkersState({ getService })
  const actions = createWorkerActions(state, t)
  const detail = createDetailActions(state, t)
  const skillActions = createSkillActions(state, t)
  const { selectedWorker, notice, setNotice } = state

  return h(
    'div',
    { className: 'buka-workers-page' },
    h(PageHeader, { t, state, actions, detail, skillActions, topTabs: props.topTabs }),
    h(
      'div',
      { className: 'buka-workers-body' },
      selectedWorker === null
        ? h(WorkerList, { t, state, actions })
        : h(WorkerDetail, {
            t,
            worker: selectedWorker,
            state,
            detailActions: detail,
            skillActions,
          }),
    ),
    notice === null
      ? null
      : h(Toast, {
          key: notice.seq,
          text: notice.text,
          tone: notice.kind === 'success' ? 'success' : undefined,
          icon: notice.kind === 'success' ? undefined : h(IconWarningOutlineRegular, {}),
          holdMs: 3200,
          onDone: () => setNotice(null),
        }),
    h(CreateWorkerDialog, { t, state, actions }),
    h(AvatarDialog, { t, state, detail }),
    h(DeleteWorkerDialog, { t, state, actions }),
    h(InstallSkillsModal, { t, state, skillActions }),
  )
}
