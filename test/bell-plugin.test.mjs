/**
 * @buka/dsh-plugin-bell 的提示音候选表单测。
 *
 * 只导入零依赖的 `plugins/bell/src/sounds.ts`：CI 里 `pnpm test` 不装插件
 * 依赖，导入 Host 入口会卡在 `@deepseek-ai/schemastery` 上。覆盖：自带音频
 * 真的在包里且是 mp3、播放命令指向它、系统声音与「无」的行为、volatile
 * 配置的读取、试听路由只接受已知声音名，以及浏览器一半的两级页面、候选与
 * 路由字符串没有和 Host 侧脱节。
 *
 * 浏览器一半拆成多个文件后，正向断言读内容真正所在的文件；「不能出现 XX」
 * 这类负向断言扫 `src/client/**` 的全部源码，避免内容挪个位置就漏检。
 */

import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CUSTOM_SOUNDS,
  commandFor,
  isPlayableSound,
  PREVIEW_ROUTE,
  SILENT,
  selectedSound,
} from '../plugins/bell/src/sounds.ts'

/** 插件包根：`CUSTOM_SOUNDS` 里的相对路径以它为基准。 */
const PACKAGE_ROOT = new URL('../plugins/bell/', import.meta.url)

/** 浏览器一半的源码目录：拆分后内容分散在多个文件里。 */
const CLIENT_DIR = new URL('src/client/', PACKAGE_ROOT)

/** 读浏览器一半里某一个文件的源码。 */
function clientSource(relative) {
  return readFileSync(new URL(relative, CLIENT_DIR), 'utf8')
}

/**
 * 浏览器一半的全部源码。负向断言（「不能出现 XX」）必须扫全部文件：
 * 内容拆到多个模块后，只看单个文件会漏掉藏进别的模块的情况。
 */
function allClientSource() {
  return ['index.ts', 'dictionaries.ts', 'styles.ts', 'preview.ts', 'components/settings.ts']
    .map((relative) => clientSource(relative))
    .join('\n')
}

/** 四个提示时机，和插件里的顺序一致。 */
const CUES = ['finish', 'wait', 'plan', 'abort']

test('「无」在任何时机都没有播放命令', () => {
  for (const cue of CUES) assert.deepEqual(commandFor(cue, SILENT), [])
})

test('自带音频随包发布，且确实是 mp3', () => {
  const names = Object.values(CUSTOM_SOUNDS)
  assert.ok(names.length > 0, 'CUSTOM_SOUNDS 为空')
  for (const relative of names) {
    const file = fileURLToPath(new URL(relative, PACKAGE_ROOT))
    assert.ok(statSync(file).size > 10_000, `${relative} 太小，可能不是完整音频`)
    const head = readFileSync(file).subarray(0, 3)
    const tag = head.toString('latin1')
    // ID3v2 标签或直接是帧同步字（0xFF 开头）都算合法 mp3
    assert.ok(tag === 'ID3' || head[0] === 0xff, `${relative} 不是 mp3`)
  }
})

test('选中自带音频时，第一条播放命令就指向包里的文件', () => {
  const firstPlayer = { darwin: 'afplay', win32: 'ffplay', linux: 'paplay' }
  for (const [value, relative] of Object.entries(CUSTOM_SOUNDS)) {
    const file = fileURLToPath(new URL(relative, PACKAGE_ROOT))
    const candidates = commandFor('finish', value)
    assert.ok(candidates.length > 0, `${value} 没有候选播放器`)
    assert.equal(candidates[0][0], firstPlayer[process.platform] ?? 'paplay')
    for (const [, args] of candidates) assert.equal(args.at(-1), file)
  }
})

test('macOS 上系统声音名播系统音，未知名回退到该时机的默认音', {
  skip: process.platform !== 'darwin',
}, () => {
  assert.deepEqual(commandFor('finish', 'Basso'), [
    ['afplay', ['/System/Library/Sounds/Basso.aiff']],
  ])
  assert.deepEqual(commandFor('wait', 'NotASound'), [
    ['afplay', ['/System/Library/Sounds/Submarine.aiff']],
  ])
  // 手动终止默认是自带 mp3：未知音的退路也是文件播放器，不能拼系统声音路径
  assert.deepEqual(commandFor('abort', 'NotASound'), [
    ['afplay', [fileURLToPath(new URL('assets/voice.mp3', PACKAGE_ROOT))]],
  ])
  // 计划被退回默认是「无」，没有退路
  assert.deepEqual(commandFor('plan', 'NotASound'), [])
})

