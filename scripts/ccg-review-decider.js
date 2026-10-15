#!/usr/bin/env node
/**
 * 质量节拍 — CCG 外部模型审查模式判定器（§5.6.1 分层设计 · 提交时层）
 *
 * 纯确定性计算，不调用任何外部模型，因此在 pre-commit 里是毫秒级的。
 * 它把 CCG 托管块里那三条「文字约定」变成可执行的判定：
 *
 *   变更 > 30 行                          → dual    双模型审查
 *   变更 ≤ 30 行但涉及 auth/数据库/加密    → dual    双模型审查
 *   变更 ≤ 30 行且低风险                   → single  只调一个模型
 *   S 复杂度 + 低风险（≤10 行且无敏感命中）  → skip    不调
 *
 * 深度双模型审查本身不在这里跑（那是 PR/CI 层的事），本脚本只负责：
 *   1. 算出模式与理由
 *   2. 把结论落盘到 .ccg/reviews/<sha>.json，供 PR 层与事后审计读取
 *
 * 用法：
 *   node scripts/ccg-review-decider.js              # 判定并落盘
 *   node scripts/ccg-review-decider.js --print      # 只打印，不落盘
 *   node scripts/ccg-review-decider.js --sha <sha>  # 指定 sha（PR 层用）
 *
 * 退出码恒为 0：判定结果不阻断提交（深度审查在 PR 层），阻断由那层负责。
 */

"use strict";

/** 门禁脚本版本。分发到各项目后用 check-gate-drift.js 比对规范源，防止副本漂移。 */
const CCG_GATE_VERSION = "1.1.0";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

// ═══════════════════════════════════════════════════════════════════
//  规则配置
// ═══════════════════════════════════════════════════════════════════

const RULES = {
  // 跨家族对抗的触发阈值。
  // ⚠️ 必须与 §12.6 Review Army 对齐：Red Team 的触发条件是「>200 行或有 CRITICAL」。
  //    初版用 30 行会让大量中等改动无谓地起两个外部进程；而用「行数少」当 skip 理由
  //    更严重——§12.6 明确 Testing / Maintainability 专家「总是触发」。
  dualLineThreshold: 200,

  // skip 只允许由 docs-only 快通道（§11.2b 文档白名单）触发，不因行数少而触发。
  docsOnlyExtensions: new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]),
  docsOnlyDirs: ["docs/", "doc/", ".github/ISSUE_TEMPLATE/"],

  // 只统计源码文件的变更行数（文档/资源不计入复杂度）
  codeExtensions: new Set([
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte",
    ".py", ".go", ".java", ".kt", ".rs", ".rb", ".php", ".cs", ".c", ".cpp", ".h",
    ".sql", ".sh", ".bash", ".ps1", ".yaml", ".yml", ".toml", ".json", ".env",
  ]),

  // 敏感路径：命中即视为 auth / 数据库 / 加密相关
  sensitivePaths: [
    /(^|[\\/])auth([\\/]|\.|$)/i,
    /(^|[\\/])(login|logout|signin|signup|session|jwt|oauth|sso|permission|acl|rbac)([\\/]|\.|$)/i,
    /(^|[\\/])(crypto|cipher|encrypt|decrypt|hash|salt|password|passwd|secret|token|credential)([\\/]|\.|$)/i,
    /(^|[\\/])(migrations?|schema|alembic|db|migrations)([\\/]|\.|$)/i,
    /\.(sql|pem|key|p12|pfx|keystore)$/i,
  ],

  // 敏感内容：改动行里出现即视为敏感
  // ⚠️ 标识符前缀必须容忍下划线与 camelCase：\b 在 DB_PASSWORD / apiSecret 里
  //    都不成立（_ 和字母都算 \w），用 \b 会漏掉最常见的命名方式。
  sensitiveContents: [
    /[A-Za-z0-9_.-]*(password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|credential)s?\s*[:=]/i,
    /(?:^|[^A-Za-z0-9_])(bcrypt|scrypt|argon2|pbkdf2|jwt|oauth|aes|des|rsa)\s*\(/i,
    /[A-Za-z0-9_]*(md5|sha1|sha256)\s*\(/i,
    /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)\b/i,
    /(密钥|加密|解密|口令|密码|凭据|鉴权|授权)/,
  ],
};

