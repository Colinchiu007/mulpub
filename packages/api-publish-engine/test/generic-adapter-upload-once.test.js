'use strict'
/**
 * P2 技术债（audit-batch-4）：GenericPlatformAdapter 重复上传收口
 *
 * 缺陷：orchestrator 的 upload() 一次就把「视频 + 封面」全传完，而基类发布流程会
 * 先 uploadVideo() 再 uploadCover()；两个方法各自跑一遍 upload() ⇒ 同一任务的
 * 视频和封面各被上传两遍（带宽/配额翻倍、平台侧冗余素材、大视频耗时翻倍）。
 *
 * 约定：同一任务指纹共享同一个 in-flight Promise；失败不缓存（保留重试语义）；
 * 不同任务指纹不得互相复用。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const ADAPTER_SRC = fs.readFileSync(require.resolve('../src/adapters/generic-adapter'), 'utf8')

/** 用桩替换 upload/orchestrator 后重新加载 generic-adapter */
function loadWithStub (uploadStub) {
  const orchPath = require.resolve('../upload/orchestrator')
  const adapterPath = require.resolve('../src/adapters/generic-adapter')
  const prevOrch = require.cache[orchPath]
  const prevAdapter = require.cache[adapterPath]
  require.cache[orchPath] = {
    id: orchPath,
    filename: orchPath,
    loaded: true,
    exports: { upload: uploadStub, getUploadProvider: () => null, platformMap: {} },
  }
  delete require.cache[adapterPath]
  try {
    return require('../src/adapters/generic-adapter')
  } finally {
    if (prevOrch) require.cache[orchPath] = prevOrch
    else delete require.cache[orchPath]
    if (prevAdapter) require.cache[adapterPath] = prevAdapter
    else delete require.cache[adapterPath]
  }
}

function makeAdapter (mod) {
  return new mod.GenericPlatformAdapter('weishi', {
    apiBase: 'https://example.com',
    referer: 'https://example.com/',
    contentType: 'application/json',
    publishPath: '/publish',
  })
}

test('同一任务的视频与封面只触发一次 orchestrator upload()', async () => {
  const calls = []
  const mod = loadWithStub(async (td) => {
    calls.push(td)
    return { video: 'v-1', cover: 'c-1' }
  })
  const adapter = makeAdapter(mod)
  const td = { filePath: '/tmp/a.mp4', coverPath: '/tmp/a.jpg', title: 't' }

  assert.equal(await adapter.uploadVideo(td, 'cookie'), 'v-1')
  assert.equal(await adapter.uploadCover(td, 'cookie'), 'c-1')
  assert.equal(calls.length, 1, 'upload() 被调用了 ' + calls.length + ' 次，重复上传未收口')
})

test('并发调用也共享同一次上传（in-flight 复用，不是先后才复用）', async () => {
  let inflight = 0
  let peak = 0
  const mod = loadWithStub(async () => {
    inflight += 1
    peak = Math.max(peak, inflight)
    await new Promise((r) => setTimeout(r, 5))
    inflight -= 1
    return { video: 'v', cover: 'c' }
  })
  const adapter = makeAdapter(mod)
  const td = { filePath: '/tmp/b.mp4', coverPath: '/tmp/b.jpg' }

  const [v, c] = await Promise.all([adapter.uploadVideo(td, 'ck'), adapter.uploadCover(td, 'ck')])
  assert.equal(v, 'v')
  assert.equal(c, 'c')
  assert.equal(peak, 1, '并发峰值 ' + peak + ' 次真实上传，in-flight 未去重')
})

test('不同任务指纹不得复用缓存（否则会拿到别的文件的 URL）', async () => {
  let n = 0
  const mod = loadWithStub(async () => {
    n += 1
    return { video: 'v' + n, cover: 'c' + n }
  })
  const adapter = makeAdapter(mod)

  assert.equal(await adapter.uploadVideo({ filePath: '/x/1.mp4' }, 'ck'), 'v1')
  assert.equal(await adapter.uploadVideo({ filePath: '/x/2.mp4' }, 'ck'), 'v2')
  assert.equal(n, 2)
})

test('上传失败不得被缓存，后续重试仍能发起真实上传', async () => {
  let n = 0
  const mod = loadWithStub(async () => {
    n += 1
    if (n === 1) throw new Error('网络抖动')
    return { video: 'v2', cover: 'c2' }
  })
  const adapter = makeAdapter(mod)
  const td = { filePath: '/tmp/c.mp4' }

  await assert.rejects(() => adapter.uploadVideo(td, 'ck'), /网络抖动/)
  assert.equal(await adapter.uploadVideo(td, 'ck'), 'v2', '失败结果被缓存，重试永远失败')
})

test('防复发静态不变量：adapter 内不得残留裸调 upload() 的旁路', () => {
  assert.doesNotMatch(
    ADAPTER_SRC,
    /await\s+upload\(/,
    'uploadVideo/uploadCover 必须走 _uploadOnce，直连 upload() 会重现重复上传',
  )
  assert.match(ADAPTER_SRC, /_uploads\s*=\s*new Map\(\)/, '缺少按任务指纹的上传缓存')
})
