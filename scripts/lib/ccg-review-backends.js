"use strict";
/**
 * QM-6 评审后端对的**单一真源**（change: qm6-review-backend-config）。
 *
 * 为什么要有这个文件：2026-10-18 之前「用哪两个后端跑深度审查」在仓里被抄成六份字面量
 * —— ccg-review-decider.js 的可用性表与文案各一份、deep-review.sh 的体检循环与裸名自检
 * 各一份、plan-review.sh 又一份。于是把 critic 换成别的后端时，判定器会说「两个后端都不
 * 可用」而入口仍按老名单体检，两边互不认账。
 *
 * 真源落点是 `scripts/ccg-review-backends.list`（第一行 critic，第二行 proposer），
 * **不是**一个 JS 常量，理由是 `deep-review.sh --check-deps` 这条诊断入口刻意不依赖 node
 * （真出事时 node 本身可能就是坏的）。于是有 sh 与 node 两个读取方 —— 这是「两份实现」，
 * 本仓对这类东西的纪律是：必须有一把**逐字对账**的锁（见 deep-review-deps.test.js 的
 * 「两个读取方必须给出同一份名单」），否则漂移只是换了位置。
 *
 * 它**不是**上游驱动那份配置的复制品：驱动的 cfgForMode() 仍自己决定 proposer/critic
 * （跨家族校验 FAMILY_MAP 也在那边，本模块刻意不抄第二份）。本模块只持有「**本仓希望**
 * 用谁评审」这一策略，按 CLI > env > 清单文件 三档解析，再由入口把结果转给驱动。
 *
 * ⚠ 已知不可闭合处（如实写在这里，别读成「设了就生效」）：驱动**验证层**（评审 diff）
 *   那条路径 `cfg = cfgForMode(mode)` 之后并不应用覆盖参数，覆盖块只存在于决策层
 *   （--proposal / objectType:"plan"）分支。所以对 diff 评审，本模块的解析结果会写进
 *   判定记录（reviewBackends），由 check-pr-exec-record.js 拿它与驱动回填的
 *   deepReview.performedBy 对账 —— 请求 codex 而实际由 claude 评审时**判不闭合**
 *   （backendMismatch），而不是让「设了没生效」伪装成「评审已通过」。
 */

const fs = require("fs");
const path = require("path");

// 兜底值：仅在清单文件缺失时使用，并且必须出声（见 loadSourceList）。
// 它必须与上游驱动 cfgForMode() 的现值对齐，否则「本仓默认」与「驱动默认」分叉，
// 而没人传覆盖时会静默用两套名字。这条由 ccg-review-backends.test.js 的存在性锁钉住。
const DEFAULTS = Object.freeze({ proposer: "opencode", critic: "claude" });

const SOURCE_FILE = path.join(__dirname, "..", "ccg-review-backends.list");

const ENV_PROPOSER = "MP_QM6_PROPOSER";
const ENV_CRITIC = "MP_QM6_CRITIC";

// 后端名要经 shell 传给 codeagent-wrapper（--backend <name>），所以形态判据是安全边界，
// 不是风格问题：只允许字母开头的 [A-Za-z0-9._-]，长度上限 32。
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;

// 装不上时的修法提示。只覆盖本仓实测用过的四个后端；未登记的名字如实回显
// 「对应 CLI」，不得编造一个包名让人去装不存在的东西。
const INSTALL_HINT = Object.freeze({
  claude: "@anthropic-ai/claude-code",
  opencode: "opencode-ai",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
});

function invalidName(which, value, from) {
  return new Error(
    `评审后端名不合法：${which}=${JSON.stringify(value)}（来源 ${from}）。` +
      ` 只允许字母开头的 [A-Za-z0-9._-]，长度 ≤ 32。`
  );
}

/**
 * 读清单文件。返回 { critic, proposer, notes }。
 *
 * 三条判据分开处理，因为它们各自的后果不同：
 *  ① 文件不存在 ⇒ 回落 DEFAULTS **且出声**（缺失说明仓库完整性出了问题，但 pre-commit
 *     不能因此炸；悄悄回落才会制造「以为改了其实没改」，所以必须写 stderr）。
 *  ② 文件存在但有效行数 ≠ 2 ⇒ 抛错。多一行/少一行都意味着下一个读取方会取到错的那一格，
 *     而这种错位在读表格里完全静默。
 *  ③ 某一行的名字形态不合法 ⇒ 抛错（同上，形态判据也是 shell 注入的边界）。
 */
