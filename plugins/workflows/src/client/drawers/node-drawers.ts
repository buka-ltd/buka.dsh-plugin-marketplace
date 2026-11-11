/**
 * 运行 / 模板详情的节点抽屉外壳。
 */

import type React from 'react'
import { ClientModal, h } from '../element.ts'
import type { PageContext } from '../page-context.ts'

/** 关闭运行详情的节点抽屉。 */
export function closeRunNodeDrawer(page: PageContext): void {
  const { setSelectedNodeId, setExecutionIndex } = page

  setSelectedNodeId(null)
  setExecutionIndex(null)
}

/** 关闭模板详情的节点抽屉。 */
export function closeTemplateNodeDrawer(page: PageContext): void {
  const { setSelectedTemplateNodeId } = page

  setSelectedTemplateNodeId(null)
}

/**
 * 运行详情的节点抽屉：内容沿用原来的节点面板，关闭按钮放到面板标题行。
 *
 * @returns
 */
export function renderRunNodeDrawer(page: PageContext): React.ReactElement | null {
  const {
    t,
    selectedId,
    selectedNodeId,
    capsuleText,
    renderNodePanel,
    runDetailModel,
    closeRunNodeDrawer,
  } = page

  if (selectedId === null || selectedNodeId === null) return null
  const model = runDetailModel()
  if (model === null) return null
  const node = model.nodes.find((item) => item.id === selectedNodeId) ?? null
  if (node === null) return null
  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: closeRunNodeDrawer,
      title: capsuleText(node),
      closeLabel: t('close'),
      backdropBlur: false,
      className: 'buka-workflows-drawer buka-workflows-nodeDrawer',
    },
    h(
      'div',
      { className: 'buka-workflows-drawerBody' },
      renderNodePanel(
        node,
        model.definition,
        model.graph,
        model.steps,
        model.fullResults,
        model.run,
        closeRunNodeDrawer,
      ),
    ),
  )
}

/**
 * 模板详情的节点抽屉。
 *
 * @returns
 */
export function renderTemplateNodeDrawer(page: PageContext): React.ReactElement | null {
  const {
    t,
    selectedTemplateId,
    selectedTemplateNodeId,
    templateNodeLabel,
    renderTemplateNodePanel,
    templateDetailModel,
    closeTemplateNodeDrawer,
  } = page

  if (selectedTemplateId === null || selectedTemplateNodeId === null) return null
  const model = templateDetailModel()
  if (model === null) return null
  const node = model.nodes.find((item) => item.id === selectedTemplateNodeId) ?? null
  if (node === null) return null
  return h(
    ClientModal,
    {
      open: true,
      headless: true,
      onClose: closeTemplateNodeDrawer,
      title: templateNodeLabel(node),
      closeLabel: t('close'),
      backdropBlur: false,
      className: 'buka-workflows-drawer buka-workflows-nodeDrawer',
    },
    h(
      'div',
      { className: 'buka-workflows-drawerBody' },
      renderTemplateNodePanel(node, model.template, closeTemplateNodeDrawer),
    ),
  )
}