// ═══════════════════════════════════════════════════════════════════
//  采集
// ═══════════════════════════════════════════════════════════════════

function git(args, opts = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      ...opts,
    });
  } catch (_) {
    return null;
  }
}

/**
 * 采集"已落地的改动"：从 git 暂存区读（验证层用）
 */
/**
 * 采集「一批 diff」的变更集（暂存区 / 已提交区间 共用同一套解析）。
 *
 * ★ 2026-10-15 从 collectStaged 抽出（残余 2）：
 *   解析逻辑一行未改，只把两条 git 命令变成参数 ——
 *   这样「已提交区间」（`--base`，事后补跑用）能复用同一套
 *   切段 / 重命名解析 / 读取缺口记账，不必抄第二份。
 */
function collectFromDiff(numstatArgs, diffArgs) {
  const numstat = git(numstatArgs);
  if (numstat === null) return null;

  // ★ 2026-10-15 修（缺陷 A + B），并吸收 QM-6 评审 i5/i6：
  //
  //   A) 敏感内容判定原来跑在「全部暂存行」（含 .md 文档）上，与 pathHits 的
  //      codeFiles 口径不一致 ⇒ 在文档里分析加密机制会被判成「改动涉及加密」。
  //   B) 规模/敏感判定依赖整仓 `git diff --cached -U0` 的一次读取；实测某次
  //      rebase 产生的提交在判定记录里被采成 `changedLines=0, fileCount=1`。
  //      ⚠️ 该成因（GIT_INDEX_FILE 指向 rebase 临时 index）目前是**假设，未证实**
  //      —— 我只有那一条观测，没做出可复现的最小实验。评审 i1 也正是指这一点。
  //      故本函数只保证「不再把读取失败静默吞掉」（见 lineReadGaps），
  //      **不宣称已修好 B**。
  //
  //   为什么用「单次全量 diff + 按文件切段」而不是「每文件一次 git diff」（i5）：
  //     ① 大 PR（数百文件）会在 pre-commit 里派生数百个子进程；
  //     ② 逐文件读取失败若被 catch 吞掉，与 B 同构的**静默失败**只是换了个触发点。
  const diff = git(diffArgs) || "";

  // numstat 对重命名输出 "old => new" 或 "src/{old => new}.js"（i6）。
  // 直接拿它当路径会定位不到 ⇒ 该文件的变更行静默为空、敏感判定漏检。
  // 旧实现用整仓 diff 由 git 自己处理 rename，没有这个问题；切段后必须自己解析。
  const resolveRenamed = (raw) => {
    if (!raw || !raw.includes("=>")) return raw;
    const brace = raw.match(/^(.*)\{(.*?)\s*=>\s*(.*?)\}(.*)$/);
    if (brace) return `${brace[1]}${brace[3]}${brace[4]}`;
    const parts = raw.split("=>");
    return parts[parts.length - 1].trim();
  };

  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [add, del, ...rest] = line.split("\t");
      const rawPath = rest.join("\t");
      return {
        file: resolveRenamed(rawPath),
        rawFile: rawPath,
        binary: add === "-" || del === "-",
        added: add === "-" ? null : Number(add),
        deleted: del === "-" ? null : Number(del),
      };
    });

  // 把整仓 diff 按 `diff --git` 切段，用段内 `+++ b/<path>` 认领目标文件。
  //
  // ★ 2026-10-15 由新加的 collectStaged 真实覆盖测试当场抓出的 bug：
  //   **删除文件**时 `+++` 是 `/dev/null`，路径只在 `--- a/<path>` 里。
  //   只认 `+++` 会让每个被删除的文件都落进 lineReadGaps（误报），
  //   而且它的删除行完全没被采集（敏感内容漏检）。
  const linesByFile = new Map();
  for (const seg of diff.split(/^diff --git /m).slice(1)) {
    const strip = (s) => {
      const t = String(s).trim();
      return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
    };
    const plusM = seg.match(/^\+\+\+ (?:b\/)?(.*)$/m);
    let target = plusM ? strip(plusM[1]) : "";
    if (!target || target === "/dev/null") {
      const minusM = seg.match(/^--- (?:a\/)?(.*)$/m);
      target = minusM ? strip(minusM[1]) : "";
    }
    if (!target || target === "/dev/null") continue;
    const lines = seg
      .split("\n")
      .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
      .map((l) => l.slice(1));
    linesByFile.set(target, lines);
  }

  const codeFileSet = new Set(
    files
      .filter((f) => RULES.codeExtensions.has(path.extname(f.file).toLowerCase()))
      .map((f) => f.file)
  );
  // i3：文档文件的变更行单列出来「只报告、不改判定」。
  // 把文档纳入 mode 判定会造成原来的假阳性；完全丢掉又会让「真口令被贴进 .md」
  // 失去唯一的观测点。折中：单独计数并在输出里点名，判据仍只看源码。
  const docFileSet = new Set(
    files
      .filter((f) => RULES.docsOnlyExtensions.has(path.extname(f.file).toLowerCase()))
      .map((f) => f.file)
  );

  const changedLines = [];
  const codeChangedLines = [];
  const docChangedLines = [];
  const lineReadGaps = [];
  for (const f of files) {
    const lines = linesByFile.get(f.file) || [];
    // 有规模却读不到行：明确记账，不再静默当「无敏感内容」（i5 后半条）
    if (lines.length === 0 && !f.binary && ((f.added || 0) + (f.deleted || 0)) > 0) {
      lineReadGaps.push(f.file);
    }
    for (const l of lines) changedLines.push(l);
    if (codeFileSet.has(f.file)) {
      for (const l of lines) codeChangedLines.push(l);
    } else if (docFileSet.has(f.file)) {
      for (const l of lines) docChangedLines.push(l);
    }
  }

  return {
    files,
    changedLines,
    codeChangedLines,
    docChangedLines,
    lineReadGaps,
    codeFiles: files.filter((f) => codeFileSet.has(f.file)),
  };
}

