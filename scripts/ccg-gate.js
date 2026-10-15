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

    const failed = results.filter((r) => r.code !== 0);
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
      if (explicitTargets.length > 0) {
        // base 三级回退：CCG_DECIDER_BASE 显式覆盖 → origin/main → main
        const candidate =
          process.env.CCG_DECIDER_BASE ||
          ["origin/main", "main"].find(
            (ref) =>
              spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
                encoding: "utf8",
              }).status === 0
          );
        if (candidate) {
          deciderArgs.push("--base", candidate);
          console.log(`   [CCG] 审查模式判定基准：${candidate}...HEAD（事后补跑，不读暂存区）`);
        } else {
          warnings.push(
            "显式补跑模式下找不到可用的 base（origin/main / main 都不存在）⇒ **未做审查模式判定**；" +
              "请用 CCG_DECIDER_BASE=<rev> 指定基准后重跑"
          );
        }
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
