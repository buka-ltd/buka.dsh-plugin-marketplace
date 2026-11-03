import assert from 'node:assert/strict'
import test from 'node:test'

import { compareVersions, isExactVersion, isValidRange } from '../scripts/lib/semver.mjs'

test('精确版本号', () => {
  for (const version of ['0.0.1', '1.2.3', '1.2.3-rc.5', '1.2.3+build.7', '1.2.3-alpha.1+build.2']) {
    assert.equal(isExactVersion(version), true, version)
  }
  for (const version of ['1', '1.2', 'v1.2.3', '01.2.3', '1.2.3.4', '1.2.3-', '1.2.3-01', 'latest', '']) {
    assert.equal(isExactVersion(version), false, version)
  }
})

test('版本比较遵循 SemVer 优先级', () => {
  const ascending = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0',
  ]
  for (let index = 1; index < ascending.length; index += 1) {
    assert.equal(compareVersions(ascending[index - 1], ascending[index]), -1, `${ascending[index - 1]} < ${ascending[index]}`)
    assert.equal(compareVersions(ascending[index], ascending[index - 1]), 1)
  }
  assert.equal(compareVersions('1.2.3+build.1', '1.2.3+build.2'), 0)
})

test('范围语法', () => {
  const valid = [
    '*',
    '>=0.2.1-rc.5 <0.3.0',
    '^0.2.1',
    '~1.2.3',
    '1.2.x',
    '1.x',
    '1.2.3 - 2.3.4',
    '>=1.2.3 <2 || >=3',
    '=1.2.3',
  ]
  for (const range of valid) assert.equal(isValidRange(range), true, range)

  const invalid = ['', '   ', 'latest', '>>1.2.3', '1.2.3 ||', '^x', '1.x.3', '>=1.2.3.4', 'workspace:*', '1.2.3 -']
  for (const range of invalid) assert.equal(isValidRange(range), false, range)
})
