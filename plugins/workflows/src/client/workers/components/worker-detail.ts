/**
 * 「执行者」详情页：设置、文件与技能三个页签。
 *
 * @module @buka/dsh-plugin-workflows/workers/client/components/worker-detail
 */

import {
  Button,
  FileTypeIcon,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  languageForPath,
  ReadBlock,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import React from 'react'
import type { createDetailActions } from '../actions/detail.ts'
import type { createSkillActions } from '../actions/skills.ts'
import { skillsOf } from '../api.ts'
import { TABS, WORKER_DESCRIPTION_MAX_LENGTH, WORKER_NAME_MAX_LENGTH } from '../constants.ts'
import { h } from '../h.ts'
import type { WorkersPageState } from '../state.ts'
import type { Translate, Worker, WorkerFileNode, WorkerModelSelection } from '../types.ts'

type DetailActions = ReturnType<typeof createDetailActions>
type SkillActions = ReturnType<typeof createSkillActions>

/**
 * 技能检查状态 → 行内标签；没有结果或未知状态时不显示。
 *
 * 状态模型由 Skills 插件定义（与它的「已安装」面板一致）：`update` 有更新、
 * `modified` 本地已修改、`up-to-date` 已最新、`unsupported-source` 无法检查、
 * `failed` 检查失败。
 */
function skillStatusTag(
  status: string | undefined,
  t: Translate,
): { text: string; tone: 'info' | 'success' | 'warning' } | null {
  switch (status) {
    case 'update':
      return { text: t('skillStatusUpdate'), tone: 'info' }
    case 'up-to-date':
      return { text: t('skillStatusUpToDate'), tone: 'success' }
    case 'modified':
      return { text: t('skillStatusModified'), tone: 'warning' }
    case 'unsupported-source':
      return { text: t('skillStatusUnsupported'), tone: 'warning' }
    case 'failed':
      return { text: t('skillStatusFailed'), tone: 'warning' }
    default:
      return null
  }
}

/**
 * 技能区块：进入详情时自动检查更新，每行显示检查状态，有更新时提供行内
 * 「更新」；安装入口在执行者页头右上角，区块里不再放全局更新 / 安装按钮。
 *
 */
export function SkillsSection({
  t,
  worker,
  state,
  skillActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  skillActions: SkillActions
}): ReactElement {
  const {
    mutating,
    confirmingSkill,
    removing,
    skillError,
    setConfirmingSkill,
    updatingSkill,
    skillChecks,
  } = state
  const { removeSkill, updateSkill } = skillActions
  const skills = skillsOf(worker)
  const anyBusy = mutating
  const checks = skillChecks.workerId === worker.id ? skillChecks.results : {}
  const checking = skillChecks.workerId === worker.id && skillChecks.status === 'loading'
  const checkError = skillChecks.workerId === worker.id ? skillChecks.error : null

  const rows = skills.map((skill, index) => {
    const name = String(skill.name)
    const status = checks[name]?.status
    const tag = skillStatusTag(status, t)
    const confirmingThis = confirmingSkill === skill.name
    const removingThis = removing === skill.name
    const updatingThis = updatingSkill === skill.name
    const actions = removingThis
      ? h(
          'span',
          { className: 'buka-workers-statusWithDot' },
          h(StateDot, { state: 'ongoing', size: 13 }),
          t('removing'),
        )
      : confirmingThis
        ? [
            h(
              Button,
              {
                key: 'confirm',
                variant: 'outline',
                size: 'sm',
                className: 'buka-workers-danger',
                icon: h(IconWarningOutlineRegular, { size: 13 }),
                disabled: anyBusy,
                onClick: () => removeSkill(worker, skill),
              },
              t('confirmRemoveSkill'),
            ),
            h(
              Button,
              {
                key: 'cancel',
                variant: 'ghost',
                size: 'sm',
                disabled: anyBusy,
                onClick: () => setConfirmingSkill(null),
              },
              t('cancel'),
            ),
          ]
        : [
            updatingThis
              ? h(
                  'span',
                  { key: 'updating', className: 'buka-workers-statusWithDot' },
                  h(StateDot, { state: 'ongoing', size: 13 }),
                  t('updatingSkill'),
                )
              : status === 'update'
                ? h(
                    Button,
                    {
                      key: 'update',
                      variant: 'outline',
                      size: 'sm',
                      className: 'buka-workers-toolbarButton',
                      icon: h(IconRefreshOutlineRegular, { size: 13 }),
                      'aria-label': `${t('updateSkill')} ${name}`,
                      disabled: anyBusy,
                      onClick: () => void updateSkill(worker, skill),
                    },
                    t('updateSkill'),
                  )
                : null,
            h(
              Button,
              {
                key: 'remove',
                variant: 'outline',
                size: 'sm',
                className: 'buka-workers-danger',
                icon: h(IconTrashOutlineRegular, { size: 13 }),
                disabled: anyBusy,
                'aria-label': `${t('removeSkill')} ${name}`,
                onClick: () => setConfirmingSkill(skill.name),
              },
              t('removeSkill'),
            ),
          ]

    return h(
      'li',
      { className: 'buka-workers-skillRow', key: `${name}:${index}` },
      h(
        'div',
        { className: 'buka-workers-skillHead' },
        h('span', { className: 'buka-workers-skillName' }, name),
        tag === null ? null : h(Tag, { tone: tag.tone }, tag.text),
        typeof skill.source === 'string' && skill.source !== ''
          ? h(Tag, { tone: 'info', className: 'buka-workers-skillSource' }, skill.source)
          : null,
        h(
          'span',
          { className: 'buka-workers-skillActions' },
          ...(Array.isArray(actions) ? actions : [actions]),
        ),
      ),
      typeof skill.description === 'string' && skill.description !== ''
        ? h(
            'div',
            { className: 'buka-workers-skillDesc', title: skill.description },
            skill.description,
          )
        : null,
    )
  })

  return h(
    'section',
    { className: 'buka-workers-section', 'aria-busy': anyBusy ? true : undefined },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('skillsTitle')),
    ),
    checking
      ? h(
          'p',
          { className: 'buka-workers-statusWithDot', role: 'status' },
          h(StateDot, { state: 'ongoing' }),
          t('skillCheckLoading'),
        )
      : null,
    checkError === null
      ? null
      : h(
          'p',
          { className: 'buka-workers-failure', role: 'alert' },
          `${t('skillCheckFailed')} ${checkError}`,
        ),
    skillError === null
      ? null
      : h(
          'div',
          { className: 'buka-workers-alert', role: 'alert' },
          h(
            'div',
            { className: 'buka-workers-alertHead' },
            h(IconWarningOutlineRegular, { size: 16 }),
            h('span', null, `${t('skillErrorTitle')} ${skillError.message}`),
          ),
          typeof skillError.output === 'string' && skillError.output !== ''
            ? h(
                React.Fragment,
                null,
                h('span', { className: 'buka-workers-outputLabel' }, t('outputLabel')),
                h('pre', { className: 'buka-workers-output' }, skillError.output),
              )
            : null,
        ),
    skills.length === 0
      ? h('p', { className: 'buka-workers-empty' }, t('skillsEmpty'))
      : h('ul', { className: 'buka-workers-skillList' }, ...rows),
  )
}

