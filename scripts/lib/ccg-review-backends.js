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

/**
 * 把「**评审时**请求的后端」回写进入口命中的那份判定记录。
 *
 * 为什么必须有这一步（2026-10-18 实操抓到，是 #3927 自身留下的假红）：
 * `reviewBackends` 由 pre-commit 时的判定器写入，记的是**提交那一刻**的请求值；
 * 而换后端这件事通常发生在**评审时**（`--critic` / `MP_QM6_CRITIC`）。
 * 于是记录里写着 critic=claude、驱动回填 performedBy=codex，
 * `judgeBackendMismatch` 判未闭合 —— 我自己的机制把它支持的那个用法判成违规。
 *
 * 三条口径：
 *  ① **不销毁旧值**：提交时的请求整份挪到 `commitRequest` 保留，审计链仍能看到
 *     "提交时请求的是谁 / 评审时改成了谁"；只覆盖顶层，会让一次换后端把先前的断言抹掉。
 *  ② **只在真的覆盖过时写**（调用方负责这个判断）：默认路径不碰任何记录文件，
 *     免得每个 PR 的产物都被无关写者改一遍时间戳。
 *  ③ 读不到/解析不了记录一律 `ok:false` 并给原因，**不静默新建**：
 *     新建一份记录等于伪造判定产物，比不写严重得多。
 *
 * 返回 { ok, reason, before, after }；调用方（入口）据此决定继续还是早退。
 */
function applyReviewRequestToRecord(recordPath, resolved, fsImpl) {
  const f = fsImpl || fs;
  if (!recordPath) return { ok: false, reason: "记录路径为空" };
  if (!resolved || typeof resolved.critic !== "string" || !resolved.critic) {
    return { ok: false, reason: "评审时请求值不完整（critic 缺失）" };
  }
  // proposer 与 critic 必须成对校验：本函数写的是「请求的是哪一对后端」，只校验一半会让
  // 半个真源落盘（undefined 被 JSON.stringify 静默丢键），而对账侧读的正是这一对。
  if (typeof resolved.proposer !== "string" || !resolved.proposer) {
    return { ok: false, reason: "评审时请求值不完整（proposer 缺失）——只写一半等于给对账留个假源" };
  }
  let raw;
  try {
    raw = f.readFileSync(recordPath, "utf8");
  } catch (e) {
    return { ok: false, reason: `读不到判定记录（${e && e.code ? e.code : e}）——不新建，避免伪造判定产物` };
  }
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `判定记录不是合法 JSON（${e && e.message ? e.message : e}）` };
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    return { ok: false, reason: "判定记录顶层不是对象，拒绝改写" };
  }
  const before = rec.reviewBackends;
  const next = {
    critic: resolved.critic,
    proposer: resolved.proposer,
    from: resolved.from || null,
    notes: resolved.notes || [],
    overridden: resolved.overridden === true,
  };
  // 提交时那份只在"确实不同"时留档，避免每次重跑都叠一层。
  // ⛔ 已留过档时必须**原样往下传**：第二次换不同后端时 `before` 已经是上一次的回写结果，
  //    直接 next.commitRequest = before 会把「上一次评审请求的是谁」写成「提交时请求的是谁」，
  //    于是 spec 那条「MUST NOT 被就地覆盖销毁」在最需要它的多轮换后端场景里失效。
  if (before && typeof before === "object" &&
      (before.critic !== next.critic || before.proposer !== next.proposer)) {
    next.commitRequest = before.commitRequest || before;
    next.rewrittenAt = before.rewrittenAt || new Date().toISOString();
  } else if (before && typeof before === "object") {
    if (before.commitRequest) next.commitRequest = before.commitRequest;
    if (before.rewrittenAt) next.rewrittenAt = before.rewrittenAt;
  }
  rec.reviewBackends = next;
  try {
    f.writeFileSync(recordPath, JSON.stringify(rec, null, 2), "utf8");
  } catch (e) {
    return { ok: false, reason: `写入判定记录失败（${e && e.code ? e.code : e}）` };
  }
  return { ok: true, reason: "", before, after: next };
}

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
  applyReviewRequestToRecord,
};