function loadSourceList(opts) {
  const o = opts || {};
  const file = o.file === undefined ? SOURCE_FILE : o.file;
  const text = o.sourceText !== undefined ? o.sourceText : null;
  const notes = [];
  const parse = (raw) => {
    const lines = String(raw)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    if (lines.length !== 2) {
      throw new Error(
        `评审后端清单形态不合法：${file} 有效行数=${lines.length}（必须是 2 行：第一行 critic、第二行 proposer）。` +
          ` 实得：${JSON.stringify(lines)}`
      );
    }
    return lines;
  };
  let lines;
  if (text !== null) {
    lines = parse(text);
  } else if (file && fs.existsSync(file)) {
    lines = parse(fs.readFileSync(file, "utf8"));
  } else {
    notes.push(`清单缺失（${file || "(未提供)"}），已回落默认后端对 critic=${DEFAULTS.critic} proposer=${DEFAULTS.proposer}`);
    return { critic: DEFAULTS.critic, proposer: DEFAULTS.proposer, notes, fileUsed: null };
  }
  const [critic, proposer] = lines;
  for (const [which, v] of [["critic", critic], ["proposer", proposer]]) {
    if (!NAME_RE.test(v)) throw invalidName(which, v, "list");
  }
  return { critic, proposer, notes, fileUsed: file };
}

/**
 * 按 CLI > env > 清单文件 三档解析一对后端。
 *
 * 空串/纯空白一律**视为未提供**并继续向下一档回落 —— 不是报错：
 * `MP_QM6_CRITIC=""` 在 CI 表达式里是「没配」的常见写法，把它判成故障会让所有 PR 变红。
 * 但「非空且不合法」必须抛错（fail closed）：静默回落会重新制造
 * 「以为换了后端、其实没有」这个本次要消灭的形态。
 */
function resolveBackends(opts) {
  const o = opts || {};
  const env = o.env === undefined ? process.env : o.env;
  const cli = o.cli || {};
  const src = o.sourceText !== undefined || o.file !== undefined
    ? loadSourceList(o)
    : loadSourceList();
  const pick = (name, envName, fromSource) => {
    const raw = cli[name];
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      const v = String(raw).trim();
      if (!NAME_RE.test(v)) throw invalidName(name, v, "cli");
      return { value: v, from: "cli" };
    }
    const e = env ? env[envName] : undefined;
    if (e !== undefined && e !== null && String(e).trim() !== "") {
      const v = String(e).trim();
      if (!NAME_RE.test(v)) throw invalidName(name, v, "env");
      return { value: v, from: "env" };
    }
    return { value: fromSource, from: src.fileUsed ? "list" : "default" };
  };
  const p = pick("proposer", ENV_PROPOSER, src.proposer);
  const c = pick("critic", ENV_CRITIC, src.critic);
  return {
    proposer: p.value,
    critic: c.value,
    from: { proposer: p.from, critic: c.from },
    notes: src.notes,
    // 与「清单里写的值」比对才算覆盖 —— env 显式写了与清单相同的值不构成覆盖，
    // 那种情况转发与否不改变结果，把它报成覆盖会让每个正常 PR 都多打一行噪声。
    overridden: p.value !== src.proposer || c.value !== src.critic,
  };
}

/**
 * 体检/裸名自检要遍历的后端名单：critic 在前、proposer 在后，去重。
 * 顺序沿用既有实现（claude 在前 opencode 在后），文案与既有记录对照表才不漂。
 */
function backendNames(resolved) {
  const r = resolved || resolveBackends();
  const out = [];
  for (const n of [r.critic, r.proposer]) if (!out.includes(n)) out.push(n);
  return out;
}

/**
 * 每个后端在本次评审里承担的角色。
 * 同一名字既是 proposer 又是 critic（同族单后端是**显式配置**）时必须如实说两职，
 * 不得让体检输出把「只有一个后端」打成「两个后端都就绪」。
 */
function roleOf(name, resolved) {
  const r = resolved || resolveBackends();
  const isP = r.proposer === name;
  const isC = r.critic === name;
  if (isP && isC) return "评审与出方案后端（同族单后端）";
  if (isC) return "评审后端（主力）";
  if (isP) return "出方案后端 / 跨家族校验";
  return "登记后端（未参与本次配对）";
}

