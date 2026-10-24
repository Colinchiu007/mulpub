/**
 * animated-explainer-cdp 运行器单测
 *
 * 同 local-provider-hub.test.js：测试放在 tests 根下才被 vitest 收集
 * （vitest exclude 含 e2e 整个子树，放在 e2e 目录下不会被执行）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { parseArgs, findVideoPath, probeVideo } = require('./e2e/animated-explainer-cdp')
// ffmpeg 必须用仓库自己的解析（media-tool-paths）：Windows runner 的 PATH 上没有 ffmpeg，
// 预置包 ffmpeg-ffprobe-static 才有；直接 spawn 'ffmpeg' 在 CI 上必 ENOENT。
const { findFfmpeg, findFfprobe } = require('../electron/services/media-tool-paths')

describe('animated-explainer-cdp 参数解析', () => {
  it('支持 --key=value 与 --key value 两种写法', () => {
    const args = parseArgs(['--cdp-port=9299', '--out-dir', '/tmp/x', '--mode=ui'])
    expect(args['cdp-port']).toBe('9299')
    expect(args['out-dir']).toBe('/tmp/x')
    expect(args.mode).toBe('ui')
  })

  it('不带值的开关记为字符串 true，不吞掉下一个位置参数', () => {
    const args = parseArgs(['--runs', '3', '--ui'])
    expect(args.runs).toBe('3')
    expect(args.ui).toBe('true')
  })

  it('忽略非 -- 开头的参数', () => {
    expect(parseArgs(['positional', '--a=1'])).toEqual({ a: '1' })
  })
})

describe('animated-explainer-cdp 成片路径发现', () => {
  it('优先取 videoPath，其次 outputPath / path', () => {
    const exists = () => true
    expect(findVideoPath({ videoPath: '/a.mp4' }, 0, exists)).toBe('/a.mp4')
    expect(findVideoPath({ outputPath: '/b.mp4' }, 0, exists)).toBe('/b.mp4')
    expect(findVideoPath({ path: '/c.mp4' }, 0, exists)).toBe('/c.mp4')
  })

  it('只认视频扩展名（不得把素材图片当成成片）', () => {
    const exists = () => true
    expect(findVideoPath({ imagePath: '/x/img_0000.png' }, 0, exists)).toBeNull()
    expect(findVideoPath({ path: '/x/img_0000.png' }, 0, exists)).toBeNull()
    expect(findVideoPath({ path: '/x/seg_0000.mp4' }, 0, exists)).toBe('/x/seg_0000.mp4')
    expect(findVideoPath({ path: '/x/out.webm' }, 0, exists)).toBe('/x/out.webm')
  })

  it('嵌套结构里也能找到（compose 产物挂在 context.compose 下）', () => {
    const exists = () => true
    const context = { compose: { data: { videoPath: '/deep.mp4' } } }
    expect(findVideoPath(context, 0, exists)).toBe('/deep.mp4')
  })

  it('compose 产物同时挂图片与分段视频时，优先返回顶层成片而不是素材图', () => {
    const exists = () => true
    const context = {
      compose: {
        videoPath: '/tmp/s2v_output.mp4',
        segments: [{ imagePath: '/tmp/assets/img_0000.png', videoPath: '/tmp/segments/segment_0000.mp4' }],
      },
    }
    expect(findVideoPath(context, 0, exists)).toBe('/tmp/s2v_output.mp4')
  })

  it('文件不存在时不得返回该路径（避免把死路径当作成片）', () => {
    const exists = p => p === '/real.mp4'
    expect(findVideoPath({ videoPath: '/gone.mp4', other: { path: '/real.mp4' } }, 0, exists))
      .toBe('/real.mp4')
    expect(findVideoPath({ videoPath: '/gone.mp4' }, 0, exists)).toBeNull()
  })

  it('空输入与超深嵌套都不得抛错', () => {
    expect(findVideoPath(null)).toBeNull()
    expect(findVideoPath({})).toBeNull()
    let deep = { videoPath: '/x.mp4' }
    for (let i = 0; i < 20; i++) deep = { nested: deep }
    expect(() => findVideoPath(deep)).not.toThrow()
  })
})

describe('animated-explainer-cdp 成片规格探测', () => {
  // 媒体工具的可用性是**环境事实**：CI 的桌面分片 job 刻意不设
  // SKIP_NATIVE_MEDIA_TOOL_TESTS=1（那条路会真跑原生 ffmpeg/ffprobe），
  // 但用 --ignore-scripts 装的 job 拿不到预置二进制 ⇒ 这里按可用性跳过，
  // 而 probeVideo 的「失败路径」另有不依赖媒体的硬断言覆盖。
  const FFMPEG = findFfmpeg()
  const FFPROBE = findFfprobe()
  // 冷启动 runner 上（Defender 首次扫描二进制）原生工具可能明显慢于全局 testTimeout，
  // 这里只给这一条放宽预算，不改全局设置（与 story2video-stages.test.js 的
  // MEDIA_SETUP_HOOK_TIMEOUT_MS 同一思路）。
  const MEDIA_TEST_TIMEOUT_MS = 60000

  it('能读出视频流/音频流/时长', async (ctx) => {
    if (!FFMPEG || !FFPROBE) return ctx.skip()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-probe-'))
    const file = path.join(dir, 'sample.mp4')
    try {
      execFileSync(FFMPEG, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
      ], { timeout: MEDIA_TEST_TIMEOUT_MS })
    } catch (error) {
      // 二进制存在但不可用（半截下载 / 缺依赖）⇒ 同样跳过，不让环境问题红成代码问题
      if (error && (error.code === 'ENOENT' || error.errno === -4058)) return ctx.skip()
      throw error
    }
    const probe = await probeVideo(file)
    expect(probe.ok).toBe(true)
    expect(probe.width).toBe(320)
    expect(probe.height).toBe(240)
    expect(probe.hasAudio).toBe(true)
    expect(probe.durationSeconds).toBeGreaterThan(0.5)
    fs.rmSync(dir, { recursive: true, force: true })
  }, MEDIA_TEST_TIMEOUT_MS)

  it('文件不存在时返回 ok=false 而不是抛错（不依赖 ffmpeg，始终可跑）', async () => {
    const probe = await probeVideo('/definitely/not/here.mp4')
    expect(probe.ok).toBe(false)
    expect(typeof probe.error).toBe('string')
  })
})
