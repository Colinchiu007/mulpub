/**
 * search-jump-sources — 中文搜索源「跳转清单」（**不抓取**）
 * 与 content-intelligence 的关系：
 *   content-intelligence = **抓取型**源（JSON API，结果回到本应用）
 *   本文件               = **跳转型**源（打开第三方搜索页，结果留在对方站点）
 * 刻意分离：抓取 HTML 搜索页的反爬/合规成本与风险远高于跳转，
 * 且跳转不复制对方内容，规避版权与 ToS 争议。
 *
 * ## 三条硬纪律（不可破）
 *
 * ① **`%s` 必须 `encodeURIComponent`，且只替换一次**
 *    用 `replace` 而非 `replaceAll` —— 模板里多个 `%s`、或查询串里恰好含有 `%s`
 *    都会造成注入。`validateJumpSources()` 另外断言每个模板**恰含一个** `%s`。
 * ② **返回值必须过 `safeHttpUrl()`**
 *    AGENTS.md 明确「外部可控 URL 绑定可点击锚点前必须过共享协议判据」。本项 URL 由
 *    **模板 + 用户输入**拼成，属外部可控。不过判据 = `javascript:` 可能进 href，
 *    而渲染进程持有 `window.electronAPI`。
 * ③ **跳转走受控内嵌视图，禁止 `shell.openExternal`**
 *    后者把用户带离应用且失去 `allowed_origins` 约束。（消费方纪律，本文件只负责产出 URL。）
 *
 * ## 为什么与 content-intelligence 并列而不是并入
 *
 * `content-intelligence.search()` 返回 `{results, sources, total}`，语义是「**抓回来的结果**」。
 * 跳转源**没有结果** —— 混进同一返回会污染 `total` 与 `relevanceOn` 门禁语义
 * （那两个字段是「源无响应」与「都不相关」的判据基础）。
 *
 * ## 抓取禁令
 *
 * 本文件**不得**出现 `axios` / `fetch` / `http.request` —— 由
 * `search-jump-sources.test.js` 的源码扫描逐条锁定。第二段（HTML 抓取）本次**不做**，
 * 三条理由见设计文 §8.2 与 §10.3-X-5。
 */
'use strict'

/**
 * safeHttpUrl 走共享判据（唯一真源，禁止第二份 /^https?:/）。
 *
 * ⚠️ **硬 require，不 try/catch**：本文件第一版写成
 * `try { ({safeHttpUrl} = require('./safe-http-url.js')) } catch { safeHttpUrl = null }`，
 * 两处都错 —— ① 路径错（该模块在 packages/shared-utils/src，不在本目录）；
 * ② catch 把错吞了并**静默降级**：`buildSearchUrl` 从此对一切输入返回 null，
 * 而测试里只看到「都是 null」，看不出是门禁失效还是查询为空。
 * **门禁类依赖静默失效 = 「更坏的失败」形态**，故此处 fail-loud。
 */
const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')

/**
 * 跳转源清单（冻结）。
 *
 * 形态对齐竞品 `deepsearchercat.txt` 的 `{主题分组:[{name,url}]}`，
 * 但**逐条复核过**：只保留 https 页面型搜索入口，剔除需要 Key / 已失效 / 非搜索页的条目。
 * `hosts` 是**允许跳转的 host 白名单**（`validateJumpSources` 断言模板 host 在其中）。
 */
const JUMP_SOURCES = Object.freeze([
  // ── 综合 ─────────────────────────────────────────────────────────
  { id: 'baidu', name: '百度搜索', group: '综合', urlTemplate: 'https://www.baidu.com/s?wd=%s', hosts: ['www.baidu.com'] },
  { id: 'so360', name: '360搜索', group: '综合', urlTemplate: 'https://www.so.com/s?q=%s', hosts: ['www.so.com'] },
  { id: 'sogou', name: '搜狗搜索', group: '综合', urlTemplate: 'https://www.sogou.com/web?query=%s', hosts: ['www.sogou.com'] },
  { id: 'bing_cn', name: '必应搜索', group: '综合', urlTemplate: 'https://cn.bing.com/search?q=%s', hosts: ['cn.bing.com'] },
  { id: 'chinaso', name: '中国搜索', group: '综合', urlTemplate: 'http://www.chinaso.com/search/pagesearch.htm?q=%s', hosts: ['www.chinaso.com'] },

  // ── 知识 ─────────────────────────────────────────────────────────
  { id: 'baidu_zhidao', name: '百度知道', group: '知识', urlTemplate: 'https://zhidao.baidu.com/search?word=%s', hosts: ['zhidao.baidu.com'] },
  { id: 'zhihu_search', name: '知乎搜索', group: '知识', urlTemplate: 'https://www.zhihu.com/search?type=content&q=%s', hosts: ['www.zhihu.com'] },
  { id: 'wikipedia_zh', name: '中文维基百科', group: '知识', urlTemplate: 'https://zh.wikipedia.org/w/index.php?search=%s', hosts: ['zh.wikipedia.org'] },

  // ── 内容平台 ─────────────────────────────────────────────────────
  { id: 'bilibili_search', name: 'B站搜索', group: '内容平台', urlTemplate: 'https://search.bilibili.com/all?keyword=%s', hosts: ['search.bilibili.com'] },
  { id: 'xiaohongshu_search', name: '小红书搜索', group: '内容平台', urlTemplate: 'https://www.xiaohongshu.com/search_result?keyword=%s', hosts: ['www.xiaohongshu.com'] },
  { id: 'douyin_search', name: '抖音搜索', group: '内容平台', urlTemplate: 'https://www.douyin.com/search/%s', hosts: ['www.douyin.com'] },
  { id: 'weibo_search', name: '微博搜索', group: '内容平台', urlTemplate: 'https://s.weibo.com/weibo?q=%s', hosts: ['s.weibo.com'] },
])

