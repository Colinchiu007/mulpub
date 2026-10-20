/**
 * collection-flow 命名空间 —— 采集页「采集 → 改写」两步流程的文案
 * （collection-ux-step-flow，2026-10-20）
 *
 * 为什么独立成一个命名空间（而不是继续加在 `collection` 域里）：
 *   `locales/collection/{zh,en}.js` 原本已 497/498 行，逼近 `.github/scripts/check-max-lines.js`
 *   的 500 行硬限。本轮新增 14 个键会把它顶过限 ⇒ 门禁以 `NEW_OVER_LIMIT` 判红。
 *   门禁给的处方是「按既有 mixin/composable 范式拆分」，故按仓库既有做法
 *   （`locales/<kebab-ns>/{zh,en}.js` 一命名空间一目录，装配文件里 `ns: { ...nsZh }` 单行展开）
 *   拆出本域。装配位置见 `locales/zh.js` / `locales/en.js`。
 *
 * 键位归属说明：这些键**只**服务采集页的两步流程（步骤条 / 分区标题 / 中途提示 / 字数说明），
 * 与 `collection` 域里既有的「采集 + 改写入口」文案（按钮、toast、错误码）语义相邻但不同源，
 * 放一起会让两个域互相拖累行数。
 *
 * 同一轮里 `collection` 域的**字数区间上限文案**也一并对齐到引擎真实上限（0-49999 / 1-50000，
 * 此前仍写 5999/6000）—— 那是**改值**不是加行，故留在原域，不搬到这里。
 */
export default {
  // 步骤条标题（① 采集正文 → ② AI 改写）
  stepCollect: '采集正文',
  stepRewrite: 'AI 改写',
  // 步骤状态说明
  stepCollectRunning: '正在采集原文，请稍候…',
  stepRewriteRunning: '正在改写，请稍候…',
  stepCollectDone: '已采集 {count} 字',
  stepRewriteDone: '改写完成，可保存草稿或直接发布',
  stepCollectFailed: '采集失败，请重试',
  stepRewriteFailed: '改写失败，请重试',
  // 一键改写的中途提示：采集成功**不是**终点，必须点明「现在到第 2 步了」
  // （2026-10-20 用户反馈 P2：否则用户会以为整个操作已经完成）
  oneClickCollectSuccess: '原文采集完成，正在进行第 2 步：AI 改写',
  // 结果分区标题（原文 / 设置 / 结果三块分区）
  collectedContentTitle: '采集到的原文',
  collectedContentCount: '共 {count} 字',
  rewriteSettingsTitle: '改写设置',
  rewriteResultTitle: '改写结果',
  // 字数说明：留空 = 不设限，由引擎自由发挥（默认形态）
  wordCountFreeHint: '留空 = 由 AI 自由发挥（单次上限 50000 字）',
}