/** 文件预览最多渲染的行数；更长的文件只显示前这么多行。 */
const FILE_PREVIEW_MAX_LINES = 2000

/** 按行拆分文件内容，兼容 CRLF；末尾换行不额外算一行。 */
function contentLines(text: string): string[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 文件大小的人读写法。 */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** `ReadBlock` 的本地化 chrome；占位符用简单替换，避免把 `t` 的签名放宽。 */
function readBlockLabels(t: Translate) {
  return {
    codeLabel: t('filesCode'),
    wrapLabel: t('filesWrap'),
    unwrapLabel: t('filesUnwrap'),
    copy: t('filesCopy'),
    copied: t('filesCopied'),
    window: (shown: number, total: number) =>
      t('filesWindow').replace('{shown}', String(shown)).replace('{total}', String(total)),
    collapseAria: t('filesCollapseAria'),
    expandAria: (hidden: number) => t('filesExpandAria').replace('{n}', String(hidden)),
    collapse: t('filesCollapse'),
    expand: t('filesExpand'),
  }
}

/**
 * 目录树里的一个节点：目录用原生 `<details>` 折叠（不需要 React 状态），
 * 文件是可点选的只读按钮。
 *
 */
function FileTreeNode({
  node,
  selectedPath,
  onOpen,
  depth = 0,
}: {
  node: WorkerFileNode
  selectedPath: string
  onOpen: (path: string) => void
  depth?: number
}): ReactElement {
  const indent = { paddingLeft: `${depth * 12 + 8}px` }
  if (node.kind === 'directory') {
    return h(
      'li',
      { className: 'buka-workers-fileTreeItem' },
      h(
        'details',
        { className: 'buka-workers-fileTreeDir' },
        h(
          'summary',
          { className: 'buka-workers-fileTreeSummary', style: indent },
          h(FileTypeIcon, { kind: 'folder', size: 14 }),
          h('span', { className: 'buka-workers-fileTreeName' }, node.name),
        ),
        node.children === undefined || node.children.length === 0
          ? null
          : h(
              'ul',
              { className: 'buka-workers-fileTreeList' },
              ...node.children.map((child) =>
                h(FileTreeNode, {
                  key: child.path,
                  node: child,
                  selectedPath,
                  onOpen,
                  depth: depth + 1,
                }),
              ),
            ),
      ),
    )
  }
  return h(
    'li',
    { className: 'buka-workers-fileTreeItem' },
    h(
      'button',
      {
        type: 'button',
        className: `buka-workers-fileTreeFile${node.path === selectedPath ? ' is-selected' : ''}`,
        style: indent,
        title: node.path,
        'aria-pressed': node.path === selectedPath,
        onClick: () => onOpen(node.path),
      },
      h(FileTypeIcon, { path: node.name, size: 14 }),
      h('span', { className: 'buka-workers-fileTreeName' }, node.name),
    ),
  )
}

/**
 * 右侧只读预览：加载 / 失败 / 过大 / 二进制 / 代码内容。
 *
 */
function FilePreview({ t, state }: { t: Translate; state: WorkersPageState }): ReactElement {
  const { files } = state
  const content = files.content
  const selected = files.selectedPath

  if (selected === '') {
    return h(
      'div',
      { className: 'buka-workers-filePreview' },
      h('p', { className: 'buka-workers-empty' }, t('filesSelectFile')),
    )
  }

  if (files.contentStatus === 'loading' || files.contentStatus === 'idle') {
    return h(
      'div',
      { className: 'buka-workers-filePreview', role: 'status' },
      h(
        'p',
        { className: 'buka-workers-statusWithDot' },
        h(StateDot, { state: 'ongoing' }),
        t('loading'),
      ),
    )
  }

  if (files.contentStatus === 'error') {
    return h(
      'div',
      { className: 'buka-workers-filePreview' },
      h(
        'p',
        { className: 'buka-workers-failure', role: 'alert' },
        `${t('filesReadFailed')} ${files.contentError ?? ''}`,
      ),
    )
  }

  if (content === null) {
    return h(
      'div',
      { className: 'buka-workers-filePreview' },
      h('p', { className: 'buka-workers-empty' }, t('filesSelectFile')),
    )
  }

  const meta = h(
    'div',
    { className: 'buka-workers-filePreviewHead' },
    h('span', { className: 'buka-workers-filePreviewPath' }, content.path),
    h('span', { className: 'buka-workers-filePreviewMeta' }, formatFileSize(content.bytes)),
  )

  if (content.tooLarge) {
    return h(
      'div',
      { className: 'buka-workers-filePreview' },
      meta,
      h(
        'p',
        { className: 'buka-workers-notice', role: 'status' },
        h(IconWarningOutlineRegular, { size: 16 }),
        h('span', null, t('filesTooLarge').replace('{n}', formatFileSize(content.bytes))),
      ),
    )
  }

  if (content.binary) {
    return h(
      'div',
      { className: 'buka-workers-filePreview' },
      meta,
      h(
        'p',
        { className: 'buka-workers-notice', role: 'status' },
        h(IconWarningOutlineRegular, { size: 16 }),
        h('span', null, t('filesBinary')),
      ),
    )
  }

  const lines = contentLines(content.content)
  const shown = lines.slice(0, FILE_PREVIEW_MAX_LINES)
  return h(
    'div',
    { className: 'buka-workers-filePreview' },
    meta,
    lines.length > shown.length
      ? h(
          'p',
          { className: 'buka-workers-fieldHint' },
          t('filesLinesTruncated').replace('{n}', String(shown.length)),
        )
      : null,
    shown.length === 0
      ? h('p', { className: 'buka-workers-empty' }, t('filesEmptyFile'))
      : h(ReadBlock, {
          label: content.path,
          lines: shown.map((text, index) => ({ number: index + 1, text })),
          totalLines: shown.length,
          maxLines: shown.length,
          lang: languageForPath(content.path) || undefined,
          labels: readBlockLabels(t),
          className: 'buka-workers-fileCode',
        }),
  )
}

/**
 * 「文件」页签：左侧执行者目录树，右侧只读代码内容。
 *
 * 页面不提供编辑 / 保存入口；写入仍由 builder 工具完成。
 *
 */
export function FilesSection({
  t,
  worker,
  state,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
}): ReactElement {
  const { files, loadFiles, openFile } = state
  const tree = files.tree ?? []
  const loading = files.treeStatus === 'loading' || files.treeStatus === 'idle'
  const onOpen = (path: string) => openFile(worker, path)

  return h(
    'section',
    {
      className: 'buka-workers-section buka-workers-filesSection',
      'aria-busy': loading ? true : undefined,
    },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h(
        'div',
        { className: 'buka-workers-filesHeading' },
        h('h2', { className: 'buka-workers-sectionTitle' }, t('filesTitle')),
        h('p', { className: 'buka-workers-fieldHint' }, t('filesHint')),
      ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          className: 'buka-workers-toolbarButton',
          icon: loading
            ? h(StateDot, { state: 'ongoing', size: 13 })
            : h(IconRefreshOutlineRegular, { size: 13 }),
          disabled: loading,
          onClick: () => loadFiles(worker),
        },
        t('refresh'),
      ),
    ),
    worker.exists === false
      ? h(
          'p',
          { className: 'buka-workers-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h('span', null, t('missingDirDetail')),
        )
      : null,
    files.treeStatus === 'error'
      ? h(
          'p',
          { className: 'buka-workers-failure', role: 'alert' },
          `${t('filesLoadFailed')} ${files.treeError ?? ''}`,
        )
      : files.treeStatus === 'ready' && tree.length === 0
        ? h('p', { className: 'buka-workers-empty' }, t('filesEmpty'))
        : h(
            'div',
            { className: 'buka-workers-filesLayout' },
            h(
              'div',
              {
                className: 'buka-workers-fileTree',
                role: 'group',
                'aria-label': t('filesTreeAria'),
              },
              files.truncated
                ? h('p', { className: 'buka-workers-fieldHint' }, t('filesTruncated'))
                : null,
              loading && files.tree === null
                ? h(
                    'p',
                    { className: 'buka-workers-statusWithDot', role: 'status' },
                    h(StateDot, { state: 'ongoing' }),
                    t('loading'),
                  )
                : h(
                    'ul',
                    { className: 'buka-workers-fileTreeList' },
                    ...tree.map((node) =>
                      h(FileTreeNode, {
                        key: node.path,
                        node,
                        selectedPath: files.selectedPath,
                        onOpen,
                      }),
                    ),
                  ),
            ),
            h(FilePreview, { t, state }),
          ),
  )
}

