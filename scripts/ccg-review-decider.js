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
// QM-6 评审后端对的单一真源（change: qm6-review-backend-config）。
// 判定器的「要求 X 深度审查」文案、可用性表、落进记录的请求值，全部由它派生 ——
// 此前这几处各自写死 claude/opencode，于是换后端时判定器与入口体检互不认账。
const RB = require("./lib/ccg-review-backends.js");

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

/**
 * 判定器自己写下的产物 —— 取证面不得**消费**它，但仍要**观测**它。
 *
 * 为什么按路径而不是按扩展名：`.ccg/` 整个目录都是判定器与评审链的输出，
 * 而产物是 `.json`、`codeExtensions` 认它是源码 ⇒ 它正文里逐字复述的方案/记录/上一次理由
 * （含「授权/密钥/加密」）会同时顶高**规模**与**敏感内容命中**两维。实测：同一份在飞差量
 * 暂存档 single/132 行/0 命中，区间档 dual/191 行/3 命中，3 处命中全在 .ccg/reviews/*.json。
 *
 * 单一出处：`judge()` 的规模过滤、`collectFromDiff()` 的行分流、`isDocsOnly()` 的资格判定
 * 三处都调本函数，不得各抄一份正则。
 */
const SELF_ARTIFACT_PATH = /(^|[\\/])\.ccg([\\/]|$)/;

function isSelfArtifact(file) {
  return SELF_ARTIFACT_PATH.test(String(file || ""));
}

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
 * 合并态探测（遗留 10 的前置判据）。
 *
 * ★ 为什么不用 `path.join(repoRoot, ".git", "MERGE_HEAD")`：
 *   linked worktree 的 `.git` 是**文件**（内容 `gitdir: <path>`），硬编码路径在 worktree
 *   里必然读不到 ⇒ 探测恒 false ⇒「在 worktree 里已经修好」与「根本没修」在终端上长得
 *   一模一样。`git rev-parse --verify MERGE_HEAD` 由 git 自己解析 gitdir/worktree 布局，
 *   同一份代码覆盖两条路径（回归锁：`ccg-review-decider.test.js` 的「遗留10-T4」）。
 *
 * ★ 失败方向刻意选 **fail-open**（读不到就报 `merging:false`）：
 *   读不到 git 时回落到历史口径（按暂存区判），代价是「可能多判一次 dual」；
 *   反向（失败报 merging:true）会让**每一次提交**都走合并分支，交集恒为空 ⇒ 全判 skip
 *   ⇒ QM-6 被整体关掉且没有任何红灯。两种错法的量级不同，故不对称处理。
 *
 * ★ QM-6 自扮演裁决 i1（2026-10-21）：fail-open 只对**「git 明确回答没有 MERGE_HEAD」**成立。
 *   原来这一格复用 `git()` 的「catch → null」，于是两种完全不同的事实同形：
 *     ① `rev-parse --verify MERGE_HEAD` 以 128/1 退出 —— 该 ref 不存在，即**真的不在合并中**；
 *     ② spawn 失败（ENOENT / EACCES）或 git 自身崩溃 —— **探测失明**，我们什么都不知道。
 *   ② 被静默读成「不在合并中」，正是遗留 10 的**反面同型**：把工具的失明当成结论。
 *   现在 ② 单独挂到 `probeError` 上，由 CLI 出声告警后**仍**走非合并口径 ——
 *   判定方向保持不变（不因为读不到就关掉或全开 QM-6），但「我不知道」变成可见状态。
 *
 * @returns {{merging: boolean, mergeHead: string|null, probeError: string|null}}
 */
