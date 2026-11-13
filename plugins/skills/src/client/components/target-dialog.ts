/**
 * 「安装到打工人 / 工作区」对话框：读取目标列表、单选，确认后安装。
 *
 * 目标列表来自 Host 的 `GET /buka-skills/targets`：打工人只列智能体且目录
 * 存在的条目，工作区列 DSH 注册过的目录。Host 在安装时会再用名字 / 路径回去
 * 解析一次，所以这里展示的列表只用于选择。
 *
 * @module @buka/dsh-plugin-skills/client/components/target-dialog
 */

import type { ReactElement } from 'react'
import { Fragment } from 'react'

import type { Translate } from '../dictionary.ts'
import { targetItemsOf, targetKeyOf, targetLabelOf, targetPathOf } from '../keys.ts'
import { Button, h, IconWarningOutlineRegular, Modal, StateDot } from '../primitives.ts'
import type {
  InstallTargetsSnapshot,
  LoadedState,
  TargetDialog,
  TargetDialogKind,
} from '../types.ts'

/** 对话框需要的页面状态与动作。 */
export interface TargetDialogProps {
  /** 翻译函数。 */
  readonly t: Translate
  /** 打开着的对话框；`null` 表示关闭。 */
  readonly dialog: TargetDialog | null
  /** 目标列表。 */
  readonly targets: LoadedState<InstallTargetsSnapshot>
  /** 当前选中的目标键。 */
  readonly choice: string
  /** 对话框里的失败提示。 */
  readonly error: string | null
  /** 是否正在安装。 */
  readonly installing: boolean
  /** 关闭对话框（安装中不响应）。 */
  readonly closeTargetDialog: () => void
  /** 选择一个目标。 */
  readonly setChoice: (value: string) => void
  /** 重新读取目标列表。 */
  readonly reloadTargets: () => void
  /** 安装到选中的目标。 */
  readonly installToTarget: () => Promise<void>
}

/**
 * 一类目标不可用 / 为空时的说明文案。
 *
 * @param kind 目标类型
 * @param available 服务是否可用
 * @param t 翻译函数
 */
function emptyText(kind: TargetDialogKind, available: boolean, t: Translate): string {
  if (kind === 'worker') {
    return available ? t('targetEmptyWorkers') : t('targetWorkersUnavailable')
  }
  return available ? t('targetEmptyWorkspaces') : t('targetWorkspacesUnavailable')
}

/**
 * 目标列表主体：加载中 / 读取失败可重试 / 不可用 / 空 / 单选列表。
 *
 * @param props 页面状态与动作
 * @param kind 目标类型
 */
function renderBody(props: TargetDialogProps, kind: TargetDialogKind): ReactElement | null {
  const { t, targets, choice, installing, setChoice, reloadTargets } = props
  const list = kind === 'worker' ? targets.data?.workers : targets.data?.workspaces
  const items = targetItemsOf(kind, targets.data)

  if (targets.loading && targets.data === null) {
    return h(
      'p',
      { className: 'buka-skills-statusWithDot', role: 'status' },
      h(StateDot, { state: 'ongoing' }),
      t('targetLoading'),
    )
  }

  if (targets.error !== null) {
    return h(
      'div',
      { className: 'buka-skills-targetFailure', role: 'alert' },
      h(
        'p',
        { className: 'buka-skills-failure' },
        h(StateDot, { state: 'error' }),
        `${t('targetLoadFailed')} ${targets.error}`,
      ),
      h(
        Button,
        { variant: 'ghost', size: 'sm', disabled: installing, onClick: reloadTargets },
        t('retry'),
      ),
    )
  }

  if (list?.available === false || items.length === 0) {
    return h(
      'p',
      { className: 'buka-skills-targetHint' },
      emptyText(kind, list?.available !== false, t),
    )
  }

  return h(
    'ul',
    { className: 'buka-skills-targetList' },
    ...items.map((item) => {
      const key = targetKeyOf(kind, item)
      const label = targetLabelOf(kind, item)
      const itemPath = targetPathOf(item)
      const selected = key === choice
      const record = item as Record<string, unknown> | null | undefined
      const description = typeof record?.description === 'string' ? record.description : ''
      return h(
        'li',
        { key },
        h(
          'button',
          {
            type: 'button',
            className: `buka-skills-targetOption${selected ? ' isSelected' : ''}`,
            'aria-pressed': selected,
            title: description !== '' ? description : itemPath,
            disabled: installing,
            onClick: () => setChoice(key),
          },
          h('span', { className: 'buka-skills-targetName' }, label),
          itemPath === '' ? null : h('span', { className: 'buka-skills-targetPath' }, itemPath),
        ),
      )
    }),
  )
}

/**
 * 「安装到打工人 / 工作区」对话框。
 *
 * @param props 页面状态与动作
 */
function renderTargetDialog(props: TargetDialogProps): ReactElement {
  const { t, dialog, targets, choice, error, installing, closeTargetDialog, installToTarget } =
    props
  const kind: TargetDialogKind = dialog?.kind ?? 'worker'
  const items = targetItemsOf(kind, targets.data)
  const canInstall = dialog !== null && choice !== '' && items.length > 0 && !installing

  return h(
    Modal,
    {
      open: dialog !== null,
      onClose: closeTargetDialog,
      title: t(kind === 'worker' ? 'targetWorkerTitle' : 'targetWorkspaceTitle'),
      closeLabel: t('close'),
      footer: h(
        Fragment,
        null,
        h(
          Button,
          { variant: 'outline', onClick: closeTargetDialog, disabled: installing },
          t('cancel'),
        ),
        h(
          Button,
          {
            variant: 'primary',
            type: 'button',
            disabled: !canInstall,
            icon: installing ? h(StateDot, { state: 'ongoing', size: 13 }) : undefined,
            onClick: () => {
              void installToTarget()
            },
          },
          installing ? t('targetInstalling') : t('targetInstall'),
        ),
      ),
    },
    dialog === null
      ? null
      : h(
          'div',
          { className: 'buka-skills-targetBody' },
          h('p', { className: 'buka-skills-meta' }, `${t('targetFor')} ${dialog.node.name}`),
          renderBody(props, kind),
          error === null
            ? null
            : h(
                'div',
                { className: 'buka-skills-targetFailure', role: 'alert' },
                h(IconWarningOutlineRegular, { size: 16 }),
                h('span', null, error),
              ),
        ),
  )
}

export { renderTargetDialog }