test('volatile 配置选中自带音频时原样读回，读不到时用默认值', () => {
  assert.equal(selectedSound({ finish: { get: () => 'ikun' } }, 'finish'), 'ikun')
  assert.equal(selectedSound({ finish: { get: () => 'ikun' } }, 'wait'), 'Submarine')
  assert.equal(selectedSound({ finish: 'ikun' }, 'finish'), 'ikun')
  assert.equal(selectedSound({}, 'plan'), SILENT)
})

test('默认音取常用设置：任务结束 Basso、等待输入 Submarine、手动终止梗语音、计划静音', () => {
  assert.equal(selectedSound({}, 'finish'), 'Basso')
  assert.equal(selectedSound({}, 'wait'), 'Submarine')
  assert.equal(selectedSound({}, 'plan'), SILENT)
  assert.equal(selectedSound({}, 'abort'), 'ikun')
})

test('浏览器一半的候选列表包含 Host 侧每个自带候选', () => {
  const source = clientSource('components/settings.ts')
  for (const value of Object.keys(CUSTOM_SOUNDS)) {
    assert.ok(source.includes(`value: '${value}'`), `设置页没列出 ${value}`)
  }
  assert.ok(source.includes('你干嘛'), '设置页没有候选项的显示文案')
})

test('试听只接受已知声音名，原型链上的键也不算', () => {
  assert.equal(isPlayableSound('ikun'), true)
  assert.equal(isPlayableSound('Glass'), true)
  for (const bad of [
    SILENT,
    '',
    'NotASound',
    'toString',
    '__proto__',
    'constructor',
    null,
    42,
    {},
  ]) {
    assert.equal(isPlayableSound(bad), false, `${String(bad)} 不该通过校验`)
  }
})

test('浏览器一半走 Host 的试听路由，路由字符串与 Host 一致', () => {
  const source = clientSource('preview.ts')
  assert.ok(source.includes(`'${PREVIEW_ROUTE}'`), '试听路由和 Host 不一致')
  assert.ok(source.includes('previewSound'), '没有试听请求')
})

test('设置页是两级页面：点行进入独立声音列表，点返回才回来', () => {
  const source = clientSource('components/settings.ts')
  assert.ok(source.includes('buka-bell-soundList'), '没有独立的声音列表页')
  assert.ok(source.includes('buka-bell-back'), '列表页没有返回按钮')
  assert.ok(source.includes("t('back')"), '返回按钮没有文案')
  // 既不是行内展开，也不在设置页里再叠一层 Modal。
  const all = allClientSource()
  assert.ok(!all.includes('buka-bell-panel'), '不该再是行内展开')
  assert.ok(!all.includes('dsh-client-ui-primitives'), '不该依赖基座 Modal')
})

test('声音列表用 radio：选中哪个就试听哪个，且不自动返回', () => {
  const source = clientSource('components/settings.ts')
  // 原生单选控件，不再有额外的试听按钮 / ▶ 图标。
  assert.ok(source.includes("type: 'radio'"), '列表不是 radio')
  assert.ok(source.includes('buka-bell-radio'), '没有 radio 的样式')
  assert.ok(!source.includes('▶'), '不该再有试听按钮拿 ▶ 当图标')
  assert.ok(source.includes('if (value !== NONE) preview(value)'), '选中一项没有同时试听')
  assert.ok(source.includes('setSound(field, value)'), '选中一项没有写入配置')
  // choose 里不能调用 back，只有返回按钮才切回四行。
  const choose = source.slice(source.indexOf('const choose ='), source.indexOf('const back ='))
  assert.ok(!choose.includes('setView(null)'), '选中后不该自动返回')
  // 「无」没法试听。
  assert.ok(source.includes('option.value !== NONE'), '「无」不该触发试听')
})
