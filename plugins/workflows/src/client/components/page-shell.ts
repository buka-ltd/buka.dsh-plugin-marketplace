/**
 * 页面外壳：页签、工具栏、内容区、页脚、抽屉与 Toast。
 */

import {
  Button,
  IconChevronRightOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconRefreshOutlineRegular,
  IconSettingsOutlineRegular,
  IconWarningOutlineRegular,
  SegmentedTabs,
  Tag,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { h } from '../element.ts'
import { statusLabel, statusTone } from '../format.ts'
import { edgeTipPosition } from '../graph/geometry.ts'
import type { PageContext } from '../page-context.ts'
import type { ClientView } from '../types.ts'

export function renderPage(page: PageContext): React.ReactElement {
  const {
    t,
    list,
    selectedId,
    detail,
    templates,
    showArchived,
    setShowArchived,
    reload,
    notice,
    setNotice,
    edgeTip,
    view,
    switchView,
    selectedTemplateId,
    openSettingsDialog,
    renderList,
    renderDetail,
    renderTemplatesList,
    renderTemplateDetail,
    renderFooter,
    renderSettingsDialog,
    renderAttachmentDrawer,
    renderRunNodeDrawer,
    renderTemplateNodeDrawer,
    renderEdgeDrawer,
  } = page

  const selectedRun = selectedId !== null ? (detail.data?.run ?? null) : null
  const inTemplates = view === 'templates'
  const inTemplateDetail = inTemplates && selectedTemplateId !== null
  const selectedTemplate = inTemplateDetail
    ? (templates.items.find((item) => item.id === selectedTemplateId) ?? null)
    : null

  return h(
    'div',
    { className: 'buka-workflows-page' },
    h(
      'header',
      { className: 'buka-workflows-head' },
      h(
        'div',
        { className: 'buka-workflows-headInner' },
        h(
          'div',
          { className: 'buka-workflows-titleRow' },
          h(
            'div',
            { className: 'buka-workflows-tabbar' },
            h(SegmentedTabs, {
              size: 'sm',
              className: 'buka-workflows-tabList',
              label: t('tabsLabel'),
              value: view,
              onChange: (value: string) => switchView(value as ClientView),
              items: [
                {
                  value: 'runs',
                  label: t('runsTab'),
                  id: 'buka-workflows-tab-runs',
                  panelId: 'buka-workflows-panel-runs',
                },
                {
                  value: 'templates',
                  label: t('templatesTab'),
                  id: 'buka-workflows-tab-templates',
                  panelId: 'buka-workflows-panel-templates',
                },
              ],
            }),
          ),
          h(
            'div',
            { className: 'buka-workflows-toolbar' },
            ...(inTemplates
              ? selectedTemplate === null
                ? []
                : [h('code', { className: 'buka-workflows-inlineCode' }, selectedTemplate.id)]
              : selectedId === null
                ? [
                    showArchived
                      ? h(
                          Button,
                          {
                            variant: 'outline',
                            size: 'sm',
                            className: 'buka-workflows-toolbarButton buka-workflows-back',
                            icon: h(IconChevronRightOutlineRegular, { size: 13 }),
                            onClick: () => setShowArchived(false),
                          },
                          t('archiveBack'),
                        )
                      : h(
                          Button,
                          {
                            variant: 'outline',
                            size: 'sm',
                            className: 'buka-workflows-toolbarButton',
                            icon: h(IconFolderOpenOutlineRegular, { size: 13 }),
                            onClick: () => setShowArchived(true),
                          },
                          list.archivedCount > 0
                            ? `${t('archiveView')} (${list.archivedCount})`
                            : t('archiveView'),
                        ),
                    h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'sm',
                        className: 'buka-workflows-toolbarButton',
                        icon: h(IconSettingsOutlineRegular, { size: 13 }),
                        onClick: openSettingsDialog,
                      },
                      t('settings'),
                    ),
                  ]
                : [
                    typeof selectedRun?.archivedAt === 'number'
                      ? h(Tag, { tone: 'neutral' }, t('archived'))
                      : null,
                    h(
                      'code',
                      { className: 'buka-workflows-inlineCode' },
                      selectedRun?.runId ?? selectedId,
                    ),
                    h(
                      Tag,
                      { tone: statusTone(selectedRun?.status ?? '') },
                      statusLabel(t, selectedRun?.status ?? ''),
                    ),
                  ]),
            ...(inTemplates
              ? []
              : [
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      className: 'buka-workflows-toolbarButton',
                      icon: h(IconRefreshOutlineRegular, { size: 13 }),
                      onClick: reload,
                    },
                    t('refresh'),
                  ),
                ]),
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'buka-workflows-body' },
      inTemplates
        ? selectedTemplateId === null
          ? renderTemplatesList()
          : renderTemplateDetail()
        : selectedId === null
          ? renderList()
          : renderDetail(),
    ),
    inTemplateDetail
      ? renderFooter(false)
      : !inTemplates && selectedId !== null
        ? renderFooter()
        : null,
    renderSettingsDialog(),
    renderRunNodeDrawer(),
    renderTemplateNodeDrawer(),
    renderEdgeDrawer(),
    renderAttachmentDrawer(),
    notice === null
      ? null
      : h(Toast, {
          key: notice.seq,
          text: notice.text,
          ...(notice.kind === 'success' ? { tone: 'success' as const } : {}),
          ...(notice.kind === 'success' ? {} : { icon: h(IconWarningOutlineRegular, {}) }),
          holdMs: 3200,
          onDone: () => setNotice(null),
        }),
    edgeTip === null
      ? null
      : h(
          'div',
          {
            className: `buka-workflows-edgeTip${edgeTip.anchor ? ' is-anchored' : ''}`,
            role: 'tooltip',
            style: edgeTipPosition(edgeTip),
          },
          edgeTip.text,
        ),
  )
}
