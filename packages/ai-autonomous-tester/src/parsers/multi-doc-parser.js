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
   * 给解析出的条目附加状态标注（2026-10-12，Gate 9 第 3 层）。
   *
   * 判据单一真源：scripts/gate9-prd-status.js（仓库根，Node 可直接 require）。
   * 这里只做「标注 + 分层」，不改变条目的其余语义；auditScope 供下游
   * （requirements-runner）决定是否计入覆盖率分母。
   *
   * 未标注条目 status=unknown / auditScope=true —— 保持既有行为，
   * 不因为本次修复就把「没标注的」一律排除（那会凭空缩小审计面）。
   */
  _annotateItems(items) {
    let annotator = null;
    try {
      // 相对仓库根：packages/ai-autonomous-tester/src/parsers → 上溯 4 层
      const path = require("path");
      const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
      annotator = require(path.join(repoRoot, "scripts", "gate9-prd-status.js"));
    } catch {
      // 判据模块缺失时 fail-open：全部按 unknown 处理（既有行为），
      // 不因基建缺失就把审计面静默改小
      annotator = null;
    }
    const stats = { implemented: 0, planned: 0, "wont-do": 0, historical: 0, unknown: 0 };
    for (const item of items) {
      if (annotator) {
        const parsed = annotator.parseItemStatus(item.name || "");
        item.status = parsed.status;
        item.statusTag = parsed.tag;
        item.auditScope = annotator.shouldAudit(parsed.status);
      } else {
        item.status = "unknown";
        item.statusTag = null;
        item.auditScope = true;
      }
      stats[item.status] = (stats[item.status] || 0) + 1;
    }
    return stats;
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
