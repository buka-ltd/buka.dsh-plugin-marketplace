/**
 * `@buka/dsh-plugin-bell` 的浏览器一半：在 设置 → 提示音 里选两个声音。
 *
 * 页面本身不保存任何状态：读写都走 DSH 的设置表单服务 `ctx.configForms`
 * （Host 设置的浏览器镜像）。写配置会路由回 Host 的 volatile 配置更新，
 * Host 插件监听到后播放一次新声音，于是「选中即试听」。
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

    /** 英文文案。 */
    const en = {
      nav: 'Notification sounds',
      title: 'Notification sounds',
      intro:
        'Choose which macOS system sound plays when a task finishes or when DSH waits for your input. Picking a sound plays it once as a preview. No sound plays when you stop a task manually.',
      finish: 'Task finished',
      wait: 'Waiting for input',
      saveFailed: 'Could not save the sound. Try again.',
      loading: 'Loading sound settings…',
      unavailable: 'This plugin has no editable configuration in the current profile.',
    }

    /** 简体中文文案。 */
    const zh = {
      nav: '提示音',
      title: '提示音',
      intro: '选择任务结束、或 DSH 等待你输入时播放的 macOS 系统提示音。选中某个声音会立即试听一次；手动终止任务时不会响。',
      finish: '任务结束',
      wait: '等待输入',
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
.buka-bell-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.buka-bell-label{font-size:14px;line-height:20px}
.buka-bell-select{appearance:none;-webkit-appearance:none;box-sizing:border-box;min-width:190px;max-width:240px;padding:6px 32px 6px 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background-color:var(--dsw-alias-bg-layer-1);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.buka-bell-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}
.buka-bell-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.buka-bell-select:disabled{opacity:.55;cursor:default}
.buka-bell-muted{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.buka-bell-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
`

    /** 稳定 selector：快照原样返回，避免每次渲染换新函数导致重复订阅。 */
    const selectAll = (state) => state

    /**
     * 设置页的提示音表单。
     *
     * @param {object} props 设置页注入的文案、表单快照与写入函数
     * @returns {object} React 元素
     */
    function BellSettings({ t, useBellForm, setSound }) {
      const state = useBellForm(selectAll)
      const [failed, setFailed] = React.useState(false)

      const ready = state.status === 'ready' && state.value !== undefined && state.writable !== false
      const choose = (field) => (event) => {
        setFailed(false)
        // 不显示「试听中」之类的状态：写入走 volatile 配置热更新，完成得很快，
        // 失败时把错误挂在页面底部即可。
        Promise.resolve(setSound(field, event.target.value)).then((saved) => {
          if (saved === false) setFailed(true)
        }, () => setFailed(true))
      }

      const rows = [
        ['finish', t('finish')],
        ['wait', t('wait')],
      ].map(([field, label]) =>
        h(
          'label',
          { className: 'buka-bell-row', key: field },
          h('span', { className: 'buka-bell-label' }, label),
          h(
            'select',
            {
              className: 'buka-bell-select',
              value: ready ? state.value[field] : '',
              disabled: !ready,
              'aria-label': label,
              onChange: choose(field),
            },
            SOUNDS.map((name) => h('option', { key: name, value: name }, name)),
          ),
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
