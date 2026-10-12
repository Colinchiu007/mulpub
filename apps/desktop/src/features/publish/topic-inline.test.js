import { describe, expect, it } from 'vitest'
import {
  appendHashToContent,
  appendTopicsToContent,
  extractInlineTopics,
  removeTopicFromContent,
} from './topic-inline'

// 话题内联描述管道（publish-topic-inline-description）：
// 描述文本是话题唯一真源——追加/移除/解析三个纯函数，
// 视频/图文/批量三分支共用，禁止各抄一份（PRD §3.5、design §2.1）。

describe('appendTopicsToContent（话题追加进描述）', () => {
  it('空描述追加单话题成为唯一内容', () => {
    expect(appendTopicsToContent('', ['美食探店'])).toBe('#美食探店')
  })

  it('空描述追加多话题以空格相连', () => {
    expect(appendTopicsToContent('', ['美食探店', 'vlog'])).toBe('#美食探店 #vlog')
  })

  it('非空描述追加话题先补一个分隔空格', () => {
    expect(appendTopicsToContent('今天探店', ['美食探店'])).toBe('今天探店 #美食探店')
    expect(appendTopicsToContent('今天探店', ['美食探店', 'vlog'])).toBe('今天探店 #美食探店 #vlog')
  })

  it('描述尾部已有空白时不额外补空格', () => {
    expect(appendTopicsToContent('今天探店 ', ['美食探店'])).toBe('今天探店 #美食探店')
  })

  it('词边界去重：描述已有同话题则跳过', () => {
    expect(appendTopicsToContent('正文 #美食探店', ['美食探店'])).toBe('正文 #美食探店')
    expect(appendTopicsToContent('正文 #美食探店 结尾', ['美食探店'])).toBe('正文 #美食探店 结尾')
  })

  it('词边界去重：#AI 不误匹配 #人工智能（话题名完整匹配才算重复）', () => {
    expect(appendTopicsToContent('正文 #人工智能', ['AI'])).toBe('正文 #人工智能 #AI')
    // #AI技术 中的 #AI 后跟话题字符，不构成独立话题 → 追加
    expect(appendTopicsToContent('正文 #AI技术', ['AI'])).toBe('正文 #AI技术 #AI')
  })

  it('双井号形态（微博式 #话题#）同样参与去重', () => {
    expect(appendTopicsToContent('正文 #美食探店#', ['美食探店'])).toBe('正文 #美食探店#')
  })

  it('话题名内部井号被剥离（防嵌套）', () => {
    expect(appendTopicsToContent('正文', ['美食#探店'])).toBe('正文 #美食探店')
  })

  it('空话题名与空白话题被忽略', () => {
    expect(appendTopicsToContent('正文', ['', '   ', '##'])).toBe('正文')
    expect(appendTopicsToContent('正文', [])).toBe('正文')
  })

  it('追加话题不构成 Markdown ATX 标题（# 后无空格）', () => {
    const out = appendTopicsToContent('正文', ['美食探店'])
    expect(out).not.toMatch(/#\s/)
  })
})

describe('removeTopicFromContent（从描述移除话题）', () => {
  it('移除中间话题并收拢分隔空白', () => {
    expect(removeTopicFromContent('正文 #美食探店 #vlog', '美食探店')).toBe('正文 #vlog')
  })

  it('移除末尾话题连同前导空白', () => {
    expect(removeTopicFromContent('正文 #美食探店', '美食探店')).toBe('正文')
  })

  it('移除开头话题连同后随空白', () => {
    expect(removeTopicFromContent('#美食探店 正文', '美食探店')).toBe('正文')
  })

  it('描述仅含该话题时移除后为空字符串', () => {
    expect(removeTopicFromContent('#美食探店', '美食探店')).toBe('')
  })

  it('话题不存在时原样返回（用户可能已手动删除）', () => {
    expect(removeTopicFromContent('正文 #vlog', '美食探店')).toBe('正文 #vlog')
    expect(removeTopicFromContent('', '美食探店')).toBe('')
  })

  it('双井号形态移除时连同尾部井号一起清理', () => {
    expect(removeTopicFromContent('正文 #美食探店#', '美食探店')).toBe('正文')
  })
})

describe('extractInlineTopics（解析描述内联话题）', () => {
  it('提取全部单井号话题名', () => {
    expect(extractInlineTopics('正文 #美食探店 #vlog 结尾')).toEqual(['美食探店', 'vlog'])
  })

  it('双井号形态提取时剥离尾部井号', () => {
    expect(extractInlineTopics('正文 #美食探店# 结尾')).toEqual(['美食探店'])
  })

  it('无话题时返回空数组', () => {
    expect(extractInlineTopics('正文没有任何话题')).toEqual([])
    expect(extractInlineTopics('')).toEqual([])
  })

  it('孤立的井号不产生话题', () => {
    expect(extractInlineTopics('C 语言的 # include 写法 #')).toEqual([])
  })

  it('URL 片段里的 #tag 不产生话题（前置边界：井号前须为开头或空白）', () => {
    expect(extractInlineTopics('See https://x.com#tag #tag')).toEqual(['tag'])
    expect(extractInlineTopics('https://x.com#section')).toEqual([])
  })
})

// #添加话题按钮（topic-tag-unify，PRD §4.2）：点击只在描述末尾追加一个 '#'，
// 话题名由用户自己输入；末尾已是孤立 '#' 时不重复追加。
describe('appendHashToContent（#添加话题按钮）', () => {
  it('空描述点击后内容恰为一个 #', () => {
    expect(appendHashToContent('')).toBe('#')
    expect(appendHashToContent(null)).toBe('#')
  })

  it('普通描述末尾追加分隔空格 + #', () => {
    expect(appendHashToContent('今天探店')).toBe('今天探店 #')
    // 尾部已有空白时不补第二个空格
    expect(appendHashToContent('今天探店 ')).toBe('今天探店 #')
  })

  it('末尾已是孤立 # 时不重复追加（防 ##）', () => {
    expect(appendHashToContent('今天探店 #')).toBe('今天探店 #')
    expect(appendHashToContent('#')).toBe('#')
  })

  it('末尾是完整话题（#话题名）时仍可追加新的 #（连续添加多个话题）', () => {
    expect(appendHashToContent('今天探店 #美食探店')).toBe('今天探店 #美食探店 #')
  })

  it('多行描述追加在末尾', () => {
    expect(appendHashToContent('第一行\n第二行')).toBe('第一行\n第二行 #')
  })
})

describe('URL 片段防护（CCG claude 路评审修复，2026-10-09）', () => {
  it('removeTopicFromContent 不误删 URL 片段里的同名锚点', () => {
    expect(removeTopicFromContent('See https://x.com#tag #tag', 'tag')).toBe('See https://x.com#tag')
  })

  it('appendTopicsToContent 去重不把 URL 片段误判为已有话题', () => {
    // URL 里的 #tag 不是话题 → 追加真正的 #tag
    expect(appendTopicsToContent('See https://x.com#tag', ['tag'])).toBe('See https://x.com#tag #tag')
  })
})