/** 全部跳转源（冻结副本，调用方改不动内部状态） */
function listJumpSources () {
  return JUMP_SOURCES.map((s) => Object.freeze({ ...s }))
}

/**
 * 按 `name` / `group` **模糊**匹配（大小写不敏感的子串）。
 * 空关键词返回全部 —— 「没筛」与「筛不到」是两件事，前者不该给空列表。
 */
function filterJumpSources (keyword) {
  const all = listJumpSources()
  const kw = String(keyword == null ? '' : keyword).trim().toLowerCase()
  if (kw === '') return all
  return all.filter((s) => s.name.toLowerCase().includes(kw) || s.group.toLowerCase().includes(kw))
}

/**
 * 组装搜索 URL —— **本文件唯一的拼 URL 处**。
 *
 * @param {string} sourceId
 * @param {string} query
 * @returns {string|null} 未知 id / 查询为空 / 过不了 `safeHttpUrl` ⇒ `null`
 */
function buildSearchUrl (sourceId, query) {
  const id = String(sourceId == null ? '' : sourceId)
  const q = String(query == null ? '' : query)

  // 查询为空（或全空白）⇒ null：拼出来的搜索页对用户无意义
  if (q.trim() === '') return null
  if (q.includes('%s')) return null // ★ 查询里含占位符 ⇒ 拒绝，避免二次替换（注入面）

  const src = JUMP_SOURCES.find((s) => s.id === id)
  if (!src) return null

  // ★ 用 replace 而非 replaceAll：只替换**第一次**出现，杜绝多占位符注入
  const url = src.urlTemplate.replace('%s', encodeURIComponent(q))

  // ★ 必须过共享协议判据（AGENTS.md：外部可控 URL 绑定可点击锚点前必过）
  const safe = safeHttpUrl(url)
  return safe || null
}

/**
 * 自检：① 每个 `urlTemplate` 恰含一个 `%s`；② 模板 host 在 `hosts` 白名单里；③ `id` 唯一；
 * ④ `urlTemplate` 过 `safeHttpUrl`。
 *
 * @returns {string[]} 问题清单（空数组 = 通过）
 */
function validateJumpSources () {
  const problems = []
  const seen = new Set()

  for (const s of JUMP_SOURCES) {
    const where = `jumpSource[${s.id}]`

    if (seen.has(s.id)) problems.push(`${where}: id 重复`)
    seen.add(s.id)

    const n = (s.urlTemplate.match(/%s/g) || []).length
    if (n !== 1) problems.push(`${where}: urlTemplate 含 ${n} 个 %s（必须恰好 1 个）`)

    // host 白名单。用内层 IIFE 取 host —— `let host = ''` 的初值会被 ESLint 判为
    // no-useless-assignment（两个分支都先赋值再使用，初值确实无用）。
    const host = (() => {
      try { return new URL(s.urlTemplate.replace('%s', 'x')).host } catch (e) { return '' }
    })()
    if (!host) problems.push(`${where}: urlTemplate 无法解析出 host`)
    else if (!Array.isArray(s.hosts) || !s.hosts.includes(host)) {
      problems.push(`${where}: host ${host} 不在白名单 ${JSON.stringify(s.hosts)} 里`)
    }

    // 模板本身也要是安全的 http(s)（防有人把模板改成 javascript:）
    if (!safeHttpUrl(s.urlTemplate.replace('%s', 'x'))) {
      problems.push(`${where}: urlTemplate 过不了 safeHttpUrl`)
    }
  }

  return problems
}

module.exports = {
  listJumpSources,
  filterJumpSources,
  buildSearchUrl,
  validateJumpSources,
  JUMP_SOURCES,
}
