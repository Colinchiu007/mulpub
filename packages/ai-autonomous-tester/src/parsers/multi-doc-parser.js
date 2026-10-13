const fs = require("fs");
const path = require("path");
const { PRDParser } = require("./prd-parser");

// Document type detection rules
const DOC_RULES = [
  { pattern: /prd/i,            type: "prd",         label: "PRD 需求文档" },
  { pattern: /readme/i,         type: "readme",      label: "项目说明" },
  { pattern: /arch/i,           type: "architecture",label: "架构文档" },
  { pattern: /design/i,         type: "design",      label: "设计文档" },
  { pattern: /integration/i,    type: "integration", label: "集成说明" },
  { pattern: /changelog/i,      type: "changelog",   label: "变更日志" },
  { pattern: /manual|guide|使用说明|用户手册/i, type: "manual", label: "用户手册" },
];

const NON_FEATURE_SECTIONS = [
  "概述", "背景", "简介", "安装", "快速开始",
  "贡献", "许可", "License", "安装说明", "技术栈",
  "前置条件", "环境要求", "项目结构", "目录结构",
];

class MultiDocParser {
  constructor(options = {}) {
    this.prdParser = options.prdParser || new PRDParser(options);
    this.strictMode = options.strictMode !== false;
  }

  async parseAll(docPaths) {
    const paths = Array.isArray(docPaths) ? docPaths : [docPaths];
    const results = [];

    for (const docPath of paths) {
      if (!fs.existsSync(docPath)) {
        console.warn("[MultiDocParser] 文件不存在，跳过:", docPath);
        continue;
      }
      const docType = this._detectType(docPath);
      const items = await this._parseOne(docPath, docType);
      results.push({ type: docType.type, label: docType.label, path: docPath, items, itemCount: items.length });
    }

    // Dedup by name
    const seen = new Set();
    const allItems = [];
    for (const r of results) {
      for (const item of r.items) {
        const key = item.name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push({ ...item, sourceDoc: r.type });
        }
      }
    }

    // 状态标注 + 分层（2026-10-12，Gate 9 第 3 层）：标注在去重之后做一次，
    // 保证每个条目只判一次、统计口径唯一。
    const statusStats = this._annotateItems(allItems);

