#!/usr/bin/env node
/**
 * 质量节拍 — CCG 质量门禁（独立可执行版）
 *
 * 用途：把 CCG 门禁接进已有的 pre-commit 钩子，而不替换那个钩子。
 * 本文件只负责 CCG 三道门禁，不含质量节拍自身的分支保护/测试存在性检查，
 * 那些由各项目原有的钩子负责。
 *
 * 门禁力度（与 quality-rhythm/installer/husky/pre-commit.js 保持一致）：
 *   verify-change   --mode staged   仅告警（判定依赖仓库文档结构，新库易误判）
 *   verify-security                   阻断（严重/高危即拒绝提交）
 *   verify-quality                    仅告警（风格类）
 *
 * 用法：
 *   node scripts/ccg-gate.js
 *
 * 环境变量：
 *   CCG_SKILLS_DIR   指定 CCG 技能目录（默认依次尝试：$CCG_SKILLS_DIR
 *                    → <仓库同级>/ccg → ~/.claude/skills/ccg）
 *   SKIP_CCG_GATE=1  临时跳过全部 CCG 门禁
 *
 * 设计约束：
 *   - CCG 未安装时告警跳过，绝不因缺 CCG 阻断提交
 *   - 门禁白名单硬编码，override-refusal（frontmatter 名 hi）永不入链：
 *     该 skill 会改写会话历史中的模型输出，属越狱持久化工具
 *   - CCG 扫描器只认 .py/.js/.ts/.go/.java/.rs/.c/.cpp/.php
 */

"use strict";

/** 门禁脚本版本。分发到各项目后用 check-gate-drift.js 比对规范源，防止副本漂移。 */
const CCG_GATE_VERSION = "1.1.0";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CONFIG = {
  enabled: true,

  // ⛔ 白名单：刻意不包含 override-refusal
  allowedGates: [
    "verify-change",
    "verify-quality",
    "verify-security",
    "verify-module",
    "gen-docs",
  ],

  gates: [
    {
      name: "verify-change",
      args: ["--mode", "staged"],
      blocking: false,
      note: "文档同步与模块完整性审计（依赖仓库结构，新库可能误报）",
    },
    {
      name: "verify-security",
      args: [],
      blocking: true,
      note: "安全漏洞扫描（严重/高危即阻断）",
    },
    {
      name: "verify-quality",
      args: [],
      blocking: false,
      note: "代码质量指标（风格类，告警为主）",
    },
  ],

  // CCG 扫描器认识的扩展名；其余类型不在扫描范围
  scannableExts: new Set([
    ".py", ".js", ".ts", ".go", ".java", ".rs", ".c", ".cpp", ".php",
  ]),

  // 只检查本次提交涉及的源码文件，且最多检查这么多个（控制耗时）。
  // ⚠️ 刻意不按目录扫描：按目录扫会把仓库既有的历史问题算到本次提交头上，
  //    在有技术债的存量仓库里会导致每次提交都被拦，门禁直接失效。
  maxFiles: 20,
  timeoutMs: 60000,
};

/** 定位 CCG 技能目录；找不到返回 null（调用方据此跳过） */
function resolveCcgDir() {
  const home = process.env.USERPROFILE || os.homedir() || "";
  const candidates = [
    process.env.CCG_SKILLS_DIR,
    path.resolve(__dirname, "..", "ccg"),
    path.join(home, ".claude", "skills", "ccg"),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "run_skill.js"))) return dir;
    } catch (_) {
      /* 忽略不可访问的候选路径 */
    }
  }
  return null;
}

/** 校验门禁存在且在白名单内 */
function gateAvailable(ccgDir, gateName) {
  if (!CONFIG.allowedGates.includes(gateName)) return false;
  try {
    const dir = path.join(ccgDir, "tools", gateName, "scripts");
    return fs.readdirSync(dir).some((f) => f.endsWith(".js"));
  } catch (_) {
    return false;
  }
}

function gitStagedFiles() {
  const res = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout.split("\n").filter(Boolean);
}

