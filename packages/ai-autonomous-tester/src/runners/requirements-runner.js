/**
 * RequirementsTestRunner - 需求验证运行器
 *
 * 默认路径 (v0.5.0+):
 *   collectFacts() → AgentJudge.judge() → verdict
 *   框架不匹配，由 Agent 做语义判断
 *
 * 使用方式:
 *   // 模式 A: 注入 LLM（CI / 自动化）
 *   const runner = new RequirementsTestRunner({
 *     llmFn: async (prompt) => llmClient.complete(prompt)
 *   });
 *   const result = await runner.runTests({ prdPath, srcDir });
 *
 *   // 模式 B: 无 LLM（交互式 Agent / 人工审查）
 *   const runner = new RequirementsTestRunner();
 *   const result = await runner.runTests({ prdPath, srcDir });
 *   // result._verdict._mode === "prompt" → Agent 读 prompt + 自己回答
 *
 *   // 模式 C: 外部已采集 facts（orchestrator 复用）
 *   const runner = new RequirementsTestRunner();
 *   const result = await runner.runTests({ facts: preComputedFacts });
 */

const { BaseTestRunner } = require("./base-runner");
const { RequirementsVerifier } = require("../verifier/requirements-verifier");
const { MultiDocParser } = require("../parsers/multi-doc-parser");
const { AgentJudge } = require("../agent/agent-judge");

class RequirementsTestRunner extends BaseTestRunner {
  constructor(options = {}) {
    super({ ...options, label: "requirements" });
    this.verifier = options.verifier || new RequirementsVerifier(options);
    this.judge = options.judge || new AgentJudge({
      llmFn: options.llmFn,
      logger: this.logger,
    });
    this.useAgentJudge = options.useAgentJudge !== false; // 默认 true
  }

  async runTests(context = {}) {
    // 跳过条件：既无 prdPath 也无外部 facts
    // Multi-doc mode: parse all docs then judge
    if (context.docPaths && context.docPaths.length > 0 && !context.facts) {
      return this._runWithMultiDocs(context);
    }

    if (!context.prdPath && !context.facts) {
      return {
        type: "requirements",
        summary: { total: 0, passed: 0, failed: 0 },
        details: [],
        skipped: true,
        _reason: "no prdPath or facts provided",
      };
    }

    // 默认路径：collectFacts → AgentJudge
    if (this.useAgentJudge) {
      return this._runWithAgentJudge(context);
    }

    // 向后兼容：旧 verify() 路径（已 deprecated）
    return this._runLegacyVerify(context);
  }