function installHint(name) {
  return INSTALL_HINT[name] || "对应 CLI";
}

/**
 * 判定器用的目标文案。形态必须与既有记录/文档的对照表逐字一致：
 * `双模型(<critic> + <proposer>)`、`单模型(<critic>)` —— critic 在前是历史形态，
 * 改顺序会让 openspec/records/fix-ccg-decider-defects.md 那张表读起来像在说另一对后端。
 */
function formatTarget(mode, resolved) {
  const r = resolved || resolveBackends();
  return mode === "dual" ? `双模型(${r.critic} + ${r.proposer})` : `单模型(${r.critic})`;
}

// 角色/提示文案里绝不能出现清单分隔符，否则 sh 侧的 IFS='|' read 会错位。
const FIELD_SEP = "|";

module.exports = {
  DEFAULTS,
  SOURCE_FILE,
  ENV_PROPOSER,
  ENV_CRITIC,
  NAME_RE,
  FIELD_SEP,
  loadSourceList,
  resolveBackends,
  backendNames,
  roleOf,
  installHint,
  formatTarget,
};

// ---------- CLI（供需要 node 的路径消费；sh 侧另有纯 shell 读取方） ----------
// 用法：node scripts/lib/ccg-review-backends.js [覆盖] <打印模式>
//   覆盖：  --critic <name> / --proposer <name>
//   模式：  --print-names | --print-table | --print-json | --target <dual|single>
// 未知旗标、缺值、打印模式数不为 1 一律 rc=2 —— 本仓纪律：参数不得静默忽略，
// 否则「我传了 --critic」与「传进去了」两种情况在产物上完全同形。
if (require.main === module) {
  const a = process.argv.slice(2);
  const PRINT_FLAGS = ["--print-names", "--print-table", "--print-json", "--target"];
  const VALUE_FLAGS = ["--critic", "--proposer"];
  const cli = {};
  const modes = [];
  try {
    for (let i = 0; i < a.length; i++) {
      const t = a[i];
      if (VALUE_FLAGS.includes(t)) {
        const v = a[i + 1];
        if (v === undefined || String(v).startsWith("--")) {
          throw new Error(`旗标 ${t} 缺值（必须紧跟一个后端名，不能为空或下一个旗标）`);
        }
        cli[t.slice(2)] = v;
        i++;
      } else if (PRINT_FLAGS.includes(t)) {
        modes.push(t);
        if (t === "--target") {
          // --target 是「带值的打印模式」：值必须一起消费掉，否则下一轮会把 "dual"
          // 当未知旗标 —— 那是把正确调用判成错。
          const v = a[i + 1];
          if (v !== "dual" && v !== "single") {
            throw new Error(`--target 只认 dual / single，实得 ${JSON.stringify(v)}`);
          }
          i++;
        }
      } else {
        throw new Error(
          `未知旗标 ${JSON.stringify(t)}（只认 ${[...PRINT_FLAGS, ...VALUE_FLAGS].join(" / ")}）`
        );
      }
    }
    if (modes.length !== 1) {
      throw new Error(
        `必须且只能指定一个打印模式（${PRINT_FLAGS.join(" / ")}），实得 ${modes.length} 个：${modes.join(" ") || "(无)"}`
      );
    }
    const r = resolveBackends({ cli });
    for (const n of backendNames(r)) {
      if (roleOf(n, r).includes(FIELD_SEP) || installHint(n).includes(FIELD_SEP)) {
        throw new Error(`文案里出现了分隔符 ${FIELD_SEP}，会打乱 sh 侧的按行读取`);
      }
    }
    const head = modes[0];
    if (head === "--print-names") {
      process.stdout.write(backendNames(r).join(" ") + "\n");
    } else if (head === "--print-table") {
      for (const n of backendNames(r)) {
        process.stdout.write(`${n}${FIELD_SEP}${roleOf(n, r)}${FIELD_SEP}${installHint(n)}\n`);
      }
    } else if (head === "--target") {
      const m = a[a.indexOf("--target") + 1];
      process.stdout.write(formatTarget(m === "dual" ? "dual" : "single", r) + "\n");
    } else {
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    }
    for (const note of r.notes || []) {
      process.stderr.write(`⚠ ${note}\n`);
    }
  } catch (e) {
    process.stderr.write(`✗ ${e.message}\n`);
    process.exit(2);
  }
}