/**
 * 「设置」页签：把名称、职责与模型收在同一个页面里。
 *
 * 三块都没有保存按钮：名称与职责写登记表，模型写新会话的模型选择；都按改动
 * 自动保存，失败的提示留在各自的区块里；进入页签时会预读模型目录。
 *
 */
export function SettingsSection({
  t,
  worker,
  state,
  detailActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: ReturnType<typeof createDetailActions>
}): ReactElement {
  return h(
    'div',
    { className: 'buka-workers-settings' },
    h(NameSection, { t, worker, state, detailActions }),
    h(DescriptionSection, { t, worker, state, detailActions }),
    h(ModelSection, { t, worker, state, detailActions }),
  )
}

/**
 * 「名称」区块：执行者的展示名（可选）。目录与工作区都按标识符定位，改名只改
 * 展示名；留空表示清空、展示时回退到标识符。
 *
 * 与职责、模型一样没有保存按钮：停止输入 500 ms 后自动保存，失焦立即保存。
 *
 */
export function NameSection({
  t,
  worker,
  state,
  detailActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: DetailActions
}): ReactElement {
  const { nameDraft, setNameDraft, nameSaving, nameError, setNameError } = state
  const { normalizedWorkerName, saveWorkerName } = detailActions
  const current = typeof worker.name === 'string' ? worker.name : ''
  const dirty = normalizedWorkerName(nameDraft) !== normalizedWorkerName(current)

  const pendingSave = React.useRef({ dirty: false, save: saveWorkerName })
  React.useEffect(() => {
    // 失败后不再自动重试：错误留在区块里，用户继续编辑（清掉错误）才重新保存。
    const pending = dirty && nameError === null
    pendingSave.current = { dirty: pending, save: saveWorkerName }
    if (!pending || nameSaving) return undefined
    const timer = setTimeout(() => void saveWorkerName(), 500)
    return () => clearTimeout(timer)
  }, [nameDraft, nameError, dirty, nameSaving])
  React.useEffect(
    () => () => {
      if (pendingSave.current.dirty) void pendingSave.current.save()
    },
    [],
  )

  return h(
    'section',
    { className: 'buka-workers-section', 'aria-busy': nameSaving ? true : undefined },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('nameLabel')),
      h(
        'span',
        { className: 'buka-workers-autosave', role: 'status', 'aria-live': 'polite' },
        nameSaving ? t('saving') : dirty ? t('autosavePending') : null,
      ),
    ),
    h('p', { className: 'buka-workers-fieldHint' }, t('nameHint')),
    h(Input, {
      className: 'buka-workers-fieldInput',
      type: 'text',
      value: nameDraft,
      placeholder: String(worker.id ?? ''),
      autoComplete: 'off',
      spellCheck: false,
      maxLength: WORKER_NAME_MAX_LENGTH,
      'aria-label': t('nameLabel'),
      onChange: (event: { target: { value: string } }) => {
        setNameError(null)
        setNameDraft(event.target.value)
      },
      onBlur: () => {
        if (dirty && !nameSaving && nameError === null) void saveWorkerName()
      },
    }),
    nameError === null
      ? null
      : h('p', { className: 'buka-workers-formError', role: 'alert' }, nameError),
  )
}