function detectMergeState() {
  let out;
  try {
    // 刻意不复用 git()：它的 catch 会把「ref 不存在」与「进程没起来」压成同一个 null，
    // 而这一格必须区分二者（见上面的 i1）。失败路径的语义见下方 catch 内的分档。
    out = execFileSync("git", ["rev-parse", "--verify", "MERGE_HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const status = err && typeof err.status === "number" ? err.status : null;
    if (status === 128 || status === 1) {
      // ① ref 不存在 ⇒ 确实不在合并中，这是**正常返回**，不是故障。
      return { merging: false, mergeHead: null, probeError: null };
    }
    // ② 拿不到退出码（spawn 失败）或退出码是别的值（崩溃 / 仓库损坏）⇒ 探测失明。
    const detail =
      err && err.code
        ? String(err.code)
        : `exit=${status === null ? "unknown" : status}`;
    return { merging: false, mergeHead: null, probeError: detail };
  }
  const mergeHead = out ? String(out).trim() : "";
  if (!mergeHead) return { merging: false, mergeHead: null, probeError: null };
  return { merging: true, mergeHead, probeError: null };
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

  // 自身产物既不算源码规模，也不进敏感内容取证面（见 isSelfArtifact 的注释）；
  // 但它的行仍被采集，另归 ccgChangedLines 供报告 —— 排除的是"消费"，不是"观测"。
  const isCodeFile = (f) => RULES.codeExtensions.has(path.extname(f.file).toLowerCase()) && !isSelfArtifact(f.file);
  const codeFileSet = new Set(
    files
      .filter(isCodeFile)
      .map((f) => f.file)
  );
  const ccgFileSet = new Set(files.filter((f) => isSelfArtifact(f.file)).map((f) => f.file));
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
  const ccgChangedLines = [];
  const lineReadGaps = [];
  for (const f of files) {
    const lines = linesByFile.get(f.file) || [];
    // 有规模却读不到行：明确记账，不再静默当「无敏感内容」（i5 后半条）
    if (lines.length === 0 && !f.binary && ((f.added || 0) + (f.deleted || 0)) > 0) {
      lineReadGaps.push(f.file);
    }
    for (const l of lines) changedLines.push(l);
    if (ccgFileSet.has(f.file)) {
      for (const l of lines) ccgChangedLines.push(l);
    } else if (codeFileSet.has(f.file)) {
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
    ccgChangedLines,
    lineReadGaps,
    codeFiles: files.filter((f) => codeFileSet.has(f.file)),
  };
}

/** 验证层·暂存区：pre-commit 时用（那时改动只在 index 里） */
// ★ 2026-10-16（QM-6 i2，实测口径分离）：`stagedDiffHash` 排除 `.ccg`，而行数统计原先
// **不排除** ⇒ 同一份暂存 diff 会因「.ccg 是否参与」判出不同的 mode 与不同的记录名。
// 纯 `.ccg/` 提交即该分叉的极端形态：stats 非空（把记录自身算进去）而 hash 为空
// ⇒ 回落旧命名 ⇒ 恰恰回到本次要消灭的跨分支撞名。统一口径为「两者都排除 .ccg」：
// 判定器自己的输出文件不该影响对它的判定。
function collectStaged() {
  return collectFromDiff(
    // 2026-10-20（change: ccg-decider-exclude-self-artifacts，critic 轴 Critical#2）：
    // 这里原本带 :(exclude).ccg ⇒ .ccg 在 git 层就消失，JS 层收不到那些行 ⇒ 暂存档的
    // ccgChangedLines 恒为 0，"唯一观测点"只剩补跑档有。排除动作改由 isSelfArtifact 单点持有，
    // 两档才真的同判且同观测。下方 stagedDiffHash 的那次 git 调用**仍带** pathspec —— 它管记录命名。
    ["diff", "--cached", "--numstat"],
    ["diff", "--cached", "-U0"]
  );
}

/**
 * 验证层·合并态暂存区：`git merge` 的 pre-commit 时用（遗留 10）。
 *
 * ── 要解决的问题（现场证据） ───────────────────────────────────────────
 * 一次 `git merge origin/main` 的 pre-commit 记录被写成
 *   `mode=dual / changedLines=1880 / files=606 / status=pending`
 * 而那次合并**没有引入任何新内容** —— 606 个文件全是主干那侧带进来的。
 *
 * 根因：合并态下 `git diff --cached` 等于「ours tip → 合并结果」，也就是
 * **对方那一侧**的改动集。于是「合并主干」这件零语义动作必然判 dual（主干前进越多，
 * 对方那侧规模越大），每合一次主干就要付 23–40 分钟 QM-6，而审的东西早就被别人
 * 自己的 PR 审过了。
 *
 * ── 修法口径：ours ∩ theirs ────────────────────────────────────────────
 * 只看**两侧自 merge-base 起都动过**的文件。语义：只有这类文件才可能是「真冲突、
 * 真需要人判」；单侧导入的文件属于「把别人的东西搬进来」，它们在原来的 PR 里已经
 * 审过。交集为空 ⇒ 这次合并零语义 ⇒ 由 `judge()` 判 skip（且 CLI 不落盘）。
 *
 * 为什么**不**用另外三种口径：
 *   - `ours ∪ theirs`：= 旧行为（对方整侧全进），没修任何东西；
 *   - 单侧 `diff(base..HEAD)`：等于「只看我这边」，而合并提交并不引入我这侧的改动
 *     （它们已经在 HEAD 里了），结果恒为空 ⇒ 把**真冲突**也判成零语义；
 *   - 「仅冲突文件（index 里 unmerged 的条目）」：冲突一旦被解决，冲突标记就从 index
 *     消失，pre-commit 时（冲突已解、尚未 commit）读到的是**空集** ⇒ 每次真冲突
 *     都被判 skip，方向刚好反了。
 *
 * ── 三条实现约束 ───────────────────────────────────────────────────────
 * ① 路径必须走 `:(literal)` pathspec：文件名里的 `[`、`*`、`?` 是 glob 元字符，
 *    不加 magic 时 `scripts/a[1].js` 会连 `scripts/a1.js` 一起命中 ⇒ 判定读到
 *    **另一个文件**（回归锁：遗留10-T7）。
 * ② 非合并态**返回 null**，不是空对象：调用方必须显式回落到 `collectStaged()`。
 *    返回空对象会被 `judge` 读成「交集为空 ⇒ skip」，把每一次普通提交都跳掉。
 * ③ 交集为空时**不派生 git 子进程**（三份 diff 都省掉）：这是合并的**常态**
 *    （两侧各改各的），而 pre-commit 是每个提交都走的热路径。
 *
 * @param {{merging: boolean, mergeHead: string|null}} [state] 省一次探测用；默认自行探测
 * @returns {null | object} null = 不在合并态（或读不到合并元数据，交由调用方「未判定」）
 */
function collectMergeStaged(state) {
  const st = state || detectMergeState();
  if (!st || !st.merging) return null;

  const baseRaw = git(["merge-base", "HEAD", st.mergeHead]);
  // 刻意写成「先判 null 再 String」，而不是把 git() 的返回值直接喂给 String()：
  // git() 失败返回 **null**，而 String(null) 是字符串 "null"（非空！）—— 同
  // saveRecord 里那条 QM-6 四轮教训。即使加个 `|| ""` 兜住 null，形态也与那条禁令
  // 只差一个后缀，读的人（和结构锁）都不该依赖这个细微差别。
  const base =
    baseRaw === null || baseRaw === undefined ? "" : String(baseRaw).trim();
  // 无共同祖先（如 `--allow-unrelated-histories`）⇒ 交集语义不成立。
  // 这里返回 null 而不是「当成空交集」：空交集会输出 skip 并把这次合并判成零语义，
  // 而两份无关历史的合并**恰恰**是最需要人看一眼的形态。
  if (!base) return null;

  // ★ 2026-10-20（口径对齐 `ccg-decider-exclude-self-artifacts`，合并前 rebase 时补）：
  //   这里原本与 `collectStaged` 的历史写法一样在 git 层排除 `.ccg`，而主干刚把那条
  //   排除动作收敛到 `isSelfArtifact` 单点持有，理由写得很清楚 —— 在 git 层排除会让
  //   JS 层**收不到那些行**，于是本档的 `ccgChangedLines` 结构性恒为 0，观测面凭空少一档。
  //   合并态是同一类判定，同一口径必须同样适用：让 `.ccg` 进交集、进采集，再由
  //   `judge` 的 `!isSelfArtifact` 把它的**消费**排除掉（判定结论不变，观测变完整）。
  //   注意本函数**只服务于判定域**；记录命名（`stagedDiffHash`）的 pathspec 仍带排除，
  //   见 main() 里 `mergeDiffPaths` 那段 —— 那是"判定器自己的输出不该改名记录"的另一件事。
  const sideFiles = (rev) => {
    const out = git([
      "diff",
      "--name-only",
      "--no-renames",
      `${base}..${rev}`,
      "--",
      ".",
    ]);
    if (out === null) return null;
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  const ours = sideFiles("HEAD");
  const theirs = sideFiles(st.mergeHead);
  if (ours === null || theirs === null) return null;

  const theirsSet = new Set(theirs);
  const intersection = ours.filter((f) => theirsSet.has(f));

  const mergeScope = {
    mergeHead: st.mergeHead,
    base,
    oursFileCount: ours.length,
    theirsFileCount: theirs.length,
    intersectionFileCount: intersection.length,
  };

  if (intersection.length === 0) {
    // 零语义合并的常态分支：形态与 collectFromDiff 的返回值一致（judge 直接可用），
    // 但不派生任何 git 子进程。
    return {
      files: [],
      changedLines: [],
      codeChangedLines: [],
      docChangedLines: [],
      lineReadGaps: [],
      codeFiles: [],
      mergeScope,
    };
  }

  const pathspecs = ["--", ...intersection.map((f) => `:(literal)${f}`)];
  const collected = collectFromDiff(
    ["diff", "--cached", "--numstat", ...pathspecs],
    ["diff", "--cached", "-U0", ...pathspecs]
  );
  if (!collected) return null;
  collected.mergeScope = mergeScope;
  return collected;
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
  // 只改了判定器自己的产物 = 没碰任何被测面 ⇒ 与 docs-only 同样跳过。
  // 注意"files 为空"仍不得判 docs-only（那是没读到东西，不是读到了不该判的东西）。
  if (staged.files.length && staged.files.every((f) => isSelfArtifact(f.file))) return true;
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
    : staged.files.filter(
        (f) => RULES.codeExtensions.has(path.extname(f.file).toLowerCase()) && !isSelfArtifact(f.file)
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

  // ★ QM-6 自扮演裁决 i6（2026-10-21）：`changedLines` 的正确性**完全依赖**
  //   「`files` 恰是 merge-base 交集」这条不变量 —— 交集之外的文件一旦漏进来，
  //   行数就是高估的，而记录里 `mergeScope` 与 `changedLines` 各自自洽，
  //   高估在产物上**不可见**（读记录的人无法发现判定域被撑大）。
  //
  //   判据刻意取**上界**而不是相等：交集里的文件在合并结果里可能**没有差异**
  //   （两侧做了同一处修改 ⇒ 合并结果 == ours ⇒ 该文件不进 numstat），
  //   所以 `files` 比交集**少**是合法形态；**多**则一定是漏进来了。
  //   破坏时不抛错、也不静默继续：抛错会让判定器的内部 bug 直接卡死提交，
  //   静默则让高估看起来像正常判定 —— 折中是**出声 + 按最保守方向判 dual**。
  const mergeScopeLeak =
    !!staged.mergeScope &&
    staged.files.length > staged.mergeScope.intersectionFileCount;
  if (mergeScopeLeak) {
    console.log(
      `   [CCG] ⚠ 合并态判定域不变量被破坏：交集声明 ` +
        `${staged.mergeScope.intersectionFileCount} 个文件，判定域里却有 ` +
        `${staged.files.length} 个 ⇒ 有非交集文件漏进判定域，` +
        `changedLines 可能高估。本次按最保守方向判 dual（请修 collectMergeStaged）。`
    );
  }

  let mode, reason;
  // ★ 遗留 10（2026-10-20）：合并态的**零语义**短路必须排在阈值链之前。
  //   口径来源见 collectMergeStaged()：合并态下 `git diff --cached` 是「对方那一侧」，
  //   于是 `changedLines` 量的是「主干前进了多少」，与本次合并引入的内容无关。
  //   交集为空 = 两侧各改各的、没有任何共同文件 = 这次合并不引入需要人判的内容。
  //   放在阈值之后会让它永远命中不到（对方整侧的行数必然超过阈值 ⇒ 先判 dual）。
  if (mergeScopeLeak) {
    mode = "dual";
    reason =
      `合并态判定域不变量被破坏：交集 ${staged.mergeScope.intersectionFileCount} 个文件 / ` +
      `判定域 ${staged.files.length} 个（有非交集文件漏进来）⇒ 判定域不可信，` +
      `按最保守方向判 dual`;
  } else if (staged.mergeScope && staged.mergeScope.intersectionFileCount === 0) {
    const ms = staged.mergeScope;
    const short = (s) => String(s || "").slice(0, 8);
    mode = "skip";
    reason =
      `合并提交：ours ∩ theirs 自 merge-base ${short(ms.base)} 起无共同改动文件（交集为空）` +
      `——ours ${ms.oursFileCount} 个 / theirs ${ms.theirsFileCount} 个文件全是单侧导入` +
      ` ⇒ 本次合并零语义，不调外部模型`;
  } else if (changedLines > RULES.dualLineThreshold) {
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
  // 与 i3 对文档行的处理同构：**只报告、不改判定**。升成阻断判据是自相矛盾的——
  // 这些命中逐字来自方案与执行记录正文，同一份散文一处不消费、另一处拦下来不成立。
  const ccgContentHits = (staged.ccgChangedLines || []).filter((l) =>
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
      // 判定器自身产物里的敏感词命中：已从取证面摘出，仍逐条计数（评审 critic#3 的处置）
      ccgSensitiveContentHits: ccgContentHits.length,
      ccgSensitiveContentSample: ccgContentHits.slice(0, 3),
      lineReadGaps,
      // 合并态才有的判定域元数据（非合并态为 undefined ⇒ JSON 里不出现）。
      // 它必须进 stats 而不是只活在内存里：事后审计要能回答「这次 dual 是按交集判的，
      // 还是按对方整侧判的」—— 否则遗留 10 的形态在记录里不可见。
      mergeScope: staged.mergeScope,
      // i6 的取证栏：不变量被破坏时记 true，正常时 undefined（不进 JSON）。
      mergeScopeLeak: mergeScopeLeak || undefined,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  落盘（可审计）
// ═══════════════════════════════════════════════════════════════════

/**
 * 闭环白名单 —— 与 `check-pr-exec-record.js` 的 `CLOSED_DEEP_REVIEW_STATUSES` **必须一致**。
 *
 * 为什么在此重复定义而不是跨文件 require：decider 跑在 pre-commit 钩子里，被
 * `ccg-review.ps1` / `deep-review.sh` 直接 spawn；跨文件 require 会把耦合伸进钩子启动路径。
 * 重复定义的风险由回归锁兜底：`ccg-review-decider.test.js` 直接读
 * `check-pr-exec-record.js` 的源码断言两处集合相等，改一处忘另一处当场红。
 */
const CLOSED_DEEP_REVIEW_STATUSES = new Set(["cleared", "needs_revision", "self_play_resolved"]);

/**
 * 「有实质内容、不该被覆盖」的状态集合 —— **不等于闭环白名单**。
 *
 * ★ 2026-10-16（QM-6 第二轮 i2）：\`cleared\`/\`needs_revision\`/\`self_play_resolved\` 是闭环态，
 *   被覆盖会把有效结论抹掉。
 *
 * ★ 第三轮 i3 修正：\`self_play_blocked\`/\`self_play_pending\` **不无条件入集** ——
 *   第二轮我把它们直接加进 PRESERVE，注释写「已产出 findings」，但实测本 PR 自带的
 *   \`5e658b47….json\` 就是 \`self_play_pending\` + \`findings: null\`：
 *   那种记录**没有任何实质内容**，保留它只会让同内容 amend 每次另存 alt、无限累积，
 *   且与「保留 = 有实质内容」的判据自相矛盾。
 *   故这两个态改为**由 findings 判据兜**（见 shouldPreserveClosedRecord 的第二条），
 *   不再按状态名无条件保留。
 */
const PRESERVE_BY_STATUS = new Set(CLOSED_DEEP_REVIEW_STATUSES);

/**
 * 是否该**保留**已存在的同名记录（即本次不覆盖它）。
 *
 * ★ 2026-10-16（QM-6 i3 + 变异反证 M7 暴露的缺口）：
 *   内容寻址让「同一变更反复提交/amend」落到同一个文件 —— 这是收敛性的来源，
 *   但副作用是后写静默覆盖先写。若先写那份有实质内容，覆盖会把它丢掉。
 *
 *   首版把这段判定**内联**在 saveRecord 里，只用「grep 源码字面」的结构锁守着；
 *   变异反证立即抓到缺口：把 `if (cond)` 改成 `if (false && cond)` 后所有字面仍在
 *   ⇒ 结构锁全绿而**行为已失效**。故抽成纯函数，让行为锁能真正调用它。
 *
 *   ★ 判据是**两层**，且第二层才是主判据：
 *     ① 状态在闭环白名单 ⇒ 保留（结论有效，不该被抹回 pending）
 *     ② **`deepReview.findings` 是非空数组** ⇒ 保留
 *     第二层让任何状态（含白名单外的未来态、含 blocked/pending）只要**真有内容**就保留；
 *     没有内容的状态一律允许覆盖，不会冻结、不会累积 alt。
 *
 * @returns {boolean} true = 保留旧记录、本次另存（不覆盖）
 */
function shouldPreserveClosedRecord(prev) {
  if (!prev || !prev.deepReview) return false;
  const st = typeof prev.deepReview.status === "string" ? prev.deepReview.status : null;
  if (st && PRESERVE_BY_STATUS.has(st)) return true;
  // 主判据：已产出 findings ⇒ 有实质内容 ⇒ 保留（与状态名无关，未来态也受益）
  const f = prev.deepReview.findings;
  return Array.isArray(f) && f.length > 0;
}

/**
 * 判定记录的文件名 —— **内容寻址**（ccg-record-content-addressing，2026-10-16）。
 *
 * 旧行为：`${sha}.json`，其中 sha 是 pre-commit 时的 HEAD，即**新提交的父提交**。
 *
 * 为什么必须改（实测三次 add/add 冲突）：
 *   父 sha 被**同基线的所有分支共享**。两个从同一基线分叉的会话，各自提交**不同**的变更，
 *   却会写到**同一个文件名**上 ⇒ rebase 时 add/add 冲突；而冲突的任何单侧取法都有损失
 *   （取 ours 丢掉本 PR 的记录，取 theirs 覆盖他人产物 —— 仓规明令禁止「后推覆盖」）。
 *   本轮在 2bcce6833 / 5c7b3c127 / 56e34b56b 三个基线上各撞一次。
 *
 * 顺带修掉两个同源症状：
 *   - **孤儿**：名字指向父提交，`amend` 后该父提交可能不再是历史中的任何提交；
 *   - **不收敛**：闭环需再提交、再提交又按新父 sha 生成新名字。改名后，同一变更
 *     重提交/amend 得到**同一个名字**（覆盖同一文件），天然收敛。
 *
 * 判据：内容寻址键用 `stagedDiffHash`（排除 `.ccg` 的暂存 diff 的 sha256）——
 * 它与引擎 `ccg-deep-review.js::readDecision()` 的内容寻址键**同源**，所以改名对引擎无影响
 * （引擎按记录里的字段匹配、不关心文件名）。
 *
 * 回落：`stagedDiffHash` 为空（例如只改 `.ccg/` 的提交，diff 排除 `.ccg` 后为空）时，
 * 回落到既有的 40 位父 sha 形态 —— 保持门禁 `AUDIT_ARTIFACT_RE` 可识别，且不产生空名。
 * 这类提交多为 `mode: skip`，不参与跨分支的唯一性诉求。
 */
function recordFileName(stagedDiffHash, sha) {
  const h = typeof stagedDiffHash === "string" ? stagedDiffHash.trim() : "";
  if (/^[0-9a-f]{64}$/.test(h)) return `${h}.json`;
  return `${sha}.json`;
}

/**
 * 判定记录的文件内容（含**尾换行**）。
 *
 * ★ 遗留 7（2026-10-20）：历史记录**没有**尾换行。实测主干 1109 份 `.ccg/reviews/*.json`
 *   里 969 份（87.4%）末字节是 `}`，只有少数被编辑器补过的是 `\n`。两个后果：
 *   ① 任何「按行读」的工具（`wc -l`、`git diff --stat`、部分 JSONL 风格的批处理）
 *      会少算一行，同一份内容在两种读数下差 1；
 *   ② 追加/拼接这类文件时，新内容会贴在 `}` 后面形成 `}{`，在**语法上已是坏 JSON**，
 *      而在 diff 里只表现为「一行被改」，读的人看不出是拼接事故。
 *
 * ★ 为什么抽成函数而不是在两处各写一次 `+ "\n"`：写入点有两个（主路径 / alt 路径），
 *   写成两处就是「两次忘记的机会」。抽成一处后，回归锁仍**分别**断言两条路径
 *   （`遗留10-T5`），因为「共用实现」证明不了「两个调用点都用了它」。
 *
 * ★ 不回溯清理历史 969 份：它们是既有评审证据，改动会污染 `git blame` 与
 *   「记录是否被篡改」的判据面；尾换行只对**新写**的记录生效。
 */
function recordBody(record) {
  return JSON.stringify(record, null, 2) + "\n";
}

/**
 * 写一份判定记录。
 *
 * @param {object} result        judge() 的产物（mode/reason/stats）
 * @param {string} sha           pre-commit 时的 HEAD（即新提交的父提交）
 * @param {string} [layer]       plan | diff
 * @param {string[]} [plannedFiles]
 * @param {object} [backends]    detectBackends() 的产物；省略则自行探测
 * @param {object} [opts]        见下（★ 遗留 10 新增，第 6 参）
 * @param {string[]} [opts.diffPaths]
 *   「本次判定所依据的那批文件」的 pathspec（追加在 `git diff --cached` 之后）。
 *   缺省即历史配方 `["--", ".", ":(exclude).ccg"]` ⇒ **非合并态逐字节不变**。
 *   ★ 该缺省的字面量必须留在 git 调用点的实参里（理由见函数体注释）：结构锁按那一行的
 *     字符窗口定位它，上提到函数头会让锁失明 —— 行为不变而 CI 红。
 *
 *   ★ 为什么必须能把 pathspec 换掉（遗留 10 的第二半，实测现场）：
 *     `stagedDiffHash` 是记录文件名（内容寻址）与「事后按 parent..HEAD 找记录」的共同键。
 *     合并态下本次判定只看 `ours ∩ theirs`（见 collectMergeStaged），而这里若仍按全域算哈希，
 *     得到的是**另一批文件**的指纹 ⇒ 记录名与判定依据不同源。
 *     后果不是「名字难看」，而是门禁的 `evaluateDeepReviewDebt` 按 HEAD 侧 diff 找不到那条记录
 *     ⇒ 判「缺记录」；而这条记录的内容又是按交集算的。两个域不一致时**两边都对不上**。
 *     回归锁：`遗留10-T6`（两档 pathspec 必须算出不同哈希）。
 */
function saveRecord(result, sha, layer, plannedFiles, backends, opts) {
  // null = 「没指定 ⇒ 用历史缺省配方」，而**缺省的字面量留在下面那次 git 调用的实参里**。
  //
  // ★ 为什么不在函数头就把缺省填进 diffPaths（本 PR 实测踩过，Gate 2c2 当场红）：
  //   `check-pr-exec-record.test.js` 的「命名配方」结构锁按 `git diff --cached` 那行的
  //   indexOf 读其后 200 字符窗口，再断窗口内含排除 `.ccg` 的 pathspec。缺省上提到
  //   函数头是更"整洁"的写法，行为一寸未变，但字面量从窗口内的 114 偏移飘到窗口外
  //   ⇒ 锁失明、CI 红。判据的可定位性优先于代码的整齐度：这条 recipe 必须待在被测的
  //   那一次 argv 里。行为侧的兜底锁在 `ccg-review-decider.test.js` 的「命名配方行为锁」。
  const diffPaths =
    opts && Array.isArray(opts.diffPaths) && opts.diffPaths.length
      ? opts.diffPaths
      : null;
  const dir = path.join(process.cwd(), ".ccg", "reviews");
  fs.mkdirSync(dir, { recursive: true });
  // 内容寻址键：暂存区 diff 的哈希，且排除 .ccg 自身。
  //
  // 为什么排除 .ccg：判定器自己的输出文件也会被 git add 进同一个 commit，
  // 用它做键会随自身输出移位。排除后，pre-commit 的「暂存 diff」与提交后的
  // 「parent..HEAD diff」逐字节相同，可以稳定对上（实测踩过：不排除就一次都跑不起来）。
  //
  // ★ QM-6 第三轮 i4：配方必须**固定 diff 行为**，否则跨机器/换配置时同一个变更
  //   会算出不同哈希（记录找不到）。`--no-textconv --no-ext-diff` 关掉用户配置的
  //   外部差异与 textconv 驱动；`--no-renames` 关掉重命名检测（否则「重命名 + 小改」
  //   与「删除 + 新增」可能给出不同 diff 文本）。
  //   注意：`autocrlf` 不在此列 —— 它影响的是工作区文件而非 git diff 的输出文本，
  //   且强行 --no-autocrlf 会与仓库 .gitattributes 冲突。此项记为残留风险。
  //
  // ★ QM-6 第三轮 i5：哈希算不出来时**绝不静默回落父 sha** —— 那恰好回到本次要消灭的
  //   跨分支撞名，且无任何告警。改为：显式告警 + 记录里写 stagedDiffHash:null，
  //   让「无键」这件事本身可见（门禁与事后审计都能看到）。
  const hashResult = (() => {
    // ★ 第四轮自查追加（实测踩到）：`git()` 失败时返回 **null**，
    //   而 `String(null)` 是字符串 **"null"**（非空！）⇒ 旧版 `if (!d.trim())` 判不出空
    //   ⇒ 把「git 调用失败」当成「有 diff 内容」⇒ 对 "null" 算 sha256 得到
    //   74234e98…（sha256("null")）这个**稳定但无意义**的哈希 ⇒ 记录落在一个假名字下，
    //   且永远找不到（因为它不对应任何真实 diff）。
    //   症状：非 git 目录里 saveRecord 也「成功」写出 64 位记录。
    //   修法：先判 null/undefined，再判空串。
    let d;
    try {
      d = git([
        "diff", "--cached", "--no-textconv", "--no-ext-diff", "--no-renames",
        ...(diffPaths || ["--", ".", ":(exclude).ccg"]),
      ]);
    } catch (e) {
      return { hash: undefined, empty: false, error: String(e && e.message ? e.message : e) };
    }
    if (d === null || d === undefined) {
      return { hash: undefined, empty: false, error: "git diff --cached 返回 null（不在 git 仓库？）" };
    }
    if (!String(d).trim()) return { hash: undefined, empty: true };
    return { hash: require("crypto").createHash("sha256").update(String(d)).digest("hex"), empty: false };
  })();
  const stagedDiffHash = hashResult.hash;
  if (!stagedDiffHash) {
    // 空 diff（纯 .ccg 提交）与算失败是两件事：前者回落父 sha 是既定设计，
    // 后者是故障。必须分开报，否则「算失败」会被读成「本来就没有」。
    // 注意：decider 是纯 node CLI，没有 shell 的 say()；告警走 stderr（console.error），
    // 且**不得**污染 stdout —— 某些调用方会解析 stdout。
    if (hashResult.empty) {
      console.error("[ccg] 判定记录：暂存 diff（排除 .ccg）为空 ⇒ 回落父 sha 命名（纯 .ccg/ 提交）");
    } else {
      console.error("[ccg] ⚠ 无法计算 stagedDiffHash（" + (hashResult.error || "未知原因") + "）");
      console.error("[ccg] ⇒ **不写判定记录**（写父 sha 名会撞名，比不写更糟）；本次跳过记录落盘。");
      console.error("[ccg] 请检查 git diff 是否可用（git 是否在 PATH、仓库是否可读）。");
      // ★ 第四轮 i6：error 分支不落盘 —— 首版仍写父 sha 名的记录，而那正是本轮要消灭的
      //   跨分支撞名源，且没有任何去重处置。不写只会让门禁报「缺记录」（可见、可定位），
      //   写则产生一个会与他人冲突的文件（不可见、难定位）。两者取其可见者。
      return null;
    }
  }
  const file = path.join(dir, recordFileName(stagedDiffHash, sha));
  const record = {
    sha,
    layer: layer || "diff", // plan = 决策层(动手前) | diff = 验证层(动手后)
    mode: result.mode,
    reason: result.reason,
    stats: result.stats,
    stagedDiffHash,
    // 决策层记录方案点名的待改文件，供事后范围漂移比对
    plannedFiles: (layer === "plan" && plannedFiles) || undefined,
    decidedAt: new Date().toISOString(),
    decidedBy: "ccg-review-decider",
    // 本次判定**请求**的后端对（含每一格的来源档位与是否被覆盖）。
    // 驱动跑完会回填 deepReview.performedBy = 实际执行者；check-pr-exec-record.js
    // 拿这两者对账 ⇒ 「请求了 codex、实际由 claude 评审」判**不闭合**（backendMismatch）。
    // 不把这个字段落进记录，「换后端」就只是终端上滚过的一行字，机器无从追责 ——
    // 这正是 2026-10-18 三种旋钮全部静默失效没被任何门禁发现的原因。
    reviewBackends: RB.resolveBackends(),
    backendAvailability: summarizeBackendAvailability(backends === undefined ? detectBackends() : backends),
    deepReview: buildDeepReviewInit(result.mode),
  };
  // ★ 2026-10-16（QM-6 i3，成立并已修）：内容寻址让「同一变更反复提交/amend」落到**同一个文件**，
  // 这正是收敛性的来源；但副作用是**后写会静默覆盖先写**。若先写那份的 deepReview 已经闭环
  // （例如 amend 前已跑完双模型审查），覆盖就会把闭环状态抹回 pending ⇒ 欠账门禁重新变红，
  // 且**已产出的审查结论丢失**。
  //
  // sha256 抗碰撞 ⇒ 「同名而内容不同」只可能来自回落路径或哈希碰撞，无需防；
  // 真正要防的就是这一种：同名 + 已闭环。故写前检查，命中则拒写并保留原文件。
  if (fs.existsSync(file)) {
    let prev = null; let unreadablePrev = false;
    try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { prev = null; unreadablePrev = true; }
    if (unreadablePrev || shouldPreserveClosedRecord(prev)) {
      if (unreadablePrev) {
        console.log("   [CCG] ⚠ 同名判定记录已存在但**解析不动** ⇒ 不覆盖它，本次判定另存为 alt。");
        console.log("         覆盖等于销毁既有评审证据（status/findings 可能都在那份里），而「读不动」不等于「没有」。");
      }
      // 不覆盖已有实质内容的记录；把本次判定另存，避免两份都丢失。
      //
      // ★ 第四轮 i1/i6（Critical）：alt 名不得无限累积。
      //   同变更 amend 时 stagedDiffHash 相同 ⇒ 每次都会走到这里 ⇒ 每次都新时间戳 ⇒
      //   反复 amend 会产生一堆 `<64hex>-again-<sha>-<ts>.json`。
      //   修法：**同 sha 只保留一个 alt** —— 先把已存在的同前缀 alt 清掉再写新的。
      //   （`<64hex>-again-` 这个前缀在同一份变更下是确定的，故可按前缀清理。）
      const altPrefix = file.replace(/\.json$/, "-again-");
      // ★ 必须用 path.basename 取前缀，不能 split("/")：Windows 路径分隔符是 `\`，
      //   split("/") 在 Windows 上**不拆分** ⇒ pop() 返回整条路径 ⇒ startsWith(整条路径)
      //   恒 false ⇒ 去重完全失效（实测：两次 amend 留下两份 alt）。
      const altBase = path.basename(altPrefix);
      try {
        for (const n of fs.readdirSync(dir)) {
          if (n.startsWith(altBase) && n.endsWith(".json")) {
            fs.unlinkSync(path.join(dir, n));
          }
        }
      } catch (_) { /* 列目录失败不阻塞主流程 */
      }
      // ★ 第二轮 i5：alt 名必须**全局唯一** —— 首版用 sha.slice(0,8)，同前缀会互相覆盖；
      //   改为完整 sha + 时间戳（同一 sha 内毫秒级也唯一）。
      const alt = file.replace(
        /\.json$/,
        `-again-${sha}-${new Date().toISOString().replace(/[:.]/g, "")}.json`
      );
      fs.writeFileSync(alt, recordBody(record), "utf8");
      return alt;
    }
  }
  fs.writeFileSync(file, recordBody(record), "utf8");
  return file;
}

/**
 * QM-6 丙：来源意图必须是结构化字段。
 * 实测主干 827 份产物里 performedBy 有 34 种自由写法（12 条以 "self-play" 开头却声明做过外部复核），
 * 所以分级只能读 tier（闭集）+ evidence（出处），二者合取才算外部证据。
 */
function buildDeepReviewInit(mode) {
  return {
    required: mode !== "skip",
    status: "pending",
    tier: "unknown",
    performedBy: null,
    evidence: null,
    findings: null,
  };
}

/**
 * 后端可用性以**计数**分档，不是布尔「有没有」。
 * 沿用 deep-review.sh:373-375 的既有口径：只看 0/1 标志时，2/2 可用与 1/2 可用长成一个样，
 * 于是「双模型齐备」也会打印「只剩单后端」。降级资格的判据要能区分这两档。
 */
function summarizeBackendAvailability(backends) {
  const b = backends || {};
  const wrapperExists = b.wrapperExists === true;
  // 形状由 detectBackends() 持有：names = 本轮**真要用**的后端名单（单一真源 list），byName = 逐个 PATH 探测结果。
  // 这里原先读的是 b.claude / b.opencode —— 那两个键在 change qm6-review-backend-config 之后已不存在，
  // 于是现场「两个后端都可用」被报成 count=0，而单测因注入的是旧形状夹具，对这个漂移完全免疫
  // （同仓教训：契约夹具不得替对方把数算好）。现只认新形状，不留双读兼容层。
  const names = Array.isArray(b.names) ? b.names : [];
  const byName = b.byName && typeof b.byName === "object" ? b.byName : {};
  const onPath = names.filter((n) => byName[n] === true);
  const count = onPath.length;
  const total = names.length;
  return {
    count,
    total,
    partial: count > 0 && count < total,
    wrapperReady: wrapperExists,
    backends: { wrapperExists, names: names.slice(), onPath: onPath.slice() },
  };
}

function currentSha() {
  return (git(["rev-parse", "HEAD"]) || "").trim() || "unknown";
}

function detectBackends() {
  const wrapper =
    process.env.CODEAGENT_WRAPPER ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "bin", "codeagent-wrapper.exe");
  const exists = fs.existsSync(wrapper);
  // 探测名单来自单一真源，不再写死 claude/opencode —— 否则换了 critic 之后，
  // 判定器会去 PATH 里找两个没人打算用的名字，然后报「两个后端都不可用」。
  const resolved = RB.resolveBackends();
  const byName = {};
  for (const n of RB.backendNames(resolved)) byName[n] = hasOnPath(n);
  return {
    wrapper,
    wrapperExists: exists,
    resolved,
    names: RB.backendNames(resolved),
    byName,
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

/**
 * 「要求什么后端、后端到底装没装」这段提示的唯一实现。
 *
 * 从 main() 里抽出来只为一个理由：这段文案是**判定器对下游的承诺**（下一个会话会照着
 * 它决定要不要跑 QM-6、跑哪一路），而它原先埋在 main 的流程里，除真跑一次 pre-commit
 * 之外无法取证 —— 那就是「声明看得见、判据跑不了」的形态。抽成纯函数后
 * ccg-review-decider.test.js 可以按 env 直接驱动它并断言逐行文案。
 *
 * 三条不可破：
 *  ① 名单/文案一律由 RB（lib/ccg-review-backends.js）派生，本函数不得出现后端名字面量；
 *  ② 覆盖必须出声 —— 静默的旋钮等于没旋钮；
 *  ③ 「同族单后端」是显式配置，不得报成「少了一个后端」的降级。
 */
function backendNoticeLines(backends, mode) {
  const out = [];
  const available = backends.names.filter((b) => backends.byName[b]);
  const target = RB.formatTarget(mode, backends.resolved);
  // 需要几个**互不相同**的后端：dual 且 proposer≠critic 才是两个。
  const needDistinct =
    mode === "dual" && backends.resolved.proposer !== backends.resolved.critic;
  if (backends.resolved.overridden) {
    out.push(
      `ℹ 评审后端已被覆盖：proposer=${backends.resolved.proposer}(${backends.resolved.from.proposer}) ` +
        `critic=${backends.resolved.critic}(${backends.resolved.from.critic})`
    );
  }
  if (available.length === 0) {
    out.push(
      `⚠ 要求 ${target} 深度审查，但配置的后端 CLI 都不可用（已探测 ${backends.names.join(" / ")}）`
    );
    out.push("→ 降级为 SELF-REVIEW：必须由 agent 自行完成评审并记录结论");
  } else if (needDistinct && available.length < backends.names.length) {
    out.push(`⚠ 要求 ${target}，但仅 ${available.join("+")} 可用`);
    out.push("→ 降级为单后端 + 补一次 agent 自评");
  } else {
    out.push(`要求 ${target} 深度审查，后端就绪（${available.join(" + ")}）`);
  }
  // 注意：「决策层 / 验证层 该跑哪个脚本」那一行不在本函数里 —— 它取决于
  // staged.proposal（有没有 --input），不是后端可用性。把它抄进来会让函数
  // 对不在它参数里的东西做断言，plan 路径会被打出错误的「验证层」。
  return out;
}

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
  // 合并态探测只对「暂存区」这条路径有意义（--input / --base 都是显式给定的域）。
  // 提到外层是因为保存记录时要拿 staged.mergeScope / staged.files 组 pathspec，
  // 而且必须能区分「合并态的空交集」与「普通空暂存区」两种空。
  let mergeState = { merging: false, mergeHead: null, probeError: null };
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
      console.log("         这**不等于**「无需审查」。可用基准按序试：");
      console.log("           origin/main / main / <本次改动之前的那个提交>；");
      console.log("           或用 CCG_DECIDER_BASE=<rev> 指定后重跑。");
      return 0;
    }
    if (staged.files.length === 0) {
      // ★ 深度审查 i3 修正（2026-10-15）：原措辞只提示「若你期望有改动，说明 base 选错了」，
      //   而补救示例仍是 `--base origin/main` —— 在**最常触发本分支的场景**
      //   （改动已并入 base、HEAD 就在基准上）里，origin/main 恰恰是失效的那个基准，
      //   用户照着做还是空的，等于把系统提示写成「是你选错了」。
      //   现在把两个真实子情形与各自**可用**的基准写出来。
      const head = (git(["rev-parse", "--short", "HEAD"]) || "?").trim();
      const baseShort = (git(["rev-parse", "--short", base]) || "?").trim();
      console.log(`   [CCG] ⚠ 未判定：${base}...HEAD 为空（HEAD=${head}，base=${baseShort}）`);
      console.log("         这**不等于**「无需审查」。两种常见成因与各自的可执行补救：");
      console.log("           ① 改动**还没提交**（在暂存区）⇒ 去掉 --base，直接判暂存区");
      console.log(
        `           ② 改动**已并入 ${base}**（HEAD 就在基准上）⇒ 换更早的基准，例如` +
          ` \`--base ${base}~1\`，或用 \`git log\` 找到本次改动的父提交`
      );
      return 0;
    }
  } else {
    // ★ 遗留 10（2026-10-20）：合并态走**独立采集**，不复用暂存区口径。
    //   合并态下 `git diff --cached` = 「ours tip → 合并结果」= **对方那一侧**的改动集，
    //   于是「合并主干」这个零语义动作会按主干前进量判出 dual（现场：606 文件 / 1880 行）。
    //   口径与三条备选被否的理由见 collectMergeStaged() 的注释。
    mergeState = detectMergeState();
    // ★ QM-6 自扮演裁决 i1（2026-10-21）：探测失明必须出声。
    //   没有这一行时，「git 起不来」与「真的不在合并中」在终端上完全同形 ——
    //   用户看到的是「未判定 / dual」或「skip」，无从知道探测本身没跑起来。
    //   只告警不改变判定（fail-open 方向不变，理由见 detectMergeState 的注释）。
    if (mergeState.probeError) {
      console.log(
        `   [CCG] ⚠ 合并态探测失败（${mergeState.probeError}）⇒ 回落非合并口径（按暂存区判定）`
      );
      console.log(
        "         这**不等于**「当前不在合并中」：请确认 git 可执行、仓库可读；若你确实在合并，"
      );
      console.log("         本次判定可能把「对方整侧」当成本次改动（见遗留 10）。");
    }
    staged = mergeState.merging
      ? collectMergeStaged(mergeState)
      : collectStaged();
    if (!staged) {
      console.log(
        mergeState.merging
          ? "   [CCG] ⚠ 未判定：在合并中（MERGE_HEAD 存在），但读不到 merge-base / 任一侧文件集（不影响提交）"
          : "   [CCG] ⚠ 未判定：读不到 git 暂存区（不影响提交）"
      );
      console.log("         这**不等于**「无需审查」。补跑请带 --base <rev>。");
      return 0;
    }
    // ★ 合并态的 `files` 是**交集**，为空是常态（两侧各改各的）⇒ 不能套用下面那条
    //   「暂存区无变更 ⇒ 未判定」。把零语义合并报成「没判」会让每个合并提交都要求人
    //   手工补一次判定，而正确答案是 skip（judge 会在 mergeScope 分支给出）。
    if (!mergeState.merging && staged.files.length === 0) {
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
  if (result.stats.ccgSensitiveContentHits > 0) {
    console.log(
      `          ⚠ 自身产物命中敏感词 ${result.stats.ccgSensitiveContentHits} 处（**不计入模式判定**，判定器不消费自己写下的散文）：` +
        (result.stats.ccgSensitiveContentSample || []).map((x) => `「${String(x).slice(0, 40)}」`).join(" ")
    );
  }
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
    for (const line of backendNoticeLines(backends, result.mode)) {
      console.log(`          ${line}`);
    }
    console.log(
      staged.proposal
        ? "          → 决策层：动手之前跑 sh scripts/plan-review.sh，收敛后才可开始写码"
        : "          → 验证层：动手之后跑 sh scripts/deep-review.sh"
    );
  }

  if (!printOnly) {
    // ★ 遗留 10 的第二半：零语义合并**不落盘**。三条理由（都不是审美）：
    //   ① 合并提交不引入新内容 ⇒ 没有「新的审查结论」可记，落盘只会产生一份
    //      与某次已经审过的 PR 内容无关的记录；
    //   ② `skip` 记录没有任何门禁消费者 —— `check-pr-exec-record.js::evaluateDeepReviewDebt`
    //      只认 `mode=dual`，`single` 还会 `continue`，所以 skip 记录既不闭合也不阻断，
    //      纯占位；同一份 `skip` 落盘反而会成为「本次变更已被判定过」的假证据；
    //   ③ pre-commit 的 `.git/hooks/pre-commit` 在 decider 之后**无条件**
    //      `git add .ccg/reviews/*.json` ⇒ 每次 `git merge` 都在 commit 里多带一个文件，
    //      而合并提交本应是「零新增文件」的形态（事后看 diff 会把大量 .ccg 噪声当成改动）。
    if (result.mode === "skip" && staged.mergeScope) {
      console.log(
        "          判定**不落盘**：零语义合并（交集为空）不产生审查结论，skip 记录也没有门禁消费者；" +
          "落盘会让每次 merge 都在提交里多带一个 .ccg 文件"
      );
      return 0;
    }
    // 合并态必须把「本次判定实际依据的文件集」作为 pathspec 传下去 —— 否则
    // stagedDiffHash 算的是全域 diff（含对方整侧），与判定域不同源 ⇒ 记录名对不上。
    // 非合并态不传 ⇒ 落回 saveRecord 里的历史配方，行为逐字节不变。
    const mergeDiffPaths = staged.mergeScope
      ? [
          "--",
          ...staged.files.map((f) => `:(literal)${f.file}`),
          ":(exclude).ccg",
        ]
      : undefined;
    const f = saveRecord(
      result,
      sha,
      staged.proposal ? "plan" : "diff",
      staged.plannedFiles,
      backends,
      mergeDiffPaths ? { diffPaths: mergeDiffPaths } : undefined
    );
    if (!f) {
      // saveRecord 在「哈希算不出来」时返回 null（它自己已经打过 warn）。这里不得
      // 打印「判定已落盘: null」—— 那会把「没写」读成「写到了名为 null 的文件」。
      console.log("          判定**未落盘**（见上方告警）");
      return 0;
    }
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
  isSelfArtifact,
  buildDeepReviewInit,
  detectBackends,
  summarizeBackendAvailability,
  judge,
  collectStaged,
  // 遗留 10 的两个新成员。导出理由与 collectStaged 相同：merge 态的采集与探测
  // 是**可独立驱动**的纯 IO 函数，行为锁（遗留10-T1~T4/T7）直接调它们；
  // 不导出就只能靠「真造一次 git merge 再跑 CLI」取证，而那测的是 CLI 文本。
  detectMergeState,
  collectMergeStaged,
  collectFromDiff,
  collectRange,
  collectProposal,
  isDocsOnly,
  recordFileName,
  CLOSED_DEEP_REVIEW_STATUSES,
  PRESERVE_BY_STATUS,
  shouldPreserveClosedRecord,
  // 导出 saveRecord 仅为**行为锁**服务（真调它对「同变更反复 amend 不累积 alt」取证）；
  // 它依赖 process.cwd() 与真实 git，故只在测试里用，不在生产路径上被别处调用。
  saveRecord,
  // 导出这两个是为了**行为锁**：backendNoticeLines 是判定器对下游的承诺文案，
  // detectBackends 是「配置名单 → PATH 探测」的接缝。二者原先只活在 main() 里，
  // 除真跑一次 pre-commit 外无法取证。
  backendNoticeLines,
  detectBackends,
};

