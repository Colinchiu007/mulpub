import { describe, expect, it } from 'vitest'
import { buildPublishFromProject, publishDataToQuery } from './publish-from-project'
import { PUBLISH_TITLE_MAX } from './title-limits'

/**
 * ⚠️ 夹具纪律（2026-10-18 复盘后加固）：
 * `title` 与 `sourceText` **必须不同**，且 `publish.title` 默认为**空串**。
 * 旧夹具让 `title === sourceText` 且只有 38 字 —— 于是「标题回退到正文」这条生产缺陷
 * 在测试里表现为「正确行为」，是本期缺陷逃逸的第一性原因。
 * 任何把两者设成同值的写法都会把该缺陷重新藏起来。
 */
function makeProject (overrides = {}) {
  return {
    projectId: 'run_1787747765446_xge6',
    status: 'completed',
    title: '',
    sourceText: '外婆的灶台总飘着豆瓣香的雾气。那年我离家求学，她往行李塞了一罐自制辣酱。',
    videoPath: 'D:\\tmp\\debug\\video.mp4',
    segments: [
      { id: 'segment-0', text: '外婆的灶台总飘着豆瓣香的雾气。' },
      { id: 'segment-1', text: '十年后我回乡，罐子还在，人已不在。' },
    ],
    story2videoTextConfig: {
      config: {
        publish: {
          enabled: false,
          platforms: [],
          title: '',
          content: '外婆的灶台总飘着豆瓣香的雾气。那年我离家求学。',
          tags: ['美食', '亲情'],
          coverUrl: '',
        },
      },
    },
    ...overrides,
  }
}

describe('publish-from-project', () => {
  it('从项目提取视频路径/标题/正文/标签（标题取显式标题并截到 20 字）', () => {
    const data = buildPublishFromProject(makeProject({
      story2videoTextConfig: { config: { publish: {
        enabled: false, platforms: [], title: '外婆的灶台', content: '外婆的灶台总飘着豆瓣香的雾气。', tags: ['美食', '亲情'], coverUrl: '',
      } } },
    }))
    expect(data.type).toBe('video')
    expect(data.video_path).toBe('D:\\tmp\\debug\\video.mp4')
    expect(data.title).toBe('外婆的灶台')
    expect(data.content).toBe('外婆的灶台总飘着豆瓣香的雾气。')
    expect(data.tags).toEqual(['美食', '亲情'])
  })

  it('【回归锁】无显式标题时**不得**回退正文——返回空串，而不是正文切片', () => {
    // 这是本期修的原始缺陷：标题 = 正文前 N 字。四条入口共用本函数，改这里才算真修。
    const data = buildPublishFromProject(makeProject())
    expect(data.title).toBe('')
    // 正文该有照有（不能因为标题修了就把正文也丢了）
    expect(data.content).toBe('外婆的灶台总飘着豆瓣香的雾气。那年我离家求学。')
  })

  it('project.title 非空时用 project.title（不是 sourceText）', () => {
    const data = buildPublishFromProject(makeProject({ title: '外婆的辣酱' }))
    expect(data.title).toBe('外婆的辣酱')
    // 两者不同值才证明取的是 title 而非 sourceText
    expect(data.title).not.toBe(data.content)
  })

  it(`标题超过 ${PUBLISH_TITLE_MAX} 字时按码点截断`, () => {
    const longTitle = '字'.repeat(PUBLISH_TITLE_MAX + 100)
    const data = buildPublishFromProject(makeProject({ title: longTitle }))
    expect([...data.title].length).toBe(PUBLISH_TITLE_MAX)
    expect(data.title).toBe([...longTitle].slice(0, PUBLISH_TITLE_MAX).join(''))
  })

  it('emoji 按 1 个字计（不切断代理对、不把 1 字算成 2）', () => {
    const title = '🎬'.repeat(PUBLISH_TITLE_MAX)
    const data = buildPublishFromProject(makeProject({ title }))
    expect([...data.title].length).toBe(PUBLISH_TITLE_MAX)
    expect(data.title).toBe(title)
  })

  it('标签归一化（去重/去空/逗号分隔字符串）', () => {
    const project = makeProject()
    project.story2videoTextConfig.config.publish.tags = '美食, 美食，AI'
    const data = buildPublishFromProject(project)
    expect(data.tags).toEqual(['美食', 'AI'])
  })

  it('publishDataToQuery 对路径与文案做 URI 编码', () => {
    const data = buildPublishFromProject(makeProject({
      story2videoTextConfig: { config: { publish: {
        enabled: false, platforms: [], title: '外婆的灶台', content: '外婆的灶台总飘着豆瓣香的雾气。', tags: ['美食', '亲情'], coverUrl: '',
      } } },
    }))
    const query = publishDataToQuery(data)
    expect(query.type).toBe('video')
    expect(query.video_path).toBe(encodeURIComponent(data.video_path))
    expect(query.title).toBe(encodeURIComponent(data.title))
    expect(query.content).toBe(encodeURIComponent(data.content))
    expect(query.tags).toBe(encodeURIComponent('美食,亲情'))
  })

  it('空项目返回空数据且不抛错', () => {
    const data = buildPublishFromProject(null)
    expect(data).toEqual({ type: 'video', video_path: '', title: '', content: '', tags: [] })
  })
})