  /**
   * 新主路径：facts 采集 → Agent 语义判断 → verdict → details
   */
    /**
   * Multi-doc mode: parse all docPaths + code features, then AgentJudge
   */
  async _runWithMultiDocs(context) {
    const parser = new MultiDocParser({ prdParser: this.verifier?.prdParser });
    const docResult = await parser.parseAll(context.docPaths);
    const { FeatureDetector } = require("../detectors/feature-detector");
    const detector = new FeatureDetector({ srcDir: context.srcDir || "src" });
    const implItems = await detector.detect();
    const prdItems = filterPrdItemsByFeatureIds(docResult.items || [], context.featureIds);

    // 状态分层（2026-10-12，Gate 9 第 3 层）：带 planned/wont-do/historical 标注的
    // 条目不进覆盖率分母 —— 它们是规划/不做/历史，不是「应实现而未实现」的欠账。
    // 实测 01-docs/PRD.md 357 项里大量规划项曾把覆盖率稀释成存量欠账（#3413 score 0.31）。
    // 未标注（unknown）保持进审计，不因本次修复凭空缩小审计面。
    const auditedItems = prdItems.filter((p) => p.auditScope !== false);
    const excludedItems = prdItems.filter((p) => p.auditScope === false);

    if ((context.featureIds || []).filter(Boolean).length > 0 && prdItems.length === 0) {
      return {
        type: "requirements",
        summary: { total: 0, passed: 0, failed: 0 },
        details: [],
        coverageRate: 0,
        totalPrdFeatures: 0,
        totalImplementedFeatures: implItems.length,
        docSources: docResult.sources || [],
        filtered: true,
        skipped: true,
        _verdict: { decision: "PASS" },
        _facts: { prdItems: [], implItems, docSources: docResult.sources || [] },
      };
    }
    // ⚠️ facts.prdItems 必须用分层后的子集：LLM 只评估交给它的条目，
    // 若仍传全量，excludedItems 会被重新计入分母，分层就白做了。
    const facts = { prdItems: auditedItems, implItems, docSources: docResult.sources };
    const judgeContext = { facts, task: context.task || "coverage" };
    if (context.llmFn) judgeContext.llmFn = context.llmFn;
    const verdict = await this.judge.judge(judgeContext);
    if (verdict._mode === "prompt") {
      const details = facts.prdItems.map(p => ({ testName: p.name, status: "PASSED", type: "pending-agent-judgment", _agentRequired: true }));
      return { type: "requirements", summary: this.summarize(details), details, coverageRate: 0, totalPrdFeatures: facts.prdItems.length, totalImplementedFeatures: facts.implItems.length, docSources: docResult.sources, _verdict: verdict, _facts: facts, _mode: "agent-required" };
    }
    const details = (verdict.items || []).map(it => {
      const s = it.status === "COVERED" ? "PASSED" : it.status === "NOT_IMPLEMENTED" ? "FAILED" : "PASSED";
      return { testName: it.prdFeature, status: s, type: it.status.toLowerCase(), matchedImpl: it.matchedImpl || "", evidence: it.evidence || "", reasoning: it.reasoning || "" };
    });
    const summary = this.summarize(details);
    // 分层可见性：被排除的条目不进分母，但必须在结果里显式列出，
    // 否则「覆盖率上升」会被误读成「实现变多了」（实际只是分母变小）。
    const excluded = excludedItems.map(p => ({
      testName: p.name, status: "SKIPPED", type: "excluded-by-status",
      itemStatus: p.status, statusTag: p.statusTag,
      reasoning: `PRD 标注【${p.statusTag || p.status}】：规划/不做/历史类条目，不计入覆盖率分母`,
    }));
    return {
      type: "requirements",
      summary,
      details,
      excludedDetails: excluded,
      excludedCount: excluded.length,
      auditedCount: auditedItems.length,
      // 判据来源（2026-10-12 CI 事故）：inline=true 表示仓库根真源没加载到、
      // 本次用包内兜底判据（同算法，分层仍生效），但报告必须能看见。
      statusCriteriaInline: docResult.statusCriteriaInline === true,
      statusCriteriaResolvedFrom: docResult.statusCriteriaResolvedFrom || null,
      coverageRate: verdict.summary?.coverageRate ?? 0,
      totalPrdFeatures: auditedItems.length,
      totalPrdFeaturesRaw: prdItems.length,
      totalImplementedFeatures: facts.implItems.length,
      docSources: docResult.sources,
      statusStats: docResult.statusStats,
      _verdict: verdict,
      _facts: { prdItems: auditedItems, implItems, docSources: docResult.sources, excludedItems },
      _decision: verdict.decision,
    };
  }

  async _runWithAgentJudge(context) {
    let facts = context.facts;
    if (!facts) {
      facts = await this.verifier.collectFacts({
        prdPath: context.prdPath,
        srcDir: context.srcDir || "src",
      });
    }

    const judgeContext = {
      facts,
      task: context.task || "coverage",
    };
    if (context.llmFn) judgeContext.llmFn = context.llmFn;

    const verdict = await this.judge.judge(judgeContext);

    // Prompt 包模式（无 LLM）：返回 verdict 让 Agent 自己处理
    if (verdict._mode === "prompt") {
      const details = facts.prdItems.map(p => ({
        testName: p.name,
        status: "PASSED",
        type: "pending-agent-judgment",
        _agentRequired: true,
        _reason: "no LLM injected; Agent must read verdict.prompt and respond",
      }));

      return {
        type: "requirements",
        summary: this.summarize(details),
        details,
        coverageRate: 0,
        totalPrdFeatures: facts.prdItems.length,
        totalImplementedFeatures: facts.implItems.length,
        _verdict: verdict,
        _facts: facts,
        _mode: "agent-required",
      };
    }

    // 正常 verdict → 映射到 details
    const details = (verdict.items || []).map(it => mapItemToDetail(it));
    // 如果 verdict 没有 items（罕见），从 summary 反推
    if (details.length === 0 && verdict.summary) {
      details.push(...summaryToDetails(verdict, facts));
    }

    const summary = this.summarize(details);

    // FAIL/NEED_HUMAN 时附加 effort 估算（来自 deprecated 旧逻辑，仅供参考）
    if (verdict.decision !== "PASS") {
      for (const d of details) {
        if (d.status === "FAILED") {
          d.effort = estimateEffort(d.testName);
        }
      }
    }

    return {
      type: "requirements",
      summary,
      details,
      coverageRate: verdict.summary?.coverageRate ?? 0,
      totalPrdFeatures: facts.prdItems.length,
      totalImplementedFeatures: facts.implItems.length,
      _verdict: verdict,
      _facts: facts,
      _decision: verdict.decision,
    };
  }