/**
 * 取本次提交涉及的源码文件（去重、上限 maxFiles）。
 * 只看"这次改了什么"，不看仓库里还欠着什么。
 */
function resolveTargetFiles(staged) {
  const files = [];
  for (const file of staged) {
    if (!CONFIG.scannableExts.has(path.extname(file).toLowerCase())) continue;
    if (!files.includes(file)) files.push(file);
    if (files.length >= CONFIG.maxFiles) break;
  }
  return files;
}

/**
 * 取某文件本次 diff 的**改动行区间**（按 hunk 头解析）。
 *
 * 为什么需要它：CCG 的 verify-security 只能整文件扫（它只接受 --path，不接受行区间），
 * 于是「本次只改了这个文件 3 行、文件里另有 1500 行存量代码」时，存量问题会被算到本次提交头上。
 * 本文件 CONFIG 注释里「刻意不按目录扫描，避免把历史问题算到本次提交、导致门禁失效」说的就是这件事，
 * 但那个粒度只到**文件**，没到**行** —— 实测（2026-10-16 p3-residual-criteria）：
 * 改了 rpa-view-platforms.js 的 12 行，却被该文件 L1040 一处**存量** innerHTML（2026-07-16
 * 的安全修复代码，且 diff 完全没触及）拦住提交。
 *
 * 解析失败/无 diff 时返回 null —— 调用方据此**不过滤**（fail-closed：宁可按存量报，也不放行）。
 */
function changedLineRanges(file) {
  try {
    const r = spawnSync("git", ["diff", "--cached", "-U0", "--", file], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return null;
    const ranges = [];
    const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
    let m;
    while ((m = re.exec(r.stdout)) !== null) {
      const start = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      if (len > 0) ranges.push([start, start + len - 1]);
    }
    // 空 diff（例如文件被还原成与 HEAD 一致）不算解析失败：本次没改 ⇒ 没有命中该算
    return ranges;
  } catch (_) {
    return null;
  }
}

/**
 * 从 CCG 安全扫描输出里抽出**属于指定文件**的「:行号」命中。
 *
 * ★ 必须按文件过滤（CCG 第五轮 i1，upheld）：
 *   只按行号抽会把**别的文件**的命中（如扫描器输出多文件/依赖图谱命中
 *   `other.py:37`）套到本文件的 diff 区间上判定 —— 区间外即降级为「存量」，
 *   **真实的新缺陷被放行**（fail-open）。
 *
 * ★ CCG 第六轮 i2（upheld）两级收紧：
 *   ① 不能只用 basename —— `a/util.js:12` 与 `b/util.js:12` 会互认（不同目录同名文件）。
 *      改为：该行必须包含**完整相对路径**（正斜杠或反斜杠形态）才算本文件命中。
 *   ② 文件级命中（**无行号**）不得被静默放过：返回 `fileLevel` 计数，
 *      调用方遇到它时按 **fail-closed 不过滤**处理（无法用区间判定的不放行）。
 *
 * 另外：只用「扩展名 + 冒号 + 行号」这个字面模式，不依赖 \b 与 $ 锚点
 * （实测写 /\s*$/ + /\.(js|…)\b/ 抽不到扫描器那行，行首还有 emoji 前缀）。
 *
 * @returns {{hits: number[], fileLevel: number}}
 */
function parseSecurityHitLines(output, file) {
  const hits = [];
  let fileLevel = 0;
  const rel = String(file || '').replace(/\\/g, '/');
  const relBack = String(file || '').replace(/\//g, '\\');
  const base = path.basename(rel);
  for (const line of String(output).split(/\r?\n/)) {
    const m = line.match(/\.(?:js|ts|py|go|java|rs|c|cpp|php):(\d+)/i);
    if (m) {
      // 完整相对路径匹配（两种分隔符形态），避免不同目录同名文件互认
      const isThisFile = (rel && line.includes(rel)) || (relBack && line.includes(relBack));
      if (!isThisFile) continue;
      hits.push(Number(m[1]));
      continue;
    }
    // 提到本文件但没给行号 ⇒ 文件级命中，无法用区间判定，按 fail-closed 处理
    if ((rel && line.includes(rel)) || (relBack && line.includes(relBack))) fileLevel++;
  }
  return { hits, fileLevel };
}

function runGate(ccgDir, gate, target) {
  const args = target ? [...gate.args, target] : [...gate.args];
  const res = spawnSync(
    process.execPath,
    [path.join(ccgDir, "run_skill.js"), gate.name, ...args],
    { encoding: "utf8", timeout: CONFIG.timeoutMs }
  );
  if (res.error) {
    return { name: gate.name, code: -1, output: `执行失败: ${res.error.message}`, blocking: gate.blocking };
  }
  const output = `${res.stdout || ""}${res.stderr || ""}`.trim();
  return {
    name: gate.name,
    file: target || null,
    code: res.status,
    output,
    blocking: res.status !== 0 && gate.blocking,
  };
}

/**
 * 决策层兜底检查
 *
 * 决策层跑在动手之前，那时没有 git diff，所以它不在 pre-commit 路径上。
 * 这里补两道兜底（均为告警，不阻断）：
 *   ① 本次改动需要评审，却找不到任何 layer=plan 的记录 → 提示可能漏跑决策层
 *   ② 找到决策层记录，但实际改动的文件超出方案声明范围 → 提示范围漂移
 */
function readDecisionRecords() {
  const dir = path.join(process.cwd(), ".ccg", "reviews");
  const plan = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (rec.layer === "plan") plan.push(rec);
      } catch (_) { /* 跳过损坏记录 */ }
    }
  } catch (_) { /* 目录不存在 */ }
  return plan;
}

