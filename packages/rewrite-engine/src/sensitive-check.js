/**
 * sensitive-check.js — 敏感词检测的单一实现（rewrite-sensitive-precheck-relax 收尾）
 *
 * 为什么从 rewrite-engine-core.js 拆出来：core 已接近 max-lines 门禁上限
 * （登记值 578 + 容差 200 = 778，2026-10-21 实测 749 行，余量仅约 29 行），
 * 而敏感词语义是**会被反复改动的活跃面**——2026-10-20 刚因为它把前置拦截关掉，
 * 注释一厚就超了 4 行、被 CI 判 LEDGER_GREW。把这段连它的解释一起搬到独立模块，
 * core 的行数不再被这条语义的注释推着走。
 *
 * 语义（2026-10-20 定，2026-10-21 保持不变）：
 *   - 前置（pre）**不拦截**，只如实记录命中；
 *   - 后置（post）维持原样：上报 hits，由 _assembleResult 转 warnings 提醒人工审核。
 *
 * 关前置的原因：词库是内置示例级（sensitive-filter.js 的 24 词）且无任何配置入口
 * ——既不吃运营中心远程词库，也无 UI 开关。实测历史/时政类长文仅因「爆炸」「走私」
 * 这类日常词汇被整篇拒绝；而前置拦的是用户自己的输入，用户无申诉渠道。
 *
 * 不可回退的连带约束：知识库「双零命中」条件（rewrite() 第 5b 步）——
 * `preCheck.hits.length === 0 && postCheckHits.length === 0` 才 recordFeedback，
 * 命中敏感词的内容不进知识库，避免把敏感内容固化成学习样本。
 *
 * 恢复拦截：把本文件的 blocked 判断改回
 * `stage === 'pre' && hits.length > 0` 即可，调用点（rewrite() /
 * segment-rewriter.js）无需改动。
 */

/**
 * 敏感词检测（fail-open：检测异常时不拦截、不留 hits，并留痕）。
 *
 * @param {object} deps
 * @param {object|null} deps.filter - 敏感词过滤器 { detect(text): {hasSensitive, hits} }
 * @param {object} deps.logger - 极简 logger（error 方法）
 * @param {string} text - 待检测文本
 * @param {'pre'|'post'} stage - 仅用于异常留痕定位；不参与 blocked 判断
 * @returns {{blocked: boolean, hits: Array}}
 */
function sensitiveCheck (deps, text, stage) {
  const filter = deps && deps.filter
  if (!filter) return { blocked: false, hits: [] }
  try {
    const result = filter.detect(text)
    return {
      blocked: false,
      hits: (result && result.hits) || []
    }
  } catch (e) {
    // 检测异常 fail-open 放行（logging-coverage-audit：必须留痕）。
    // 留痕里带 stage，是为了将来恢复拦截时能分清是哪一档检测出的问题。
    if (deps && deps.logger && typeof deps.logger.error === 'function') {
      deps.logger.error('rewrite-engine', 'sensitive check failed, fail-open', {
        stage,
        error: (e && e.message) || 'unknown',
      })
    }
    return { blocked: false, hits: [] }
  }
}

module.exports = { sensitiveCheck }