/**
 * 「描述」区块：一句话摘要。工作流通过 `buka_workers` 读这一行，决定是否把
 * 节点交给这个执行者。
 *
 * 没有保存按钮：停止输入后自动保存，失焦时立即保存；区块右上角只显示
 * 「保存中… / 待保存…」这类状态。
 *
 */
export function DescriptionSection({
  t,
  worker,
  state,
  detailActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: DetailActions
}): ReactElement {
  const {
    descriptionDraft,
    setDescriptionDraft,
    descriptionSaving,
    descriptionError,
    setDescriptionError,
  } = state
  const { normalizedDescription, saveDescription } = detailActions
  const current = typeof worker.description === 'string' ? worker.description : ''
  const dirty = normalizedDescription(descriptionDraft) !== current

  // 修改即保存：停止输入 700 ms 后写回登记表。保存结束后 `descriptionSaving`
  // 变化会再跑一次本 effect，把保存期间继续输入的内容补上。
  // 离开页签 / 切走执行者时把还挂着的改动落盘：卸载时定时器会被清掉，
  // 不能再等那 700 ms。ref 在每次渲染后的 effect 里更新，清理时读到最新值。
  const pendingSave = React.useRef({ dirty: false, save: saveDescription })
  React.useEffect(() => {
    // 失败后不再自动重试：错误留在区块里，用户继续编辑（清掉错误）才重新保存。
    const pending = dirty && descriptionError === null
    pendingSave.current = { dirty: pending, save: saveDescription }
    if (!pending || descriptionSaving) return undefined
    const timer = setTimeout(() => void saveDescription(), 700)
    return () => clearTimeout(timer)
  }, [descriptionDraft, descriptionError, dirty, descriptionSaving])
  React.useEffect(
    () => () => {
      if (pendingSave.current.dirty) void pendingSave.current.save()
    },
    [],
  )

  return h(
    'section',
    { className: 'buka-workers-section', 'aria-busy': descriptionSaving ? true : undefined },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('descriptionLabel')),
      h(
        'span',
        { className: 'buka-workers-autosave', role: 'status', 'aria-live': 'polite' },
        descriptionSaving ? t('saving') : dirty ? t('autosavePending') : null,
      ),
    ),
    h('p', { className: 'buka-workers-fieldHint' }, t('descriptionHint')),
    h('textarea', {
      className: 'buka-workers-descriptionInput is-tall',
      value: descriptionDraft,
      placeholder: t('descriptionPlaceholder'),
      maxLength: WORKER_DESCRIPTION_MAX_LENGTH,
      rows: 4,
      'aria-label': t('descriptionLabel'),
      onChange: (event: { target: { value: string } }) => {
        setDescriptionError(null)
        setDescriptionDraft(event.target.value)
      },
      onBlur: () => {
        if (dirty && !descriptionSaving && descriptionError === null) void saveDescription()
      },
    }),
    descriptionError === null
      ? null
      : h('p', { className: 'buka-workers-formError', role: 'alert' }, descriptionError),
  )
}

