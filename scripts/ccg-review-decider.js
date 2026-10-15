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
function collectStaged() {
  const numstat = git(["diff", "--cached", "--numstat"]);
  if (numstat === null) return null;

  // ★ 2026-10-15 修（缺陷 A + B）：
  //   原实现只用一条 `git diff --cached -U0`，然后把所有 +/- 行塞进 changedLines。
  //   两个后果：
  //     A) changedLines 含 .md 文档行 ⇒ 敏感内容判定把「文档里分析加密机制」
  //        也算成「改动涉及加密」（假阳性 dual）；
  //     B) rebase --continue 走 git 内部 cherry-pick，pre-commit 触发时
  //        GIT_INDEX_FILE 指向 rebase 临时 index ⇒ 整仓 diff 读不到预期内容，
  //        changedLines 为空 ⇒ 敏感判定失去依据。
  //
  //   修法：**按文件分别取 diff**，并把「该文件是否源码扩展名」一并带回，
  //   让下游能只拿源码文件的行做敏感判定。
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [add, del, file] = line.split("\t");
      return {
        file,
        added: add === "-" ? null : Number(add),
        deleted: del === "-" ? null : Number(del),
      };
    });

  const codeFileSet = new Set(
    files
      .filter((f) => RULES.codeExtensions.has(path.extname(f.file).toLowerCase()))
      .map((f) => f.file)
  );

  // 逐文件取变更行；同时标出它是不是源码文件
  const changedLines = [];
  const changedLinesByFile = new Map(); // file -> string[]
  for (const f of files) {
    let lines = [];
    try {
      const d = git(["diff", "--cached", "-U0", "--", f.file]) || "";
      lines = d
        .split("\n")
        .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
        .map((l) => l.slice(1));
    } catch (_) {
      lines = [];
    }
    changedLinesByFile.set(f.file, lines);
    for (const l of lines) changedLines.push(l);
  }

  // 只含源码文件变更行的视图 —— 敏感内容判定必须用这个，不能用 changedLines
  const codeChangedLines = [];
  for (const f of files) {
    if (!codeFileSet.has(f.file)) continue;
    for (const l of changedLinesByFile.get(f.file) || []) codeChangedLines.push(l);
  }

  return {
    files,
    changedLines,
    codeChangedLines,
    codeFiles: files.filter((f) => codeFileSet.has(f.file)),
  };
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

  // --input <方案文件> = 决策层：动手之前对方案判复杂度
  // 无 --input      = 验证层：对已落地的暂存改动判复杂度
  let staged;
  if (inputIdx >= 0 && argv[inputIdx + 1]) {
    const file = path.resolve(argv[inputIdx + 1]);
    staged = collectProposal(file);
    if (staged.error) {
      console.log(`   [CCG] ${staged.error}`);
      return 0;
    }
  } else {
    staged = collectStaged();
    if (!staged) {
      console.log("   [CCG] 判定器无法读取 git 暂存区，跳过（不影响提交）");
      return 0;
    }
    if (staged.files.length === 0) {
      console.log("   [CCG] 暂存区无变更，跳过审查模式判定");
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

process.exit(main());
