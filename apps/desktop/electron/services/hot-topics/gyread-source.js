// @ts-check
/**
 * GYREAD AI 情报日报的补拉源定义 —— **当前未挂进任何启用路径**。
 *
 * ⚠️ 合规裁决（2026-10-19，对抗评审 BLOCKING-1）：gyread `robots.txt` 在 `User-agent: *`
 * 组写着 `Disallow: /news/`，Allow 只给具名检索 UA（OAI-SearchBot / ChatGPT-User /
 * PerplexityBot 等）。本应用 `DESKTOP_UA` 是伪装 Chrome 的通用浏览器 UA，落在 `*` 组
 * ⇒ `search-index.json` 与全部 edition 页抓取都在被禁路径上。
 * **服务器返回 200 不等于被许可**；且伪装 UA 主动放弃了「我是检索代理」的身份主张，
 * 「检索/引用」的定性随之塌掉。`Content-Signal: ai-input=yes` 不覆盖此条
 * （robots 按 UA 组判定，与信号开关无关）。
 *
 * 单独成文件的两个理由：
 *   ① **把「实现就绪」与「获准抓取」分开** —— 解析可用 ≠ 允许抓取。源定义与合规依据
 *      自成一处，不会被误当成「已经生效的配置」。
 *   ② **行数门禁**：`hot-topics-service.js` 登记值 534 + 容差 200 = 734，而 main 已
 *      漂移到 671（他人累计 +137），余量将尽。本常量与其合规注释放原文件会把膨胀推过
 *      容差，按门禁意图是**拆分**而非抬基线。
 *
 * 启用前置（详见 openspec change `hot-topics-gyread-ai-source` 的 design.md §2.4）：
 *   ① 站点运营方为本应用新增自报身份的 UA 组并获许可；
 *   ② 抓取 UA 改为自报身份（如 `MultiPublishBot/1.0 (+contact)`），不再伪装浏览器；
 *   ③ 把本常量挂回 `CATEGORY_BOOSTS.ai.sources`，并同步补 locales 渠道文案（zh/en 成对）。
 */
const GYREAD_SOURCE = {
  id: 'gyread-ai', name: 'GYREAD AI 情报日报',
  url: 'https://gyread.com/news/search-index.json',
  parser: 'gyread_index', channel: 'gyread', board: 'ai',
  boostCategory: 'ai', onlyCategory: 'ai',
  headers: {}, intervalMinutes: 60, riskLevel: 'medium',
  throttleKey: 'gyread-index', entryUrl: 'https://gyread.com/news/',
  indexFilter: { days: 3 },
}

module.exports = { GYREAD_SOURCE }
