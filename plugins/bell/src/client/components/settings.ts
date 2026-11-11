/**
 * 设置页的提示音表单与两级页面组件。
 *
 * @module @buka/dsh-plugin-bell/client/settings
 */

import React from 'react'
import type { ConfigFormSnapshot } from '../../../../../types/dsh.js'
import type { Translate } from '../dictionaries.ts'
import { previewSound } from '../preview.ts'

/** 与 Host 侧 `SILENT` 一致：设置页的「无」选项值。 */
const NONE = 'none'

/** 四个提示时机；顺序与设置页一致。 */
const FIELDS = ['finish', 'wait', 'plan', 'abort'] as const

/** 一个提示时机。 */
export type Field = (typeof FIELDS)[number]

/** 与 Host 侧 `SYSTEM_SOUNDS` 保持一致的可选声音。 */
const SOUNDS = [
  'Basso',
  'Blow',
  'Bottle',
  'Frog',
  'Funk',
  'Glass',
  'Hero',
  'Morse',
  'Ping',
  'Pop',
  'Purr',
  'Sosumi',
  'Submarine',
  'Tink',
] as const

/**
 * 与 Host 侧 `CUSTOM_SOUNDS` 保持一致的插件自带音频候选。
 * `value` 是写进配置的值，`label` 是候选行里显示的文案（梗语音的原文，
 * 中英文页面都显示同一句）。
 */
const CUSTOM_SOUNDS = [{ value: 'ikun', label: '你干嘛~哎哟' }] as const

/** 一个可试听的候选。 */
interface SoundOption {
  readonly value: string
  readonly label: string
}

/** 全部可试听的候选：自带音频在前，系统声音在后（「无」不试听）。 */
const PREVIEWABLE: readonly SoundOption[] = [
  ...CUSTOM_SOUNDS,
  ...SOUNDS.map((name) => ({ value: name, label: name })),
]

/** 表单快照的读取钩子：与 shell 的 `useSyncExternalStore` 绑定方式一致。 */
type UseForm = <T>(selector: (snapshot: ConfigFormSnapshot) => T) => T

/** 声音列表页里的完整选项：「无」在最前，然后是所有能试听的候选。 */
const PICKER_OPTIONS: readonly SoundOption[] = [{ value: NONE, label: '' }, ...PREVIEWABLE]

/** 设置页注入给组件的 props。 */
interface BellSettingsProps {
  readonly t: Translate
  readonly useBellForm: UseForm
  readonly setSound: (field: Field, value: string) => boolean | Promise<boolean>
}

/**
 * 设置页的提示音表单：两级页面。
 *
 * 第一级是四行（任务结束 / 等待输入 / 计划被退回 / 手动终止），行上显示
 * 当前声音；点一行整页进入该时机的**声音列表页**。第二级里点一项就同时
 * 选中并试听（写配置 + 请求 Host 播一次），不自动返回；点「返回」才回到
 * 四行页面，可以连着听几个再定。
 */
