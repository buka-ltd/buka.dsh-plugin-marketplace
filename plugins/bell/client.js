/**
 * `@buka/dsh-plugin-bell` 的浏览器一半：在 设置 → 提示音 里选四个声音。
 *
 * 页面本身不保存任何状态：读写都走 DSH 的设置表单服务 `ctx.configForms`
 * （Host 设置的浏览器镜像）。交互是两级的：设置页是四行，点一行进入该时机的
 * **独立声音列表页**；列表里点一项就同时「选中 + 试听」——写入配置并请求
 * Host 播放一次（`POST /buka-bell/preview`），不自动返回，只有点「返回」才
 * 回到四行页面，方便连着听几个再定。「无」表示那个时机不响。
 *
 * 不用 Modal、也不在行内展开：设置本身就是浮层，再叠一层弹窗或撑开页面都
 * 破坏操作预期；整页替换成列表最简单，也最像「进入一个页面」。
 *
 * 客户端模块格式固定为 `window.__ModuleLoader__.load({ id, factory })`，
 * `id` 必须等于包名；React 由浏览器模块表提供，不重复安装。
 */
window.__ModuleLoader__.load({
  id: '@buka/dsh-plugin-bell',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 词典命名空间。 */
    const NS = 'buka-bell'

    /** Host 插件行 id：设置表单按这个命名空间读写 Host 的 volatile 配置。 */
    const NAMESPACE = 'sound-buka-bell'

    /** 与 Host 侧 `SILENT` 一致：设置页的「无」选项值。 */
    const NONE = 'none'

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
    ]

    /**
     * 与 Host 侧 `CUSTOM_SOUNDS` 保持一致的插件自带音频候选。
     * `value` 是写进配置的值，`label` 是候选行里显示的文案（梗语音的原文，
     * 中英文页面都显示同一句）。
     */
    const CUSTOM_SOUNDS = [{ value: 'ikun', label: '你干嘛~哎哟' }]

    /** 全部可试听的候选：自带音频在前，系统声音在后（「无」不试听）。 */
    const PREVIEWABLE = [...CUSTOM_SOUNDS, ...SOUNDS.map((name) => ({ value: name, label: name }))]

    /** 与 Host 侧一致的试听路由：播放一次，不写配置。 */
    const PREVIEW_ROUTE = '/buka-bell/preview'

    /**
     * 请求 Host 播放一个候选声音。只负责试听，选中与否由四行各自的写入
     * 决定，所以这里不发 `configForms` 请求。
     *
     * @param {string} sound 候选值
     * @returns {Promise<void>}
     */
    async function previewSound(sound) {
      const response = await fetch(PREVIEW_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sound }),
        // 本地路由正常是毫秒级；卡住时也要让请求收尾，失败会提示在列表底部。
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5000) : undefined,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.message ?? `HTTP ${response.status}`)
      }
    }

    /** 英文文案。 */
    const en = {
      nav: 'Notification sounds',
      title: 'Notification sounds',
      intro:
        'Choose which sound plays when a task finishes, when DSH waits for your input, when a plan is sent back for changes, or when you stop a task manually. Click a moment to open its sound list: clicking a sound selects it and plays it right away. “None” turns that moment off. Only the plan sound is off by default; the manual-stop sound uses the bundled clip.',
      pickHint: 'Pick one: the sound is selected and played right away. Back returns to the four moments.',
      back: 'Back',
      previewFailed: 'Could not play the preview. Try again.',
      finish: 'Task finished',
      wait: 'Waiting for input',
      plan: 'Plan sent back for changes',
      abort: 'Task stopped manually',
      none: 'None',
      saveFailed: 'Could not save the sound. Try again.',
      loading: 'Loading sound settings…',
      unavailable: 'This plugin has no editable configuration in the current profile.',
    }

    /** 简体中文文案。 */
    const zh = {
      nav: '提示音',
      title: '提示音',
      intro:
        '选择任务结束、DSH 等待你输入、计划被退回修改、手动终止任务时播放的提示音。点一行进入该时机的播放列表：点一项即选中并试听，点「返回」回来。「无」表示这个时机不播放；计划被退回默认静音，手动终止默认播放插件自带的「你干嘛~哎哟」。',
      pickHint: '单选：选中哪个就试听哪个；点「返回」回到上一页。',
      back: '返回',
      previewFailed: '试听失败，请重试。',
      finish: '任务结束',
      wait: '等待输入',
      plan: '计划被退回修改',
      abort: '手动终止',
      none: '无',
      saveFailed: '保存失败，请重试。',
      loading: '正在读取提示音设置…',
      unavailable: '当前 profile 里这个插件没有可编辑的配置。',
    }

    /** 页面样式：只用主题 token，类名带插件前缀，避免影响其他页面。 */
    const CSS = `
.buka-bell-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.buka-bell-heading{margin:0;font-size:18px;font-weight:600}
.buka-bell-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.buka-bell-rows{display:flex;flex-direction:column;margin-top:4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.buka-bell-row{display:flex;align-items:center;gap:16px;width:100%;padding:16px 4px;border:0;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.buka-bell-row:hover:not(:disabled){background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
.buka-bell-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.buka-bell-row:disabled{opacity:.55;cursor:default}
.buka-bell-label{flex:1;min-width:0;font-size:14px;line-height:20px}
.buka-bell-rowValue{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-secondary)}
.buka-bell-rowChevron{flex:none;font-size:15px;line-height:1;color:var(--dsw-alias-label-secondary)}
.buka-bell-back{align-self:flex-start;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.buka-bell-back:hover{text-decoration:underline}
.buka-bell-back:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-bell-soundList{display:flex;flex-direction:column;margin-top:4px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.buka-bell-soundRow{display:flex;align-items:center;gap:10px;width:100%;padding:11px 4px;border-bottom:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
.buka-bell-soundRow:hover{background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
.buka-bell-soundRow[data-checked='true']{color:var(--dsw-alias-brand-primary)}
.buka-bell-soundRow[data-disabled='true']{opacity:.55;cursor:default}
.buka-bell-radio{appearance:none;-webkit-appearance:none;box-sizing:border-box;display:grid;place-content:center;flex:none;width:14px;height:14px;margin:0;border:1px solid var(--dsw-alias-border-l4);border-radius:50%;background-color:var(--dsw-alias-bg-layer-1);cursor:pointer}
.buka-bell-radio::before{content:'';width:6px;height:6px;border-radius:50%;background-color:var(--dsw-alias-brand-primary);transform:scale(0);transition:transform .12s ease}
.buka-bell-radio:checked{border-color:var(--dsw-alias-brand-primary)}
.buka-bell-radio:checked::before{transform:scale(1)}
.buka-bell-radio:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-bell-radio:disabled{cursor:default}
.buka-bell-soundName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.buka-bell-muted{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.buka-bell-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
`

    /** 稳定 selector：快照原样返回，避免每次渲染换新函数导致重复订阅。 */
    const selectAll = (state) => state

    /** 四个提示时机；顺序与设置页一致。 */
    const FIELDS = ['finish', 'wait', 'plan', 'abort']

    /** 声音列表页里的完整选项：「无」在最前，然后是所有能试听的候选。 */
    const PICKER_OPTIONS = [{ value: NONE }, ...PREVIEWABLE]

    /**
     * 设置页的提示音表单：两级页面。
     *
     * 第一级是四行（任务结束 / 等待输入 / 计划被退回 / 手动终止），行上显示
     * 当前声音；点一行整页进入该时机的**声音列表页**。第二级里点一项就同时
     * 选中并试听（写配置 + 请求 Host 播一次），不自动返回；点「返回」才回到
     * 四行页面，可以连着听几个再定。
     *
     * @param {object} props 设置页注入的文案、表单快照与写入函数
     * @returns {object} React 元素
     */
    function BellSettings({ t, useBellForm, setSound }) {
      const state = useBellForm(selectAll)
      const [failed, setFailed] = React.useState(false)
      const [view, setView] = React.useState(null)
      const [previewFailed, setPreviewFailed] = React.useState(false)

      const ready = state.status === 'ready' && state.value !== undefined && state.writable !== false

      /** 某个时机当前选中的值；配置还没就绪时按「无」显示。 */
      const current = (field) => (ready ? state.value[field] : NONE)

      /** 配置值 → 展示文案。自带音频与系统声音用手写文案，未知值原样显示。 */
      const labelOf = (value) => {
        if (value === NONE) return t('none')
        const found = PREVIEWABLE.find((sound) => sound.value === value)
        return found === undefined ? value : found.label
      }

      /** 试听一个候选：只播一次；失败时在列表底部提示。 */
      const preview = (sound) => {
        setPreviewFailed(false)
        Promise.resolve(previewSound(sound)).then(undefined, () => setPreviewFailed(true))
      }

      /** 列表里点一项 = 选中 + 试听；不自动返回，方便连着听几个再定。 */
      const choose = (field, value) => {
        setFailed(false)
        setPreviewFailed(false)
        if (value !== NONE) preview(value)
        Promise.resolve(setSound(field, value)).then((saved) => {
          if (saved === false) setFailed(true)
        }, () => setFailed(true))
      }

      /** 返回四行页面，顺手清掉试听错误。 */
      const back = () => {
        setView(null)
        setPreviewFailed(false)
      }

      // 第二级：某个时机的独立声音列表页，整页替换掉四行。
      if (view !== null) {
        const field = view
        return h(
          'section',
          { className: 'buka-bell-section' },
          h('button', { type: 'button', className: 'buka-bell-back', onClick: back }, `← ${t('back')}`),
          h('h2', { className: 'buka-bell-heading' }, t(field)),
          h('p', { className: 'buka-bell-intro' }, t('pickHint')),
          ready ? null : h('p', { className: 'buka-bell-muted' }, t(state.status === 'unavailable' ? 'unavailable' : 'loading')),
          h(
            'div',
            { className: 'buka-bell-soundList' },
            ...PICKER_OPTIONS.map((option) => {
              const picked = current(field) === option.value
              return h(
                'label',
                {
                  className: 'buka-bell-soundRow',
                  key: option.value,
                  'data-checked': picked ? 'true' : undefined,
                  'data-disabled': ready ? undefined : 'true',
                },
                h('input', {
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
                h('span', { className: 'buka-bell-soundName' }, labelOf(option.value)),
              )
            }),
          ),
          failed ? h('p', { className: 'buka-bell-error', role: 'alert' }, t('saveFailed')) : null,
          previewFailed ? h('p', { className: 'buka-bell-error', role: 'alert' }, t('previewFailed')) : null,
        )
      }

      // 第一级：四个时机，点一行进入它的声音列表页。
      const rows = FIELDS.map((field) =>
        h(
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
          h('span', { className: 'buka-bell-label' }, t(field)),
          h('span', { className: 'buka-bell-rowValue' }, labelOf(current(field))),
          h('span', { className: 'buka-bell-rowChevron', 'aria-hidden': 'true' }, '›'),
        ),
      )

      return h(
        'section',
        { className: 'buka-bell-section' },
        h('h2', { className: 'buka-bell-heading' }, t('title')),
        h('p', { className: 'buka-bell-intro' }, t('intro')),
        ready ? null : h('p', { className: 'buka-bell-muted' }, t(state.status === 'unavailable' ? 'unavailable' : 'loading')),
        h('div', { className: 'buka-bell-rows' }, ...rows),
        failed ? h('p', { className: 'buka-bell-error', role: 'alert' }, t('saveFailed')) : null,
      )
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      /**
       * 注册设置页入口。
       *
       * @param {object} ctx 浏览器插件上下文
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'buka-bell: dictionaries')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@buka/dsh-plugin-bell'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'buka-bell: styles')

        const form = ctx.configForms.get(NAMESPACE)
        const bellForm = {
          getSnapshot: () => form.getSnapshot(),
          subscribe: (listener) => form.subscribe(listener),
        }

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'buka-bell',
              order: 16,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({
                hooks: { bellForm },
                setSound: (field, value) => form.set(field, value),
              }),
            },
            BellSettings,
          ),
        )
      },
    }
  },
})
