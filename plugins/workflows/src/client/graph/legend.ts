/**
 * 节点图例：节点类型、节点状态与连线。
 */

import type React from 'react'
import { h } from '../element.ts'
import { typeLabel } from '../node-model.ts'
import type { PageContext } from '../page-context.ts'

/**
 * 图例：节点类型（胶囊颜色）、节点状态（胶囊左侧圆点）与连线。模板页没有执行状态，
 * 传入 `{ states: false }` 时省略「节点状态」一组；连线也不再区分「已走过 / 未走过」，
 * 只留一条「流程走向」的实线样例。
 *
 * @param [options]
 * @returns React 元素
 */
export function renderLegend(
  page: PageContext,
  options: { states?: boolean | undefined } = {},
): React.ReactElement {
  const { t } = page

  const states = [
    ['done', t('legendDone')],
    ['running', t('legendRunning')],
    ['waiting', t('legendWaiting')],
    ['failed', t('legendFailed')],
    ['idle', t('legendIdle')],
  ]
  return h(
    'div',
    { className: 'buka-workflows-legend' },
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
      h('span', { className: 'buka-workflows-legendTitle' }, t('legendTypes')),
      ...['start', 'robot', 'user', 'join', 'end'].map((type) =>
        h(
          'span',
          { key: type, className: 'buka-workflows-legendItem' },
          h('span', {
            className: `buka-workflows-legendCapsule is-${type}`,
            'aria-hidden': true,
          }),
          typeLabel(t, type),
        ),
      ),
    ),
    options.states === false
      ? null
      : h(
          'span',
          { className: 'buka-workflows-legendGroup' },
          h('span', { className: 'buka-workflows-legendTitle' }, t('legendStates')),
          ...states.map(([kind, label]) =>
            h(
              'span',
              { key: kind, className: 'buka-workflows-legendItem' },
              h('span', {
                className: `buka-workflows-legendDot is-${kind}`,
                'aria-hidden': true,
              }),
              label,
            ),
          ),
        ),
    h(
      'span',
      { className: 'buka-workflows-legendGroup' },
      h('span', { className: 'buka-workflows-legendTitle' }, t('legendEdges')),
      ...(options.states === false
        ? [
            // 模板没有「已走过 / 未走过」：连线只表达参考流程的走向。
            h(
              'span',
              { key: 'flow', className: 'buka-workflows-legendItem' },
              h('span', {
                className: 'buka-workflows-legendLine is-static',
                'aria-hidden': true,
              }),
              t('legendFlow'),
            ),
          ]
        : ['traversed', ''].map((kind, index) => {
            const labels = [t('legendTraversed'), t('legendPending')]
            return h(
              'span',
              { key: `${kind || 'pending'}-${index}`, className: 'buka-workflows-legendItem' },
              h('span', {
                className: `buka-workflows-legendLine${kind === '' ? '' : ` is-${kind}`}`,
                'aria-hidden': true,
              }),
              labels[index],
            )
          })),
    ),
  )
}