function normPath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function stagedSourceFiles() {
  const r = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split("\n").filter(Boolean);
}

function checkDecisionLayer(mode) {
  const out = [];
  const planRecords = readDecisionRecords();

  if (planRecords.length === 0) {
    out.push(
      `本次改动判定为 ${mode.toUpperCase()}，按决策矩阵应先跑决策层评审，` +
        "但未找到任何 layer=plan 的 .ccg/reviews 记录。" +
        "补跑：sh scripts/plan-review.sh <方案文件>"
    );
    return out;
  }

  const rec = planRecords.sort((a, b) =>
    String(b.decidedAt || "").localeCompare(String(a.decidedAt || ""))
  )[0];

  const st = rec.deepReview && rec.deepReview.status;
  if (rec.mode !== "skip" && st === "pending") {
    out.push(
      "决策层方案评审尚未执行（deepReview.status=pending）——" +
        "动手前的跨家族对抗评审可能被绕过。补跑：sh scripts/plan-review.sh <方案文件>"
    );
  }

  if (Array.isArray(rec.plannedFiles) && rec.plannedFiles.length) {
    const planned = rec.plannedFiles.map(normPath);
    const base = (s) => s.split("/").pop();
    const actual = stagedSourceFiles();
    const uncovered = actual.filter((f) => {
      const n = normPath(f);
      if (planned.includes(n)) return false;
      return !planned.some(
        (p) => n.startsWith(p + "/") || p.startsWith(n + "/") || base(p) === base(n)
      );
    });
    if (uncovered.length) {
      out.push(
        `范围漂移：以下改动文件不在方案声明范围内（${uncovered.length} 个）\n` +
          uncovered.slice(0, 8).map((f) => `              - ${f}`).join("\n") +
          "\n              → 可能边做边扩范围，方案需相应更新后重跑决策层"
      );
    }
  }
  return out;
}