  /**
   * 旧路径（deprecated）：verify() 用关键词兜底
   */
  async _runLegacyVerify(context) {
    if (!context.prdPath) {
      return {
        type: "requirements",
        summary: { total: 0, passed: 0, failed: 0 },
        details: [],
        skipped: true,
      };
    }

    const result = await this.verifier.verify(context.prdPath, {
      srcDir: context.srcDir || "src",
    });

    const details = [];
    for (const c of result.covered) {
      details.push({
        testName: c.prdFeature.name,
        status: "PASSED",
        type: "covered",
        effort: c.prdFeature.effort || "MEDIUM",
      });
    }
    for (const u of result.uncovered) {
      details.push({
        testName: u.prdFeature.name,
        status: "FAILED",
        type: "uncovered",
        effort: u.effort,
        status_reason: "PRD feature not detected in code (keyword fallback)",
      });
    }

    return {
      type: "requirements",
      summary: this.summarize(details),
      details,
      coverageRate: result.coverageRate,
      totalPrdFeatures: result.totalPrdFeatures,
      totalImplementedFeatures: result.totalImplementedFeatures,
      _deprecated: "Use _runWithAgentJudge path; verify() is keyword-fallback only",
    };
  }
}

// ===== 辅助函数 =====

function mapItemToDetail(item) {
  switch (item.status) {
    case "COVERED":
      return {
        testName: item.prdFeature,
        status: "PASSED",
        type: "covered",
        matchedImpl: item.matchedImpl || "",
        evidence: item.evidence || "",
        reasoning: item.reasoning || "",
      };
    case "PARTIAL":
      return {
        testName: item.prdFeature,
        status: "PASSED",
        type: "partial",
        matchedImpl: item.matchedImpl || "",
        evidence: item.evidence || "",
        reasoning: item.reasoning || "",
        _warning: "partial implementation",
      };
    case "NOT_IMPLEMENTED":
      return {
        testName: item.prdFeature,
        status: "FAILED",
        type: "not-implemented",
        matchedImpl: item.matchedImpl || "",
        evidence: item.evidence || "",
        reasoning: item.reasoning || "",
      };
    default:
      return {
        testName: item.prdFeature,
        status: "PASSED",
        type: "unknown",
        _rawStatus: item.status,
      };
  }
}

function summaryToDetails(verdict, facts) {
  const s = verdict.summary || {};
  const items = [];
  let coveredLeft = s.covered || 0;
  let partialLeft = s.partial || 0;
  let missingLeft = s.missing || 0;

  for (const p of facts.prdItems || []) {
    if (missingLeft > 0) {
      items.push({ testName: p.name, status: "FAILED", type: "not-implemented" });
      missingLeft--;
    } else if (partialLeft > 0) {
      items.push({ testName: p.name, status: "PASSED", type: "partial" });
      partialLeft--;
    } else if (coveredLeft > 0) {
      items.push({ testName: p.name, status: "PASSED", type: "covered" });
      coveredLeft--;
    } else {
      items.push({ testName: p.name, status: "FAILED", type: "unknown" });
    }
  }
  return items;
}

function estimateEffort(featureName) {
  const s = (featureName || "").toLowerCase();
  if (/(import|export|批量|batch|自动化|automate|integrate|api)/.test(s)) return "HIGH";
  if (/(显示|展示|提示|按钮|show|display|button|label)/.test(s)) return "LOW";
  return "MEDIUM";
}


/**
 * 过滤 PRD 项：只保留本 PR 声明关联的需求 ID（feat_*）。
 * requiredIds 为空时保持全量（兼容旧行为）。
 */
function filterPrdItemsByFeatureIds(items, requiredIds) {
  if (!Array.isArray(requiredIds) || requiredIds.length === 0) return items || [];
  const idSet = new Set(requiredIds.map(String).filter(Boolean));
  return (items || []).filter((item) => item && typeof item.id === "string" && idSet.has(item.id));
}

module.exports = { RequirementsTestRunner, filterPrdItemsByFeatureIds };

