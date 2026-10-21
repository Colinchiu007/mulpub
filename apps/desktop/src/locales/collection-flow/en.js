/**
 * collection-flow namespace — copy for the collection page's two-step
 * (collect → rewrite) flow (collection-ux-step-flow, 2026-10-20).
 *
 * Why a separate namespace instead of more keys in the `collection` domain:
 *   `locales/collection/{zh,en}.js` was already 497/498 lines, right below the
 *   500-line hard limit enforced by `.github/scripts/check-max-lines.js`. The 14
 *   new keys would push it over ⇒ the gate fails with `NEW_OVER_LIMIT`, whose
 *   prescribed remedy is to split along the existing pattern
 *   (`locales/<kebab-ns>/{zh,en}.js` per namespace, expanded in the assembly
 *   files as `ns: { ...nsZh }`). See `locales/zh.js` / `locales/en.js`.
 */
export default {
  // Stepper titles (① collect → ② AI rewrite)
  stepCollect: 'Collect the article',
  stepRewrite: 'AI rewrite',
  // Step status descriptions
  stepCollectRunning: 'Collecting the article…',
  stepRewriteRunning: 'Rewriting, please wait…',
  stepCollectDone: '{count} characters collected',
  stepRewriteDone: 'Rewrite done — save a draft or publish it',
  stepCollectFailed: 'Collection failed, please retry',
  stepRewriteFailed: 'Rewrite failed, please retry',
  // Mid-flow notice for one-click rewrite: a successful collect is NOT the end of
  // the flow — the copy must say step 2 is running (user-reported P2).
  oneClickCollectSuccess: 'Article collected — now running step 2: AI rewrite',
  // Result section titles (article / settings / result)
  collectedContentTitle: 'Collected article',
  collectedContentCount: '{count} characters',
  rewriteSettingsTitle: 'Rewrite settings',
  rewriteResultTitle: 'Rewrite result',
  // Word-count hint: blank = no limit, the AI decides (default)
  wordCountFreeHint: 'Leave blank to let the AI decide (up to 50000 characters per rewrite)',
}