    return {
      items: allItems,
      sources: results.map(r => ({ type: r.type, label: r.label, path: r.path, itemCount: r.itemCount })),
      statusStats,
      // 判据来源（2026-10-12 CI 事故）：statusCriteriaInline=true 表示仓库根真源没加载到、
      // 本次用的是包内兜底判据。分层**仍然生效**（兜底与真源同算法），但报告要能看见，
      // 不能把「用了兜底」伪装成「用了真源」。
      statusCriteriaInline: this._lastCriteria ? this._lastCriteria.inline : false,
      statusCriteriaResolvedFrom: this._lastCriteria ? this._lastCriteria.resolvedFrom : null,
    };
  }

  _detectType(filePath) {
    const basename = path.basename(filePath);
    for (const rule of DOC_RULES) {
      if (rule.pattern.test(basename)) return { type: rule.type, label: rule.label };
    }
    return { type: "other", label: basename };
  }

  async _parseOne(filePath, docType) {
    switch (docType.type) {
      case "prd": return this.prdParser.parse(filePath);
      case "readme": return this._parseReadme(filePath);
      case "architecture":
      case "design":
      case "integration":
      case "manual":
        return this._parseStructuredDoc(filePath, docType);
      case "changelog": return this._parseChangelog(filePath);
      default: return this._parseGeneric(filePath);
    }
  }

  /**
   * 内联兜底判据（2026-10-12 CI 事故后的根本解）。
   *
   * 为什么必须内联一份：仓库根的 scripts/gate9-prd-status.js 是**单一真源**，但
   * 本包在 CI 上经 `pnpm run test:all:no-desktop`（nx run-many）加载时，
   * `__dirname` 与 `process.cwd()` 都指向不了仓库根（实测：本机全绿、CI 同形状 2 例红，
   * 报 `expected implemented, actual unknown`）—— 判据加载不到 → 全部条目退化成
   * unknown → 分层静默失效。静默 fail-open 曾把「判据没加载」伪装成「PRD 没标注」。
   *
   * 两份的一致性由 tests/gate9-status-tiering.test.js 的「判据表与单一真源一致」锁死：
   * 真源可加载时逐项比对；不一致即红。改判据必须同时改两处（测试会逼着你改）。
   */
  static INLINE_STATUS_TAGS() {
    return {
      implemented: ["已实现", "implemented", "已上线", "done", "shipped"],
      planned: ["规划中", "planned", "待实现", "todo", "future"],
      "wont-do": ["不做", "won't do", "wont-do", "wontdo", "rejected"],
      historical: ["历史", "historical", "legacy", "deprecated", "已废弃"],
    };
  }

  static INLINE_STATUS_ORDER() {
    return ["implemented", "historical", "planned", "wont-do"];
  }

  /**
   * 抽取方括号标注单元（与真源 extractAnnotations 同算法）。
   *
   * ⛔ 必须是**独立方括号单元**，裸词不算（2026-10-13，change: gate9-annot-bracket）。
   * 原实现在这里用 `s.includes(tag)` 裸串匹配，把「浏览历史记录」「不做长度限制」
   * 这类**真实功能**判成排除项，静默缩小审计面（覆盖率虚高）。
   */
  static INLINE_EXTRACT_ANNOTATIONS(text) {
    const s = String(text || "");
    const out = [];
    for (const m of s.matchAll(/【([^】]*)】/g)) {
      out.push(m[1].trim());
    }
    for (const m of s.matchAll(/\[([^[\]]*)\]/g)) {
      const after = s.slice(m.index + m[0].length);
      if (after.startsWith("(") || after.startsWith("[")) continue; // markdown 链接/图片/引用式链接
      out.push(m[1].trim());
    }
    return out;
  }

  /** 用内联判据解析状态（与真源同算法，供兜底与一致性比对）。 */
  static _inlineParseItemStatus(text) {
    const annotations = MultiDocParser.INLINE_EXTRACT_ANNOTATIONS(text).map((a) => a.toLowerCase());
    if (annotations.length === 0) return { status: "unknown", tag: null };
    for (const status of MultiDocParser.INLINE_STATUS_ORDER()) {
      for (const tag of MultiDocParser.INLINE_STATUS_TAGS()[status]) {
        if (annotations.includes(tag.toLowerCase())) return { status, tag };
      }
    }
    return { status: "unknown", tag: null };
  }

  static _inlineShouldAudit(status) {
    return status === "implemented" || status === "unknown";
  }

  /**
   * 定位仓库根下的判据模块（scripts/gate9-prd-status.js）。
   *
   * ⚠️ 不能只靠 `__dirname` 上溯：pnpm/nx 布局下被加载模块的 `__dirname` 可能不落在
   * 仓库根，单侧上溯会静默失败。故多路径探测 + 环境变量逃生门。
   *
   * @returns {{annotator: object|null, resolvedFrom: string|null, inline: boolean}}
   *   annotator 非空表示拿到**仓库根真源**；为空时调用方应退回内联兜底（inline=true）。
   */
  _resolveStatusAnnotator() {
    const tried = [];
    const candidates = [];
    const p = require("path");

    candidates.push({ from: "cwd", root: process.cwd() });
    for (let up = 2; up <= 6; up++) {
      const parts = Array(up).fill("..");
      candidates.push({ from: `__dirname^${up}`, root: p.resolve(__dirname, ...parts) });
    }
    if (process.env.GATE9_STATUS_MODULE) {
      candidates.push({ from: "env:GATE9_STATUS_MODULE", module: process.env.GATE9_STATUS_MODULE });
    }

    for (const c of candidates) {
      const modulePath = c.module || p.join(c.root, "scripts", "gate9-prd-status.js");
      tried.push(`${c.from} -> ${modulePath}`);
      try {
        const mod = require(modulePath);
        if (mod && typeof mod.parseItemStatus === "function") {
          return { annotator: mod, resolvedFrom: c.from, inline: false, tried };
        }
      } catch {
        // 本候选不可用，继续下一个
      }
    }
    return { annotator: null, resolvedFrom: null, inline: true, tried };
  }

  /**
   * 取本次生效的判据实现：优先仓库根真源，取不到则用内联兜底。
   * 返回的 `inline` 标记会一路带到报告里，让「分层用的是兜底判据」可见。
   */
  _statusCriteria() {
    const resolved = this._resolveStatusAnnotator();
    if (resolved.annotator) {
      return {
        parseItemStatus: (t) => resolved.annotator.parseItemStatus(t),
        shouldAudit: (s) => resolved.annotator.shouldAudit(s),
        inline: false,
        resolvedFrom: resolved.resolvedFrom,
      };
    }
    return {
      parseItemStatus: (t) => MultiDocParser._inlineParseItemStatus(t),
      shouldAudit: (s) => MultiDocParser._inlineShouldAudit(s),
      inline: true,
      resolvedFrom: null,
    };
  }

  /**
   * 给解析出的条目附加状态标注（2026-10-12，Gate 9 第 3 层）。
   *
   * 判据单一真源：scripts/gate9-prd-status.js（仓库根，Node 可直接 require）。
   * 这里只做「标注 + 分层」，不改变条目的其余语义；auditScope 供下游
   * （requirements-runner）决定是否计入覆盖率分母。
   *
   * 未标注条目 status=unknown / auditScope=true —— 保持既有行为，
   * 不因为本次修复就把「没标注的」一律排除（那会凭空缩小审计面）。
   *
   * 判据模块**确实加载不到**时 fail-open（全部 unknown，既有行为），但会把
   * `statusAnnotatorResolved` 置为 false 并记录尝试过的路径，让调用方可见——
   * 静默退化曾让 CI 上「分层没生效」表现得像「PRD 没标注」。
   */
  _annotateItems(items) {
    const criteria = this._statusCriteria();
    const stats = { implemented: 0, planned: 0, "wont-do": 0, historical: 0, unknown: 0 };
    for (const item of items) {
      const parsed = criteria.parseItemStatus(item.name || "");
      item.status = parsed.status;
      item.statusTag = parsed.tag;
      item.auditScope = criteria.shouldAudit(parsed.status);
      stats[item.status] = (stats[item.status] || 0) + 1;
    }
    // 判据来源一路可见：inline=true 表示本次用的是包内兜底判据（仓库根真源没加载到）
    this._lastCriteria = { inline: criteria.inline, resolvedFrom: criteria.resolvedFrom };
    return stats;
  }

  /** 判据是否成功加载（供上层可见性，勿静默）。 */
  _statusAnnotatorAvailable() {
    return this._resolveStatusAnnotator().annotator !== null;
  }

  async _parseReadme(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const sections = this.prdParser.splitSections(content);
    const items = [];

    for (const section of sections) {
      const title = section.title.toLowerCase();
      if (/功能|特性|feature|capability|能力|亮点|highlights/.test(title)) {
        items.push(...this.prdParser.extractFeatures(section));
      }
      if (/快速开始|quick.?start|使用|usage|示例|example/.test(title)) {
        const steps = this.prdParser.extractFeatures(section);
        for (const s of steps) s._tag = "usage-flow";
        items.push(...steps);
      }
    }
    for (const item of items) item.source = "readme";
    return items;
  }

  async _parseStructuredDoc(filePath, docType) {
    const content = fs.readFileSync(filePath, "utf8");
    const sections = this.prdParser.splitSections(content);
    const items = [];
    const skipKw = NON_FEATURE_SECTIONS.map(s => s.toLowerCase());

    for (const section of sections) {
      const title = section.title.toLowerCase();
      if (skipKw.some(k => title.includes(k))) continue;
      if (section.level >= 2) {
        const feats = this.prdParser.extractFeatures(section);
        for (const f of feats) {
          const fn = f.name.toLowerCase();
          if (fn.length < 5 || skipKw.some(k => fn.includes(k))) continue;
          f.source = docType.type;
          items.push(f);
        }
      }
    }
    return items;
  }

  async _parseChangelog(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const items = [];
    let capturing = false;
    let versionsSeen = 0;

    for (const line of lines) {
      const verMatch = line.match(/^##\s+\[([^\]]+)\]/);
      if (verMatch) {
        versionsSeen++;
        capturing = versionsSeen <= 2;
        continue;
      }
      if (!capturing) continue;

      // Skip heading lines, only extract list items
      if (/^#{1,3}\s/.test(line)) continue;
      const listMatch = line.match(/^\s*[-*+]\s+(.+)/);
      if (listMatch) {
        const text = listMatch[1].trim();
        if (text.length > 5 && !text.startsWith("**")) {
          items.push({
            id: "chg_" + Math.random().toString(36).substr(2, 9),
            name: text.replace(/^\[.*?\]\s*/, ""),
            completed: true,
            type: "changelog",
            source: "changelog",
          });
        }
      }
    }
    return items;
  }

  async _parseGeneric(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const sections = this.prdParser.splitSections(content);
    const items = [];
    for (const section of sections) {
      if (section.level >= 2) {
        const feats = this.prdParser.extractFeatures(section);
        for (const f of feats) {
          if (f.name.trim().length >= 5) { f.source = "other"; items.push(f); }
        }
      }
    }
    return items;
  }
}

module.exports = { MultiDocParser };