// ---------- CLI（供需要 node 的路径消费；sh 侧另有纯 shell 读取方） ----------
// 用法：node scripts/lib/ccg-review-backends.js [覆盖] <模式>
//   覆盖：  --critic <name> / --proposer <name>
//   打印：  --print-names | --print-table | --print-json | --target <dual|single>
//   动作：  --record-request <判定记录路径>
// 未知旗标、缺值、模式数不为 1 一律 rc=2 —— 本仓纪律：参数不得静默忽略，
// 否则「我传了 --critic」与「传进去了」两种情况在产物上完全同形。
if (require.main === module) {
  const a = process.argv.slice(2);
  const PRINT_FLAGS = ["--print-names", "--print-table", "--print-json", "--target"];
  // --record-request 是「带值的动作模式」：把**评审时**请求的后端回写进那份判定记录。
  // 它与打印模式互斥（同样受「模式数必须为 1」约束）：调用方要么读信息、要么改产物。
  const ACTION_FLAGS = ["--record-request"];
  const VALUE_FLAGS = ["--critic", "--proposer"];
  const MODE_FLAGS = PRINT_FLAGS.concat(ACTION_FLAGS);
  // 带值的模式旗标：值必须一起消费掉，否则下一轮会把值当未知旗标 —— 那是把正确调用判成错。
  // 值清单为 null 表示自由值（路径）：任意非空且不以 -- 开头。
  const MODE_VALUE_ALLOW = { "--target": ["dual", "single"], "--record-request": null };
  const cli = {};
  const modes = [];
  let recordPath = "";
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
      } else if (MODE_FLAGS.includes(t)) {
        modes.push(t);
        if (Object.prototype.hasOwnProperty.call(MODE_VALUE_ALLOW, t)) {
          const v = a[i + 1];
          const allow = MODE_VALUE_ALLOW[t];
          if (v === undefined || String(v).startsWith("--")) {
            throw new Error(`旗标 ${t} 缺值（必须紧跟一个值，不能为空或下一个旗标）`);
          }
          if (allow && !allow.includes(v)) {
            throw new Error(`${t} 只认 ${allow.join(" / ")}，实得 ${JSON.stringify(v)}`);
          }
          if (t === "--record-request") recordPath = v;
          i++;
        }
      } else {
        throw new Error(
          `未知旗标 ${JSON.stringify(t)}（只认 ${MODE_FLAGS.concat(VALUE_FLAGS).join(" / ")}）`
        );
      }
    }
    if (modes.length !== 1) {
      throw new Error(
        `必须且只能指定一个模式（${MODE_FLAGS.join(" / ")}），实得 ${modes.length} 个：${modes.join(" ") || "(无)"}`
      );
    }
    const r = resolveBackends({ cli });
    const head = modes[0];
    if (head === "--record-request") {
      // 不变式② 在这一层机械执行：**没覆盖就不写**。默认路径不得碰任何记录文件 ——
      // 否则每个 PR 的判定产物都会被无关写者改一遍（mtime、键顺序都会动），
      // 而「谁改过判定产物」正是这条链要审计的东西。
      if (r.overridden !== true) {
        throw new Error(
          `评审时请求的后端与清单一致（critic=${r.critic} proposer=${r.proposer}）⇒ 不回写。只有真覆盖过才改记录。`
        );
      }
      const res = applyReviewRequestToRecord(recordPath, r);
      if (!res.ok) throw new Error(res.reason);
      process.stdout.write(
        `✓ 已把评审时请求的后端写回 ${recordPath}：critic=${r.critic} proposer=${r.proposer}\n`
      );
    } else {
      for (const n of backendNames(r)) {
        if (roleOf(n, r).includes(FIELD_SEP) || installHint(n).includes(FIELD_SEP)) {
          throw new Error(`文案里出现了分隔符 ${FIELD_SEP}，会打乱 sh 侧的按行读取`);
        }
      }
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
    }
    for (const note of r.notes || []) {
      process.stderr.write(`⚠ ${note}\n`);
    }
  } catch (e) {
    process.stderr.write(`✗ ${e.message}\n`);
    process.exit(2);
  }
}
