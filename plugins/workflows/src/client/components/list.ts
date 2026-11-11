/**
 * 运行列表视图。
 */

import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type React from 'react'
import { h } from '../element.ts'
import { formatTime, statusLabel, statusTone } from '../format.ts'
import type { PageContext } from '../page-context.ts'

/**
 * 列表视图。
 *
 * @returns React 元素
 */
export function renderList(page: PageContext): React.ReactElement {
  const { t, list, setSelectedId, showArchived } = page

  if (list.error !== null && list.runs.length === 0) {
    return h(
      'div',
      { className: 'buka-workflows-listPane' },
      h(
        'p',
        { className: 'buka-workflows-failure', role: 'alert' },
        `${t('loadFailed')} ${list.error}`,
      ),
    )
  }
  if (list.status === 'loading' && list.runs.length === 0) {
    return h(
      'div',
      { className: 'buka-workflows-listPane' },
      h(
        'p',
        { className: 'buka-workflows-statusWithDot', role: 'status' },
        h(StateDot, { state: 'ongoing' }),
        t('loading'),
      ),
    )
  }
  if (list.runs.length === 0) {
    return h(
      'div',
      { className: 'buka-workflows-listPane' },
      h(
        'div',
        { className: 'buka-workflows-emptyBox' },
        h(
          'p',
          { className: 'buka-workflows-empty' },
          showArchived ? t('archiveEmpty') : t('welcome'),
        ),
        showArchived ? null : h('p', { className: 'buka-workflows-hint' }, t('welcomeHint')),
      ),
    )
  }
  return h(
    'div',
    { className: 'buka-workflows-listPane' },
    h(
      'ul',
      { className: 'buka-workflows-cards' },
      ...list.runs.map((run) =>
        h(
          'li',
          { key: run.runId },
          h(
            'button',
            {
              type: 'button',
              className: 'buka-workflows-card',
              onClick: () => setSelectedId(run.runId),
            },
            h(
              'span',
              { className: 'buka-workflows-cardHead' },
              h(
                'span',
                { className: 'buka-workflows-cardTitleGroup' },
                typeof run.seq === 'number'
                  ? h('span', { className: 'buka-workflows-seq' }, `#${run.seq}`)
                  : null,
                h('span', { className: 'buka-workflows-cardTitle' }, run.goal || run.runId),
              ),
              h(
                'span',
                { className: 'buka-workflows-cardTags' },
                typeof run.archivedAt === 'number'
                  ? h(Tag, { tone: 'neutral' }, t('archived'))
                  : null,
                run.waitingForUser === true
                  ? h(Tag, { tone: 'warning' }, t('waitingForUser'))
                  : null,
                h(Tag, { tone: statusTone(run.status) }, statusLabel(t, run.status)),
              ),
            ),
            h(
              'span',
              { className: 'buka-workflows-meta' },
              `${run.runId} · ${formatTime(run.createdAt)}${
                typeof run.error === 'string' && run.error !== '' ? ` · ${run.error}` : ''
              }`,
            ),
          ),
        ),
      ),
    ),
  )
}
