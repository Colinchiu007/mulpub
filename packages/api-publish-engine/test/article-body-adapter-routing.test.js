'use strict'
/**
 * article-body-adapter-routing.test.js
 *
 * 动因（p3-residual-criteria，2026-10-16）：`verify-platform-onboarding.js` 判据⑩ 实测
 * 6 个平台的适配器**自己**在写 content/description 字段而没走 `formatArticleBody()`
 * ——而 AGENTS.md 的硬规定是「承载形态必须经单一实现，禁止各链自抄转换」。
 *
 * 本文件**按承载形态分档断言**（两种形态的失败面方向相反，不能共用一条判据）：
 *
 *   · **纯文本承载平台**（zhihu / weibo / twitter / tiktok / youtube）：
 *     失败面 = 富文本进描述 ⇒ 用户可见的字面量 `<p>`。
 *     判据：HTML 进 ⇒ **无标签** 出，且内容不丢。
 *
 *   · **HTML 承载平台**（toutiao / baijiahao / wechat_mp）：
 *     失败面 = **纯文本**进正文 ⇒ 平台按 HTML 解析、换行属可忽略空白 ⇒ 整篇塌成一个文本节点
 *     （AGENTS.md 记的 2026-10-12 百家号事故：公开页正文 `<p>`=0）。
 *     判据：纯文本（多行）进 ⇒ **段落以 `<p>` 表达** 出。
 *     ⚠️ 这条正是 toutiao 修复的目标，用「无标签」判据会把修复判成缺陷（本测试第一版就踩了）。
 *
 * A 档（行为级，4 个有可注入缝的适配器）与 B 档（结构级，2 个正文组装深埋在真实网络调用之后的）
 * 的区别见下，**不混为一谈**。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src', 'adapters')
const HTML = '<p>甲</p><p>乙</p>'
const PLAIN_MULTILINE = '甲\n乙'

/** 纯文本承载：产出不得含字面量标签；内容不得被吞。 */
function assertNoTags (text, label) {
  if (typeof text !== 'string') throw new Error(`${label}: 产出不是字符串（${typeof text}）`)
  if (/<[a-z][^>]*>/i.test(text)) {
    throw new Error(`${label}: 正文里出现字面量标签 ⇒ 未走 formatArticleBody：${JSON.stringify(text)}`)
  }
  if (!text.includes('甲') || !text.includes('乙')) {
    throw new Error(`${label}: 正文内容丢失：${JSON.stringify(text)}`)
  }
}

/** HTML 承载：段落必须以 `<p>` 表达，否则平台会把换行当可忽略空白、整篇塌成一段。 */
function assertParagraphHtml (text, label) {
  if (typeof text !== 'string') throw new Error(`${label}: 产出不是字符串（${typeof text}）`)
  if (!/<p>/.test(text)) {
    throw new Error(
      `${label}: HTML 承载平台的正文没有 <p> ⇒ 平台按 HTML 解析会把换行当可忽略空白，整篇塌成一个文本节点：` +
        JSON.stringify(text),
    )
  }
  if (!text.includes('甲') || !text.includes('乙')) {
    throw new Error(`${label}: 正文内容丢失：${JSON.stringify(text)}`)
  }
}