/** 验证层·暂存区：pre-commit 时用（那时改动只在 index 里） */
function collectStaged() {
  return collectFromDiff(["diff", "--cached", "--numstat"], ["diff", "--cached", "-U0"]);
}

/**
 * 验证层·已提交区间：事后补跑时用（那时改动已进 commit，index 通常是空的）。
 *
 * ★ 2026-10-15 增（残余 2 / 补完缺陷 C 的另一半）：
 *   `ccg-gate.js` 支持带显式路径补跑后，**模式判定仍读暂存区**（因为调用 decider 时
 *   一个参数都没传）⇒ 补跑时 index 为空 ⇒ decider 打印「暂存区无变更，跳过审查模式判定」
 *   ⇒ **「需不需要 CCG 审查」这个判据从未真正执行**，而输出读起来像「无需审查」。
 *   本函数提供正确输入：判「相对 base 的这批改动」。
 *
 * 为什么用三点 `base...HEAD`（merge-base）而不是两点：
 *   两点的 `base..HEAD` 会把 base 之后主干上的改动也算进来（那些不是本次的改动），
 *   判出的规模会虚高。三点与 PR 的 diff 语义一致。
 */
function collectRange(base) {
  return collectFromDiff(
    ["diff", `${base}...HEAD`, "--numstat"],
    ["diff", `${base}...HEAD`, "-U0"]
  );
}

/**
 * 采集"尚未落地的方案"：从文档读（决策层用）
 *
 * 决策层跑在动手写码之前，那时没有 git diff，只有方案文档。
 * 这里用文档的「预计改动规模」代替实际 diff 行数：
 *   - 方案里显式写了"预计新增 N 行 / M 个文件"就采信
 *   - 没写就按文档体量估算（非空行 + 代码块行）
 * 敏感判定仍走同一套规则，所以两个层的判定口径一致。
 */