/**
 * 「模型」区块：给智能体选新会话使用的模型。
 *
 * 目录按需从 Host 读取；`modelDraft === null` 表示跟随宿主默认模型。没有保存
 * 按钮：选完就自动保存，只影响之后新开的会话，已有会话保留自己的模型（可在
 * 会话里用 `/model` 切换）。
 *
 */
export function ModelSection({
  t,
  worker,
  state,
  detailActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: DetailActions
}): ReactElement {
  const {
    modelCatalog,
    modelDraft,
    setModelDraft,
    modelSaving,
    modelError,
    setModelError,
    loadModelCatalog,
  } = state
  const { saveWorkerModel } = detailActions
  const catalog = modelCatalog.data
  const available = catalog?.available === true
  const groups = catalog?.groups ?? []

  const currentGroup =
    modelDraft === null ? undefined : groups.find((group) => group.id === modelDraft.provider)
  const currentModel =
    modelDraft === null || currentGroup === undefined
      ? undefined
      : currentGroup.models.find((model) => model.id === modelDraft.model)
  const savedEffort = modelDraft?.reasoningEffort
  const efforts = currentModel?.reasoning?.efforts ?? []
  const effortKnown =
    savedEffort === undefined || efforts.some((effort) => effort.id === savedEffort)
  const showEffort = efforts.length > 0 || savedEffort !== undefined
  const savedSelection = worker.model ?? null
  const dirty =
    modelDraft === null || savedSelection === null
      ? modelDraft !== savedSelection
      : modelDraft.provider !== savedSelection.provider ||
        modelDraft.model !== savedSelection.model ||
        (modelDraft.reasoningEffort ?? '') !== (savedSelection.reasoningEffort ?? '')

  // 修改即保存：选择落定 250 ms 后写回登记表；连续切换（改提供方会连带换
  // 模型）只发最后这一次。保存期间再改，effect 会在保存结束后再跑一遍。
  // 与职责一样：切页签 / 切执行者时立即落盘，不在卸载时丢掉刚选中的模型。
  const pendingSave = React.useRef({ dirty: false, save: saveWorkerModel })
  React.useEffect(() => {
    // 失败后不再自动重试：错误留在区块里，用户重新选择（清掉错误）才再保存。
    const pending = dirty && modelError === null
    pendingSave.current = { dirty: pending, save: saveWorkerModel }
    if (!pending || modelSaving) return undefined
    const timer = setTimeout(() => void saveWorkerModel(), 250)
    return () => clearTimeout(timer)
  }, [modelDraft, dirty, modelError, modelSaving])
  React.useEffect(
    () => () => {
      if (pendingSave.current.dirty) void pendingSave.current.save()
    },
    [],
  )

  /** 模型选择的展示名：目录里有就用名称，否则退回 provider / model id。 */
  function labelFor(selection: WorkerModelSelection): string {
    const group = groups.find((entry) => entry.id === selection.provider)
    const model = group?.models.find((entry) => entry.id === selection.model)
    return model === undefined || group === undefined
      ? `${selection.provider} / ${selection.model}`
      : `${group.name} · ${model.name}`
  }

  function pickProvider(providerId: string) {
    setModelError(null)
    if (providerId === '') {
      setModelDraft(null)
      return
    }
    const group = groups.find((entry) => entry.id === providerId)
    const first = group?.models[0]
    setModelDraft({ provider: providerId, model: first?.id ?? '' })
  }

  function pickModel(modelId: string) {
    setModelError(null)
    if (modelDraft === null) return
    setModelDraft({ provider: modelDraft.provider, model: modelId })
  }

  function pickEffort(effortId: string) {
    setModelError(null)
    if (modelDraft === null) return
    setModelDraft({
      provider: modelDraft.provider,
      model: modelDraft.model,
      ...(effortId === '' ? {} : { reasoningEffort: effortId }),
    })
  }

  const providerOptions = [
    h('option', { key: 'default', value: '' }, t('modelFollowDefault')),
    ...groups.map((group) => h('option', { key: group.id, value: group.id }, group.name)),
  ]
  if (modelDraft !== null && currentGroup === undefined) {
    providerOptions.push(
      h(
        'option',
        { key: `saved:${modelDraft.provider}`, value: modelDraft.provider },
        `${modelDraft.provider} / ${modelDraft.model}`,
      ),
    )
  }

  const modelOptions =
    modelDraft === null || currentGroup === undefined
      ? []
      : [
          ...currentGroup.models.map((model) =>
            h('option', { key: model.id, value: model.id }, model.name),
          ),
        ]
  if (modelDraft !== null && currentModel === undefined) {
    modelOptions.push(
      h('option', { key: `saved:${modelDraft.model}`, value: modelDraft.model }, modelDraft.model),
    )
  }

  const effortOptions = [
    h('option', { key: 'default', value: '' }, t('modelEffortDefault')),
    ...efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, effort.name)),
  ]
  if (modelDraft !== null && savedEffort !== undefined && !effortKnown) {
    effortOptions.push(
      h('option', { key: `saved:${savedEffort}`, value: savedEffort }, savedEffort),
    )
  }

  return h(
    'section',
    { className: 'buka-workers-modelSection' },
    h(
      'div',
      { className: 'buka-workers-sectionHead' },
      h('h2', { className: 'buka-workers-sectionTitle' }, t('modelTitle')),
      h(
        'span',
        { className: 'buka-workers-autosave', role: 'status', 'aria-live': 'polite' },
        modelSaving ? t('saving') : dirty ? t('autosavePending') : null,
      ),
    ),
    h('p', { className: 'buka-workers-fieldHint' }, t('modelHint')),
    modelCatalog.status === 'loading' && catalog === null
      ? h('p', { className: 'buka-workers-fieldHint', role: 'status' }, t('loading'))
      : null,
    modelCatalog.status === 'error'
      ? h(
          'p',
          { className: 'buka-workers-formError', role: 'alert' },
          `${t('modelLoadFailed')} ${modelCatalog.error ?? ''}`,
        )
      : null,
    catalog !== null && !available
      ? h('p', { className: 'buka-workers-notice', role: 'status' }, t('modelUnavailable'))
      : null,
    available && groups.length === 0
      ? h('p', { className: 'buka-workers-notice', role: 'status' }, t('modelEmpty'))
      : null,
    catalog !== null && catalog.failures.length > 0
      ? h(
          'p',
          { className: 'buka-workers-hint' },
          `${t('modelSomeFailed')} ${catalog.failures.map((failure) => failure.name).join('、')}`,
        )
      : null,
    available
      ? [
          h(
            'label',
            { key: 'provider', className: 'buka-workers-field' },
            h('span', { className: 'buka-workers-fieldLabel' }, t('modelProvider')),
            h(
              'select',
              {
                className: 'buka-workers-select',
                value: modelDraft?.provider ?? '',
                'aria-label': t('modelProvider'),
                onChange: (event: { target: { value: string } }) =>
                  pickProvider(event.target.value),
              },
              ...providerOptions,
            ),
          ),
          modelDraft === null
            ? null
            : h(
                'label',
                { key: 'model', className: 'buka-workers-field' },
                h('span', { className: 'buka-workers-fieldLabel' }, t('modelModelLabel')),
                h(
                  'select',
                  {
                    className: 'buka-workers-select',
                    value: modelDraft.model,
                    'aria-label': t('modelModelLabel'),
                    onChange: (event: { target: { value: string } }) =>
                      pickModel(event.target.value),
                  },
                  ...modelOptions,
                ),
              ),
          modelDraft === null || !showEffort
            ? null
            : h(
                'label',
                { key: 'effort', className: 'buka-workers-field' },
                h('span', { className: 'buka-workers-fieldLabel' }, t('modelEffort')),
                h(
                  'select',
                  {
                    className: 'buka-workers-select',
                    value: savedEffort ?? '',
                    'aria-label': t('modelEffort'),
                    onChange: (event: { target: { value: string } }) =>
                      pickEffort(event.target.value),
                  },
                  ...effortOptions,
                ),
              ),
          h(
            'p',
            { key: 'current', className: 'buka-workers-fieldHint' },
            modelDraft === null
              ? t('modelFollowDefaultHint')
              : `${t('modelCurrent')} ${labelFor(modelDraft)}`,
          ),
          modelError === null
            ? null
            : h(
                'p',
                { key: 'error', className: 'buka-workers-formError', role: 'alert' },
                modelError,
              ),
          h(
            'div',
            { key: 'actions', className: 'buka-workers-formActions' },
            h(
              Button,
              {
                variant: 'ghost',
                size: 'sm',
                disabled: modelSaving,
                onClick: () => loadModelCatalog(true),
              },
              t('refresh'),
            ),
          ),
        ]
      : null,
  )
}