function main() {
  if (!CONFIG.enabled) {
    console.log("   [CCG] 门禁已在 ccg-gate.js 的 CONFIG.enabled 中关闭。");
    return 0;
  }
  if (process.env.SKIP_CCG_GATE === "1") {
    console.log("   [CCG] 门禁已被 SKIP_CCG_GATE=1 跳过。");
    return 0;
  }

  // ★ 2026-10-15 增（缺陷 C）：支持对**任意路径**跑门禁。
  //
  // 原实现只从暂存区取目标文件，于是「改动一旦提交就无法再跑」——
  // 事后补跑 `node scripts/ccg-gate.js verify-quality <file>` 会被静默忽略
  // （参数根本没被解析），只能得到「暂存区无变更，跳过」。
  //
  // 现在：位置参数里凡不像门禁名的，一律当作目标路径。
  // 这样 pre-commit（无参数）与事后补跑（带路径）走同一条代码路径。
  //
  // ★ 2026-10-15 修（QM-6 评审 i4）：初版把「任何非门禁名的位置参数」当目标路径 ⇒
  //   门禁名拼错（如 verify-qualit）会被静默当成一个**幽灵路径**继续跑，
  //   门禁对着不存在的文件自然全绿 —— 失败开放。两条 fail-closed 校验补上：
  //     ① 形如门禁名却不在 allowedGates 里 ⇒ 报错退出（不猜用户意图）
  //     ② 显式目标必须真实存在 ⇒ 否则报错退出（幽灵路径不许让门禁空转）
  const argv = process.argv.slice(2);
  const knownGates = new Set(CONFIG.allowedGates);
  const positional = argv.filter((a) => !a.startsWith("-"));
  const unknownGateLike = positional.filter(
    (a) => /^(verify|check|gen)-[a-z0-9-]+$/.test(a) && !knownGates.has(a)
  );
  if (unknownGateLike.length > 0) {
    console.error(`   [CCG] ✗ 未知门禁名：${unknownGateLike.join(", ")}`);
    console.error(`         可用门禁：${[...knownGates].join(", ")}`);
    return 2;
  }
  const explicitTargets = positional.filter((a) => !knownGates.has(a));
  const missingTargets = explicitTargets.filter((p) => !fs.existsSync(p));
  if (missingTargets.length > 0) {
    console.error(`   [CCG] ✗ 显式目标不存在：${missingTargets.join(", ")}`);
    console.error("         门禁只对真实文件有效；幽灵路径会让它空转通过。");
    return 2;
  }

  const ccgDir = resolveCcgDir();
  if (!ccgDir) {
    console.log(
      "   [CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁。" +
        "安装：npx ccg-workflow；或设置 CCG_SKILLS_DIR 后重试。"
    );
    return 0;
  }

  const staged = gitStagedFiles();
  const targetFiles = explicitTargets.length > 0 ? explicitTargets : resolveTargetFiles(staged);
  if (explicitTargets.length > 0) {
    console.log(`   [CCG] 使用显式目标路径 ${explicitTargets.length} 个（绕过暂存区）`);
  }

  const errors = [];
  const warnings = [];
  let passed = 0;

  for (const gate of CONFIG.gates) {
    if (!gateAvailable(ccgDir, gate.name)) {
      warnings.push(`CCG 门禁 ${gate.name} 不可用，已跳过。`);
      continue;
    }
    // verify-change --mode staged 自行读取暂存区，不需要路径
    const needsTarget = !gate.args.includes("--mode");
    if (needsTarget && targetFiles.length === 0) continue;

    const results = targetFiles.length
      ? targetFiles.map((f) => runGate(ccgDir, gate, f))
      : [runGate(ccgDir, gate, null)];

    // ★ 存量命中过滤（2026-10-16 p3-residual-criteria；CCG 第五/六轮 i1/i2 加固）：
    //   verify-security 只能整文件扫 ⇒ 文件里的存量问题会被算到本次提交头上、拦住提交。
    //   这里对 blocking 的安全门禁做二次判定：**命中行号必须落在本次 diff 的改动区间内**，
    //   区间外的一律降为告警并注明「存量，非本次引入」。
    //   fail-closed 三处，任一触发都**不过滤**（宁可按存量报，不放行）：
    //     ① 区间解析失败（changedLineRanges 返回 null）；
    //     ② 本次没改动这个文件（区间为空）⇒ 无从判定；
    //     ③ 输出里有**文件级命中**（提到本文件但无行号）⇒ 无法用区间判定（CCG 第六轮 i2）。
    const adjusted = results.map((r) => {
      if (r.code === 0 || gate.name !== "verify-security") return r;
      const ranges = changedLineRanges(r.file);
      if (ranges === null) return r;
      if (ranges.length === 0) {
        // 本次没有改动这个文件（例如显式传参扫了别的文件）⇒ 无从判定是否本次引入，不过滤
        return r;
      }
      const parsed = parseSecurityHitLines(r.output, r.file);
      if (parsed.fileLevel > 0) {
        // 文件级命中：无法定位行号 ⇒ fail-closed 不过滤（不放行可能的真实缺陷）
        return {
          ...r,
          output: r.output
            + `\n[存量过滤·fail-closed] 输出含 ${parsed.fileLevel} 处**文件级命中**（提到本文件但无行号），`
            + `无法用 diff 区间判定 ⇒ 本次不过滤，按原结果阻断。`,
        };
      }
      const hits = parsed.hits;
      if (hits.length === 0) return r;
      const inDiff = hits.filter((ln) => ranges.some(([a, b]) => ln >= a && ln <= b));
      if (inDiff.length === hits.length) return r;
      const preExisting = hits.length - inDiff.length;
      return {
        ...r,
        code: 0,
        blocking: false,
        output: r.output
          + `\n[存量过滤] ${preExisting}/${hits.length} 处命中不在本次 diff 改动区间内 ⇒ 判为存量，不阻断提交。`
          + `\n           改动区间: ${ranges.map(([a, b]) => `${a}-${b}`).join(", ")}`
          + `\n           命中行号: ${hits.join(", ")}（请人工复核是否确为存量）`
          + `\n           （fail-closed：区间解析失败 / 文件级命中 / 本次未改此文件时不过滤）`,
      };
    });
    const finalResults = adjusted.map((r) =>
      r.blocking ? r : { ...r, code: r.code === 0 ? 0 : r.code, output: r.output }
    );

    const failed = finalResults.filter((r) => r.code !== 0);
    if (failed.length === 0) {
      passed++;
      continue;
    }

    const detail = failed
      .map((r) => r.output.split("\n").slice(0, 12).join("\n"))
      .join("\n---\n");

    if (failed.some((r) => r.blocking)) {
      errors.push(`❌ CCG 门禁 ${gate.name} 未通过：\n${detail}`);
    } else {
      warnings.push(`⚠️ CCG 门禁 ${gate.name} 有告警（不阻断提交）：\n${detail}`);
    }
  }

  // ── 第 4 道门禁：外部模型审查模式判定（§5.6.1 分层）────────────────
  // 纯确定性计算，不调外部模型，所以放在提交时是毫秒级的。
  const decider = path.join(__dirname, "ccg-review-decider.js");
  let decidedMode = null;
  if (fs.existsSync(decider)) {
    if (process.env.SKIP_CCG_GATE === "1") {
      console.log("   [CCG] 审查模式判定已随 SKIP_CCG_GATE 跳过");
    } else {
      // ★ 2026-10-15 修（残余 2 / 补完缺陷 C 的另一半）：
      //   有显式目标 = 事后补跑 ⇒ 改动已进 commit、暂存区通常是空的。
      //   原来这里 `[decider]` 一个参数都不传 ⇒ decider 去读空暂存区 ⇒
      //   打印「暂存区无变更，跳过审查模式判定」⇒ **模式判定从未执行**，
      //   而输出读起来像「无需审查」。现在把区间基准传下去，让它判这批改动。
      const deciderArgs = [decider];
      // ★ 深度审查 i1 修正（2026-10-15）：判据从「有显式目标」改成「暂存区为空」。
      //
      //   「有显式目标」**不等于**「事后补跑」—— 带着暂存改动跑
      //   `node scripts/ccg-gate.js verify-quality <file>` 是**合法且常见**的用法
      //   （提交前只想查某个文件），此时改动就在 index 里、还没进 commit。
      //   原来只凭 explicitTargets 就改判 base...HEAD，会把刚暂存的改动**漏掉**
      //   （区间为空 ⇒ 误报「未判定」；有旧 commit ⇒ 判成无关的历史改动）——
      //   恰是本 PR 要消灭的「判据判错范围」。
      //
      //   正确判据：**暂存区非空 ⇒ 判暂存区（原行为）；暂存区为空 ⇒ 才是补跑，判区间。**
      if (explicitTargets.length > 0 && staged.length === 0) {
        // ★ 深度审查 i6：`CCG_DECIDER_BASE` 必须先校验再当候选。
        //   原来直接把它当 candidate ⇒ 设了坏值/不存在的 rev 时，gate 先打印
        //   「基准：坏值...HEAD」、decider 紧接着打印「未判定」，**输出自相矛盾**；
        //   而补救文案只提 --base，与「我改的是 env」的现实相悖。
        const isRev = (ref) =>
          !!ref &&
          spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
            encoding: "utf8",
          }).status === 0;
        let candidate = null;
        const envBase = process.env.CCG_DECIDER_BASE;
        if (envBase) {
          if (isRev(envBase)) {
            candidate = envBase;
          } else {
            warnings.push(
              `CCG_DECIDER_BASE 指定的基准「${envBase}」不是有效 rev ⇒ 已忽略 ⇒ **未做审查模式判定**`
            );
          }
        } else {
          candidate = ["origin/main", "main"].find(isRev) || null;
        }
        if (candidate) {
          deciderArgs.push("--base", candidate);
          console.log(
            `   [CCG] 审查模式判定基准：${candidate}...HEAD（暂存区为空 ⇒ 按事后补跑判区间）`
          );
        } else {
          warnings.push(
            "显式补跑模式下找不到可用的 base（origin/main / main 都不存在）⇒ **未做审查模式判定**；" +
              "请用 CCG_DECIDER_BASE=<rev> 指定基准后重跑"
          );
        }
      } else if (explicitTargets.length > 0) {
        console.log(
          `   [CCG] 显式目标 ${explicitTargets.length} 个，但暂存区有 ${staged.length} 个改动` +
            " ⇒ 模式判定仍判暂存区（不传 --base）"
        );
      }
      const r = spawnSync(process.execPath, deciderArgs, { encoding: "utf8" });
      const out = `${r.stdout || ""}`.trim();
      if (r.status === 0 && out) {
        out.split("\n").forEach((l) => console.log(l));
        passed++;
        const m = out.match(/判定 \[[^\]]*\]:\s*(SKIP|SINGLE|DUAL)/);
        if (m) decidedMode = m[1].toLowerCase();
      } else if (r.status !== 0) {
        warnings.push(`审查模式判定器异常退出（${r.status}），已跳过。`);
      }
    }
  } else {
    warnings.push("未找到 ccg-review-decider.js，审查模式判定已跳过。");
  }

  // ── 决策层兜底检查 ────────────────────────────────────────────
  // 决策层（plan-review.sh）跑在动手之前，那时还没有 git diff，
  // 所以它不在 pre-commit 路径上，只能靠这两道兜底补上：
  //   ① 本次改动需要评审却找不到决策层记录 → 提示
  //   ② 实际改动的文件超出方案声明范围     → 提示范围漂移
  if (decidedMode && decidedMode !== "skip") {
    const dl = checkDecisionLayer(decidedMode);
    dl.forEach((w) => warnings.push(`[决策层] ${w}`));
    if (dl.length) passed++; // 兜底检查已执行（无论是否发现问题）
  }

  // 告警统一在此打印（必须在决策层兜底检查之后，否则新告警会被漏掉）
  for (const w of warnings) console.log(`   ${w}`);

  if (errors.length) {
    console.error("\n🔴 CCG 质量门禁未通过：\n");
    errors.forEach((e) => console.error(e));
    console.error(
      "\n修复后重试；确认可放行时用 SKIP_CCG_GATE=1 git commit（不推荐）"
    );
    return 1;
  }

  if (passed) console.log(`   [CCG] 门禁已执行：${passed} 项通过`);
  return 0;
}

process.exit(main());
