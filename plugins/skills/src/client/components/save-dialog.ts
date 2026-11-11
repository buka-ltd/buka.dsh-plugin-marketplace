/**
 * 「收藏仓库」对话框：仓库必填、备注可选；提交失败留在框里提示，
 * 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
 *
 * @module @buka/dsh-plugin-skills/client/components/save-dialog
 */

import type {
  ChangeEvent,
  ComponentProps,
  Dispatch,
  FormEvent,
  ReactElement,
  SetStateAction,
} from 'react'
import { Fragment } from 'react'

import { SAVE_FORM_ID } from '../constants.ts'
import type { Translate } from '../dictionary.ts'
import { Button, h, IconBranchOutlineRegular, Input, Modal } from '../primitives.ts'

/** 收藏对话框需要的页面状态与动作。 */
export interface SaveDialogProps {
  /** 翻译函数。 */
  readonly t: Translate
  /** 对话框是否打开。 */
  readonly dialogOpen: boolean
  /** 关闭对话框（提交中不响应）。 */
  readonly closeSaveDialog: () => void
  /** 是否正在提交。 */
  readonly adding: boolean
  /** 仓库输入框的值。 */
  readonly source: string
  /** 修改仓库输入框。 */
  readonly setSource: Dispatch<SetStateAction<string>>
  /** 备注输入框的值。 */
  readonly note: string
  /** 修改备注输入框。 */
  readonly setNote: Dispatch<SetStateAction<string>>
  /** 对话框里的失败提示。 */
  readonly addError: string | null
  /** 提交表单。 */
  readonly addRepo: (event: FormEvent<HTMLFormElement>) => Promise<void>
}

/**
 * 收藏对话框里「仓库」输入框的 props。
 *
 * `data-modal-autofocus` 是 Modal 的焦点约定；Input 的类型没有声明 data-* 属性，
 * 单独抽成变量再传给 `h(Input, …)`，避免对象字面量的多余属性检查。
 */
function sourceInputProps(
  placeholder: string,
  value: string,
  disabled: boolean,
  onChange: (value: string) => void,
): ComponentProps<typeof Input> & { readonly 'data-modal-autofocus': string } {
  return {
    className: 'buka-skills-fieldInput',
    type: 'text',
    value,
    placeholder,
    autoComplete: 'off',
    spellCheck: false,
    disabled,
    'data-modal-autofocus': '',
    icon: h(IconBranchOutlineRegular, { size: 16 }),
    onChange: (event) => onChange(event.target.value),
  }
}

/**
 * 「收藏」对话框：仓库必填、备注可选；提交失败留在框里提示，
 * 提交中不响应关闭（遮罩点击 / Esc / 右上角都走 onClose）。
 *
 * @param props 页面状态与动作
 */
function renderSaveDialog(props: SaveDialogProps): ReactElement {
  const {
    t,
    dialogOpen,
    closeSaveDialog,
    adding,
    source,
    setSource,
    note,
    setNote,
    addError,
    addRepo,
  } = props

  return h(
    Modal,
    {
      open: dialogOpen,
      onClose: closeSaveDialog,
      title: t('dialogTitle'),
      closeLabel: t('close'),
      footer: h(
        Fragment,
        null,
        h(Button, { variant: 'outline', onClick: closeSaveDialog, disabled: adding }, t('cancel')),
        h(
          Button,
          {
            variant: 'primary',
            type: 'submit',
            form: SAVE_FORM_ID,
            disabled: adding || source.trim() === '',
          },
          adding ? t('adding') : t('add'),
        ),
      ),
    },
    h(
      'form',
      { id: SAVE_FORM_ID, className: 'buka-skills-saveForm', onSubmit: addRepo },
      h(
        'label',
        { className: 'buka-skills-field' },
        h('span', { className: 'buka-skills-fieldLabel' }, t('fieldSource')),
        h(
          Input,
          sourceInputProps(t('addPlaceholder'), source, adding, (value) => setSource(value)),
        ),
      ),
      h(
        'label',
        { className: 'buka-skills-field' },
        h('span', { className: 'buka-skills-fieldLabel' }, t('fieldNote')),
        h(Input, {
          className: 'buka-skills-fieldInput',
          type: 'text',
          value: note,
          placeholder: t('notePlaceholder'),
          autoComplete: 'off',
          spellCheck: false,
          maxLength: 200,
          disabled: adding,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setNote(event.target.value),
        }),
      ),
      addError === null
        ? null
        : h('p', { className: 'buka-skills-formError', role: 'alert' }, addError),
    ),
  )
}

export { renderSaveDialog }