function collectProposal(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { error: `读不到方案文件: ${file} (${err.message})` };
  }

  // 显式声明的预计规模优先于估算
  let declaredLines = null;
  let declaredFiles = null;
  const declLine = text.match(/预计(?:新增|改动|变更)[^\n]{0,12}?(\d+)\s*行/);
  if (declLine) declaredLines = Number(declLine[1]);
  const declFile = text.match(/(\d+)\s*个?(?:文件|模块|接口|函数)/);
  if (declFile) declaredFiles = Number(declFile[1]);

  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).join("\n");
  const nonEmpty = text.split("\n").filter((l) => l.trim()).length;
  const codeLines = codeBlocks
    .split("\n")
    .filter((l) => l.trim() && !/^\s*(#|\/\/|\*|<!--)/.test(l)).length;

  const changedLines = declaredLines !== null ? declaredLines : Math.max(nonEmpty, codeLines);
  const fileCount = declaredFiles !== null ? declaredFiles : 1;

  // 抽正文里的路径样式 token —— 既用于敏感判定，也用于事后范围漂移比对
  const allPaths = new Set();
  for (const line of text.split("\n")) {
    const tokens = line.match(/[\w./\\-]{3,}\.[A-Za-z]{1,5}\b/g) || [];
    for (const tk of tokens) allPaths.add(tk);
  }
  // 过滤掉明显不是文件路径的（域名、版本号之类）
  const plannedFiles = [...allPaths].filter(
    (p) => !/^https?:/i.test(p) && !/^\d+(\.\d+)+/.test(p) && /[\\/]|\.[A-Za-z]{1,5}$/.test(p)
  );

  return {
    proposal: true,
    files: [{ file, added: changedLines, deleted: 0 }],
    changedLines: text.split("\n"),
    plannedFiles,
    stats: {
      changedLines,
      fileCount,
      declared: declaredLines !== null || declaredFiles !== null,
      docLines: text.split("\n").length,
      estimated: declaredLines === null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  判定
// ═══════════════════════════════════════════════════════════════════

/** 是否全部改动都落在文档白名单内（§11.2b docs-only 快通道的唯一 skip 依据） */
function isDocsOnly(staged) {
  if (staged.proposal) return false; // 方案评审不走 docs-only
  if (!staged.files.length) return false;
  return staged.files.every((f) => {
    const ext = path.extname(f.file).toLowerCase();
    const p = f.file.replace(/\\/g, "/").toLowerCase();
    if (RULES.docsOnlyDirs.some((d) => p.startsWith(d))) return true;
    return RULES.docsOnlyExtensions.has(ext);
  });
}

function judge(staged) {
  // 决策层：方案本身通常是 .md，不能按源码扩展名过滤（否则规模会被算成 0）
  const isProposal = !!staged.proposal;
  const codeFiles = isProposal
    ? staged.files
    : staged.files.filter((f) =>
        RULES.codeExtensions.has(path.extname(f.file).toLowerCase())
      );
  const changedLines = isProposal
    ? (staged.stats ? staged.stats.changedLines : 0)
    : codeFiles.reduce(
        (sum, f) => sum + (f.added || 0) + (f.deleted || 0),
        0
      );

  // 敏感命中：路径 或 内容，任一即可
  const pathHits = codeFiles
    .map((f) => f.file)
    .filter((f) => RULES.sensitivePaths.some((re) => re.test(f)));

  // 决策层：方案文件本身叫 plan.md，不含敏感信息，但正文里点名的待改文件含。
  // 所以从正文抽出路径样式的 token 再跑一遍路径规则。
  let plannedPathHits = [];
  if (isProposal && staged.plannedFiles) {
    plannedPathHits = staged.plannedFiles.filter((tk) =>
      RULES.sensitivePaths.some((re) => re.test(tk))
    );
  }

  // ★ 2026-10-15 修（缺陷 A）：contentHits 必须只跑**源码文件**的变更行。
  //   原实现跑在 `staged.changedLines`（含 .md 文档行）上，与 pathHits 的
  //   codeFiles 口径不一致 ⇒ 在文档里写「加密/口令」的分析文字会被判成
  //   「改动涉及加密」，误置 deepReview.required。
  //   现在用 collectStaged() 额外产出的 codeChangedLines（已按 codeExtensions 过滤）。
  const contentHits = (staged.codeChangedLines || []).filter((l) =>
    RULES.sensitiveContents.some((re) => re.test(l))
  );
  const sensitive =
    pathHits.length > 0 || plannedPathHits.length > 0 || contentHits.length > 0;

  let mode, reason;
  if (changedLines > RULES.dualLineThreshold) {
    mode = "dual";
    reason = `变更 ${changedLines} 行 > ${RULES.dualLineThreshold} 行阈值（对齐 §12.6 Red Team）`;
  } else if (sensitive) {
    mode = "dual";
    const parts = [];
    if (pathHits.length) parts.push(`敏感路径 ${pathHits.slice(0, 3).join(", ")}`);
    if (plannedPathHits.length) parts.push(`方案点名敏感文件 ${plannedPathHits.slice(0, 3).join(", ")}`);
    if (contentHits.length) parts.push(`敏感内容 ${contentHits.length} 处`);
    reason = `变更 ${changedLines} 行（≤ ${RULES.dualLineThreshold}）但命中 auth/数据库/加密：${parts.join("；")}`;
  } else if (isDocsOnly(staged)) {
    // 仅 docs-only 快通道允许完全跳过（§11.2b）
    mode = "skip";
    reason = "改动全部命中文档白名单 → 走 §11.2b docs-only 快通道";
  } else {
    mode = "single";
    reason = `变更 ${changedLines} 行（≤ ${RULES.dualLineThreshold}）且无敏感命中 → 走 §12.6 常规专家分派`;
  }

  // i3：文档行里的敏感词**只报告、不改判定**。
  // 纳入 mode 判定会造出原来的假阳性（在文档里分析加密机制被判成「改动涉及加密」）；
  // 完全不看又会让「真口令被贴进 .md」失去观测点。折中：单独计数，由 CLI 点名。
  const docContentHits = (staged.docChangedLines || []).filter((l) =>
    RULES.sensitiveContents.some((re) => re.test(l))
  );
  const lineReadGaps = staged.lineReadGaps || [];

  return {
    mode,
    reason,
    stats: {
      changedLines,
      fileCount: staged.files.length,
      codeFileCount: isProposal ? staged.files.length : codeFiles.length,
      sensitivePathHits: pathHits,
      plannedPathHits,
      sensitiveContentHits: contentHits.length,
      // 只报告、不参与 mode 判定的两栏（评审 i3 / i5）
      docSensitiveContentHits: docContentHits.length,
      docSensitiveContentSample: docContentHits.slice(0, 3),
      lineReadGaps,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  落盘（可审计）
// ═══════════════════════════════════════════════════════════════════

function saveRecord(result, sha, layer, plannedFiles) {
  const dir = path.join(process.cwd(), ".ccg", "reviews");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sha}.json`);
  const record = {
    sha,
    layer: layer || "diff", // plan = 决策层(动手前) | diff = 验证层(动手后)
    mode: result.mode,
    reason: result.reason,
    stats: result.stats,
    // 内容寻址键：暂存区 diff 的哈希，且排除 .ccg 自身。
    //
    // 为什么必须这样：pre-commit 阶段新 commit 的 sha 还不存在，
    // 记录只能写在父 sha 上；提交完深度审查按新 HEAD 找，必然落空。
    // 试过用 git write-tree 做键，不行——判定器自己的输出文件
    // 也会被 git add 进同一个 commit，tree 因此移位，键对不上。
    //
    // 排除 .ccg 后，pre-commit 的「暂存 diff」与提交后的
    // 「parent..HEAD diff」逐字节相同，可以稳定对上。
    // 实测踩过：不加这个字段，验证层在真实流程里一次都跑不起来。
    stagedDiffHash: (() => {
      try {
        const d = String(git(["diff", "--cached", "--", ".", ":(exclude).ccg"]));
        if (!d.trim()) return undefined;
        return require("crypto").createHash("sha256").update(d).digest("hex");
      } catch (_) { return undefined; }
    })(),
    // 决策层记录方案点名的待改文件，供事后范围漂移比对
    plannedFiles: (layer === "plan" && plannedFiles) || undefined,
    decidedAt: new Date().toISOString(),
    decidedBy: "ccg-review-decider",
    deepReview: {
      required: result.mode !== "skip",
      status: "pending",
      performedBy: null,
      findings: null,
    },
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

function currentSha() {
  return (git(["rev-parse", "HEAD"]) || "").trim() || "unknown";
}

function detectBackends() {
  const wrapper =
    process.env.CODEAGENT_WRAPPER ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "bin", "codeagent-wrapper.exe");
  const exists = fs.existsSync(wrapper);
  return {
    wrapper,
    wrapperExists: exists,
    // 是否装了对应 CLI（只判断可执行文件在不在，不做认证探测——那要联网）
    claude: hasOnPath("claude"),
    opencode: hasOnPath("opencode"),
  };
}

function hasOnPath(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return r.status === 0 && !!r.stdout.trim();
}

// ═══════════════════════════════════════════════════════════════════
//  main
// ═══════════════════════════════════════════════════════════════════

function main() {
  const argv = process.argv.slice(2);
  const printOnly = argv.includes("--print");
  const shaIdx = argv.indexOf("--sha");
  const sha = shaIdx >= 0 && argv[shaIdx + 1] ? argv[shaIdx + 1] : currentSha();
  const inputIdx = argv.indexOf("--input");
  // --base <rev> = 验证层·已提交区间：事后补跑时判 base...HEAD，而不是（通常为空的）暂存区
  const baseIdx = argv.indexOf("--base");
  const base = baseIdx >= 0 && argv[baseIdx + 1] ? argv[baseIdx + 1] : null;

  // --input <方案文件> = 决策层：动手之前对方案判复杂度
  // --base <rev>       = 验证层·已提交区间：事后补跑（残余 2）
  // 两者都无            = 验证层·暂存区：pre-commit
  //
  // ★ 残余 2：三种「拿不到输入」的情形原来都打印**读起来像「无需审查」**的话
  //   （「跳过」「暂存区无变更」），而实际是**判据从未执行**。现在统称「未判定」，
  //   并给出补救命令。仍然 return 0（不阻断提交）—— pre-commit 阶段暂存区为空是常态，
  //   把它变成红会误伤所有提交。
  let staged;
  if (inputIdx >= 0 && argv[inputIdx + 1]) {
    const file = path.resolve(argv[inputIdx + 1]);
    staged = collectProposal(file);
    if (staged.error) {
      console.log(`   [CCG] ${staged.error}`);
      return 0;
    }
  } else if (base) {
    staged = collectRange(base);
    if (!staged) {
      console.log(`   [CCG] ⚠ 未判定：读不到 ${base}...HEAD（base 不存在，或当前不是 git 仓库）`);
      console.log("         这**不等于**「无需审查」。请确认 base 后重跑：--base origin/main");
      return 0;
    }
    if (staged.files.length === 0) {
      console.log(`   [CCG] ⚠ 未判定：${base}...HEAD 为空，没有可判的改动`);
      console.log("         这**不等于**「无需审查」。若你期望有改动，说明 base 选错了。");
      return 0;
    }
  } else {
    staged = collectStaged();
    if (!staged) {
      console.log("   [CCG] ⚠ 未判定：读不到 git 暂存区（不影响提交）");
      console.log("         这**不等于**「无需审查」。补跑请带 --base <rev>。");
      return 0;
    }
    if (staged.files.length === 0) {
      console.log("   [CCG] ⚠ 未判定：暂存区无变更，且未给 --base");
      console.log("         这不是「无需审查」，是「没判」。补跑：--base origin/main");
      return 0;
    }
  }

  const result = judge(staged);
  const backends = detectBackends();
  const layer = staged.proposal ? "决策层(动手前·方案)" : "验证层(动手后·diff)";

  console.log(`   [CCG] 审查模式判定 [${layer}]: ${result.mode.toUpperCase()}`);
  console.log(`          ${result.reason}`);
  if (staged.proposal) {
    const s = staged.stats;
    console.log(
      `          方案规模估算 ${result.stats.changedLines} 行 / ${s.fileCount} 个文件` +
        (s.estimated ? "（方案未声明预计规模，按文档体量估算）" : "（采信方案声明的预计规模）")
    );
  }
  console.log(
    `          变更 ${result.stats.changedLines} 行 / ${result.stats.codeFileCount} 个源文件` +
      (result.stats.sensitivePathHits.length || result.stats.sensitiveContentHits
        ? ` / 敏感命中 ${result.stats.sensitivePathHits.length} 路径 + ${result.stats.sensitiveContentHits} 内容`
        : " / 无敏感命中")
  );
  // i3：文档里的敏感词只报告，不改 mode。点名是为保住这个观测点 ——
  // 「真口令被贴进 .md」原来靠 contentHits 的假阳性顺带被看见，现在必须显式报。
  if (result.stats.docSensitiveContentHits > 0) {
    console.log(
      `          ⚠ 文档行命中敏感词 ${result.stats.docSensitiveContentHits} 处（**不计入模式判定**，请人工确认是否真凭证）：` +
        result.stats.docSensitiveContentSample.map((s) => `「${String(s).slice(0, 40)}」`).join(" ")
    );
  }
  // i5：有规模却读不到变更行 —— 显式报出，不让它退化成「无敏感内容」
  if (result.stats.lineReadGaps && result.stats.lineReadGaps.length > 0) {
    console.log(
      `          ⚠ ${result.stats.lineReadGaps.length} 个文件的变更行读不到（规模取自 numstat）⇒ 敏感内容判定对其失效：` +
        result.stats.lineReadGaps.slice(0, 5).join(", ")
    );
  }

  if (result.mode === "skip") {
    console.log("          S 复杂度低风险，按 CCG 决策矩阵不调外部模型");
  } else {
    const available = ["claude", "opencode"].filter((b) => backends[b]);
    const target = result.mode === "dual" ? "双模型(claude + opencode)" : "单模型(claude)";
    if (available.length === 0) {
      console.log(`          ⚠ 要求 ${target} 深度审查，但两个后端 CLI 都不可用`);
      console.log("            → 降级为 SELF-REVIEW：必须由 agent 自行完成评审并记录结论");
    } else if (result.mode === "dual" && available.length < 2) {
      console.log(`          ⚠ 要求 ${target}，但仅 ${available.join("+")} 可用`);
      console.log("            → 降级为单后端 + 补一次 agent 自评");
    } else {
      console.log(`          要求 ${target} 深度审查，后端就绪（${available.join(" + ")}）`);
    }
    console.log(
      staged.proposal
        ? "          → 决策层：动手之前跑 sh scripts/plan-review.sh，收敛后才可开始写码"
        : "          → 验证层：动手之后跑 sh scripts/deep-review.sh"
    );
  }

  if (!printOnly) {
    const f = saveRecord(
      result,
      sha,
      staged.proposal ? "plan" : "diff",
      staged.plannedFiles
    );
    console.log(`          判定已落盘: ${path.relative(process.cwd(), f)}`);
    if (staged.proposal && staged.plannedFiles && staged.plannedFiles.length) {
      console.log(`          方案点名待改文件 ${staged.plannedFiles.length} 个（供事后范围比对）`);
    }
  }
  return 0;
}

// ★ 残余 3（2026-10-15 顺带修）：加 require.main 守卫并导出。
//
// 原来本文件以无条件的 `process.exit(main());` 结尾、且不导出任何东西，
// 于是测试只能「读源码 → 剥掉最后那行 process.exit → 注入 module.exports → _compile」。
// 那种做法**依赖源码文本**：只要结尾那行的形态变了（例如被缩进进 if 块），
// 剥离就静默失效。本 PR 正好要改这个结尾，所以改成正路：
//   - 测试直接 require 本模块（require 时不执行 main，因为 require.main !== module）
//   - CLI 行为不变（作为入口运行时才 process.exit）
if (require.main === module) {
  process.exit(main());
}

module.exports = {
  RULES,
  judge,
  collectStaged,
  collectFromDiff,
  collectRange,
  collectProposal,
  isDocsOnly,
};