export function BellSettings({ t, useBellForm, setSound }: BellSettingsProps): React.ReactElement {
  // 稳定 selector：快照原样返回，避免每次渲染换新函数导致重复订阅。
  const state = useBellForm((snapshot) => snapshot)
  const [failed, setFailed] = React.useState(false)
  const [view, setView] = React.useState<Field | null>(null)
  const [previewFailed, setPreviewFailed] = React.useState(false)

  const ready = state.status === 'ready' && state.value !== undefined && state.writable !== false

  /** 某个时机当前选中的值；配置还没就绪时按「无」显示。 */
  const current = (field: Field): string => (ready ? (state.value?.[field] ?? NONE) : NONE)

  /** 配置值 → 展示文案。自带音频与系统声音用手写文案，未知值原样显示。 */
  const labelOf = (value: string): string => {
    if (value === NONE) return t('none')
    const found = PREVIEWABLE.find((sound) => sound.value === value)
    return found === undefined ? value : found.label
  }

  /** 试听一个候选：只播一次；失败时在列表底部提示。 */
  const preview = (sound: string): void => {
    setPreviewFailed(false)
    void Promise.resolve(previewSound(sound)).then(undefined, () => setPreviewFailed(true))
  }

  /** 列表里点一项 = 选中 + 试听；不自动返回，方便连着听几个再定。 */
  const choose = (field: Field, value: string): void => {
    setFailed(false)
    setPreviewFailed(false)
    if (value !== NONE) preview(value)
    void Promise.resolve(setSound(field, value)).then(
      (saved) => {
        if (saved === false) setFailed(true)
      },
      () => setFailed(true),
    )
  }

  /** 返回四行页面，顺手清掉试听错误。 */
  const back = (): void => {
    setView(null)
    setPreviewFailed(false)
  }

  // 第二级：某个时机的独立声音列表页，整页替换掉四行。
  if (view !== null) {
    const field = view
    return React.createElement(
      'section',
      { className: 'buka-bell-section' },
      React.createElement(
        'button',
        { type: 'button', className: 'buka-bell-back', onClick: back },
        `← ${t('back')}`,
      ),
      React.createElement('h2', { className: 'buka-bell-heading' }, t(field)),
      React.createElement('p', { className: 'buka-bell-intro' }, t('pickHint')),
      ready
        ? null
        : React.createElement(
            'p',
            { className: 'buka-bell-muted' },
            t(state.status === 'unavailable' ? 'unavailable' : 'loading'),
          ),
      React.createElement(
        'div',
        { className: 'buka-bell-soundList' },
        ...PICKER_OPTIONS.map((option) => {
          const picked = current(field) === option.value
          return React.createElement(
            'label',
            {
              className: 'buka-bell-soundRow',
              key: option.value,
              'data-checked': picked ? 'true' : undefined,
              'data-disabled': ready ? undefined : 'true',
            },
            React.createElement('input', {
              type: 'radio',
              className: 'buka-bell-radio',
              name: `buka-bell-sound-${field}`,
              value: option.value,
              checked: picked,
              disabled: !ready,
              // 已选中的 radio 再点不会触发 change，这里补一次试听，方便反复听；
              // 点 label 也会激活 input，事件只到这里一次，不会重复播。
              onClick: () => {
                if (picked && option.value !== NONE) preview(option.value)
              },
              onChange: () => choose(field, option.value),
            }),
            React.createElement(
              'span',
              { className: 'buka-bell-soundName' },
              labelOf(option.value),
            ),
          )
        }),
      ),
      failed
        ? React.createElement('p', { className: 'buka-bell-error', role: 'alert' }, t('saveFailed'))
        : null,
      previewFailed
        ? React.createElement(
            'p',
            { className: 'buka-bell-error', role: 'alert' },
            t('previewFailed'),
          )
        : null,
    )
  }

  // 第一级：四个时机，点一行进入它的声音列表页。
  const rows = FIELDS.map((field) =>
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'buka-bell-row',
        key: field,
        disabled: !ready,
        'aria-label': `${t(field)}：${labelOf(current(field))}`,
        onClick: () => {
          setFailed(false)
          setPreviewFailed(false)
          setView(field)
        },
      },
      React.createElement('span', { className: 'buka-bell-label' }, t(field)),
      React.createElement('span', { className: 'buka-bell-rowValue' }, labelOf(current(field))),
      React.createElement(
        'span',
        { className: 'buka-bell-rowChevron', 'aria-hidden': 'true' },
        '›',
      ),
    ),
  )

  return React.createElement(
    'section',
    { className: 'buka-bell-section' },
    React.createElement('h2', { className: 'buka-bell-heading' }, t('title')),
    React.createElement('p', { className: 'buka-bell-intro' }, t('intro')),
    ready
      ? null
      : React.createElement(
          'p',
          { className: 'buka-bell-muted' },
          t(state.status === 'unavailable' ? 'unavailable' : 'loading'),
        ),
    React.createElement('div', { className: 'buka-bell-rows' }, ...rows),
    failed
      ? React.createElement('p', { className: 'buka-bell-error', role: 'alert' }, t('saveFailed'))
      : null,
  )
}