/**
 * 配置视图：缺目录提示 + 页签面板（设置 / 文件 / 技能）。
 *
 */
export function WorkerDetail({
  t,
  worker,
  state,
  detailActions,
  skillActions,
}: {
  t: Translate
  worker: Worker
  state: WorkersPageState
  detailActions: DetailActions
  skillActions: SkillActions
}): ReactElement {
  const { tab } = state
  const activeTab = TABS.find((one) => one.value === tab) ?? TABS[0]

  // 进入详情页就自动探测「技能」更新（只读，不写 lockfile）：页签上的小圆点
  // 与页签内的行内状态共用同一份结果，用户不点进「技能」也能看到有更新。
  // 只在执行者变化时触发；安装 / 删除 / 更新后由动作再检查一次。
  React.useEffect(() => {
    void skillActions.checkWorkerSkills(worker)
  }, [worker.id])

  return h(
    'div',
    { className: 'buka-workers-pageBody buka-workers-detail' },
    worker.exists === false
      ? h(
          'p',
          { className: 'buka-workers-notice', role: 'status' },
          h(IconWarningOutlineRegular, { size: 16 }),
          h('span', null, t('missingDirDetail')),
        )
      : null,
    h(
      'div',
      {
        className: 'buka-workers-panel',
        role: 'tabpanel',
        id: activeTab.panelId,
        'aria-labelledby': activeTab.id,
      },
      tab === 'skills'
        ? h(SkillsSection, { t, worker, state, skillActions })
        : tab === 'files'
          ? h(FilesSection, { t, worker, state })
          : h(SettingsSection, { t, worker, state, detailActions }),
    ),
  )
}