describe('正文承载形态：适配器必须经 formatArticleBody 单一实现', function () {
  // ---------- A 档 · 行为级（有可注入缝）----------
  test('A1 zhihu（纯文本承载）：HTML 进 ⇒ 正文无标签', function () {
    const ZhihuAdapter = require('../src/adapters/zhihu')
    const pd = new ZhihuAdapter().buildPostData({ title: '题', content: HTML, tags: [] })
    assertNoTags(pd.content, 'zhihu.buildPostData().content')
  })

  test('A2 toutiao（HTML 承载）：多行纯文本进 ⇒ 段落以 <p> 表达', function () {
    const ToutiaoAdapter = require('../src/adapters/toutiao')
    const pd = new ToutiaoAdapter().buildPostData({ title: '题', content: PLAIN_MULTILINE, tags: [] })
    assertParagraphHtml(pd.content, 'toutiao.buildPostData().content')
  })

  test('A3 weibo（纯文本承载）：HTML 进 ⇒ 合并后的正文无标签', function () {
    const WeiboAdapter = require('../src/adapters/weibo')
    const pd = new WeiboAdapter().buildPostData({ title: '题', content: HTML, tags: [] })
    assertNoTags(pd.content, 'weibo.buildPostData().content')
  })

  test('A4 twitter（纯文本承载）：execute 真正发出去的 text 无标签（桩 _apiPost 捕获）', async function () {
    const TwitterAdapter = require('../src/adapters/twitter')
    const adapter = new TwitterAdapter()
    // ⚠️ 必须同时桩 _getAuth：它缺 env 时**抛错**，execute 捕获后直接返回，
    //    根本走不到 _apiPost ⇒ 只桩 _apiPost 会让本用例在「没执行到被测路径」的情况下失败
    //    （第一版就是这样，报「_apiPost 未被调用」）。
    adapter._getAuth = function () {
      return { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'x' }
    }
    let captured = null
    adapter._apiPost = async function (endpoint, body) {
      captured = { endpoint, body }
      return { data: { id: 'tweet-1' } }
    }
    await adapter.execute({ title: '题', content: HTML, tags: [] }, null, {})
    if (!captured) throw new Error('twitter: _apiPost 未被调用（桩没接上，本用例未真正执行被测路径）')
    if (captured.endpoint !== '/2/tweets') throw new Error(`twitter: 端点变了（${captured.endpoint}）`)
    assertNoTags(captured.body.text, 'twitter.execute() → POST /2/tweets 的 text')
  })

  // ---------- B 档 · 结构级（非行为证明）----------
  // tiktok / youtube 的正文组装深埋在真实网络调用之后（tiktok 要先 /video/init/ 拿 upload_url
  // 再走上传协议切片；youtube 要先 OAuth 换 token），没有可注入缝 ⇒ 只能做结构断言。
  // ⚠️ 结构档必须定位到「写 description 的那一行」，并把命中数打印出来 + 做下界断言，
  //    否则解析退化成空集合时本档会恒过（本仓已有多次同型假绿事故）。
  const structural = [['tiktok'], ['youtube']]
  for (const [slug] of structural) {
    test(`B ${slug}（结构档，非行为证明）：写 description 的表达式必须调用 formatArticleBody`, function () {
      const file = path.join(SRC, `${slug}.js`)
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      // ① 定位 description 字段写法：找不到即红（判据失效不得静默跳过）
      const fieldLines = lines.filter((l) => /^\s*description:/.test(l))
      if (fieldLines.length === 0) {
        throw new Error(`B ${slug}: 未定位到 description 字段写法（判据失效，不得假绿）`)
      }
      // ② 命中数打印 + 下界断言（本仓纪律：结构解析必须打印命中数并做下界断言）
      const calls = lines.filter((l) => l.includes('formatArticleBody('))
      // eslint-disable-next-line no-console
      console.log(`  [B ${slug}] description 字段行 ${fieldLines.length} 条 / formatArticleBody 命中 ${calls.length} 条`)
      if (calls.length < 1) {
        throw new Error(`B ${slug}: formatArticleBody 命中数 ${calls.length} < 1 ⇒ 正文未过单一实现`)
      }
      // ③ description 的取值本身必须来自 formatArticleBody（tiktok 是先组装再引用，故两形态都接受）
      const referenced = fieldLines.some((l) => l.includes('formatArticleBody('))
      const composed = lines.some((l) => /composedDescription\s*=\s*.*formatArticleBody\(/.test(l))
      if (!referenced && !composed) {
        throw new Error(`B ${slug}: description 的取值既不直接调用也不来自 formatArticleBody 组装`)
      }
    })
  }
})
