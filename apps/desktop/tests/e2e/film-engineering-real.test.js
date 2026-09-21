const assert = require('node:assert/strict')
const { it } = require('node:test')

const {
  GENERATION_RESULT_TIMEOUT,
  waitForToast,
  classifyVideoOutcome,
} = require('./film-engineering-real')

it('电影工程生成结果为打包 fallback 留出完整终态观察预算', async () => {
  assert.equal(GENERATION_RESULT_TIMEOUT, 30000)

  let observations = 0
  const page = {
    evaluate: async () => {
      observations += 1
      return observations === 1 ? [] : ['生成失败']
    },
  }

  const message = await waitForToast(page, /生成失败/, 100, 1)

  assert.equal(message, '生成失败')
  assert.equal(observations, 2)
})

it('classifyVideoOutcome：成片优先，其次 fail-closed，否则 unknown', () => {
  assert.equal(classifyVideoOutcome({ openFolderVisible: true, gotoModelVisible: true }), 'done')
  assert.equal(classifyVideoOutcome({ openFolderVisible: false, gotoModelVisible: true }), 'fail-closed')
  assert.equal(classifyVideoOutcome({ openFolderVisible: false, gotoModelVisible: false }), 'unknown')
  assert.equal(classifyVideoOutcome(), 'unknown')
})
