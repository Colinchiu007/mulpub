"use strict";

/**
 * CCG 门禁「存量命中过滤」的**纯逻辑**（从 scripts/ccg-gate.js 抽出）。
 *
 * 为什么必须抽出来（2026-10-16，第十轮 CCG 外部评审遗留项）：
 *   `ccg-gate.js` 末尾是顶层语句 `process.exit(main())` ⇒ **不可被 require**
 *   （一 require 就执行主流程并退出，把测试进程杀掉）。于是这段决定
 *   「本次提交是否被安全门禁拦下」的策略**一直没有测试缝**：只能临时把函数源码
 *   抽出来 eval 验证，CI 永远跑不到它 —— 谁把这段改回脆弱写法，没有任何测试会红。
 *   抽成独立模块后，关键方向由 `ccg-gate-security-filter.test.js` 常驻锁住，并接进 CI。
 *
 * ★ fail-closed 三处，任一触发都**不过滤**（宁可按存量报，也不放行可能的真实缺陷）：
 *   ① diff 区间解析失败（`changedLineRanges` 返回 null）；
 *   ② 本次未改该文件（区间为空）；
 *   ③ 输出含**文件级命中**（提到本文件但无行号）⇒ 无法用区间判定。
 *
 * 只依赖 node 内置（`path` / `child_process`）—— 因为它的测试要跑在 CI 的 `changes` job 里，
 * 那个 job **不装依赖**（AGENTS.md：接进该 job 的锁只能 require node 内置模块）。
 *
 * 抽取纪律：`parseSecurityHitLines` 是**逐字搬运**（由 ccg-gate-security-filter.test.js
 * 的等价性断言锁住）；`changedLineRanges` 因把区间解析拆成了纯函数 `parseDiffHunkRanges`
 * 而**不是**逐字，其行为由区间解析用例覆盖。
 */

const path = require("path");
const { spawnSync } = require("child_process");

/** 从 `git diff -U0` 文本里解析新文件的改动行区间；空 diff 返回 `[]`。 */
function parseDiffHunkRanges(diffText) {
  const ranges = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(String(diffText || ""))) !== null) {
    const start = Number(m[1]);
    const len = m[2] === undefined ? 1 : Number(m[2]);
    // len === 0 是**纯删除** hunk（`@@ -12,3 +11,0 @@`）⇒ 新文件没有对应行，不产生区间
    if (len > 0) ranges.push([start, start + len - 1]);
  }
  return ranges;
}

/**
 * 取某文件在**暂存区**的改动行区间。
 * 解析失败/取不到 diff 时返回 `null` —— 调用方据此 fail-closed（宁可按存量报也不放行）。
 */
function changedLineRanges(file) {
  try {
    const r = spawnSync("git", ["diff", "--cached", "-U0", "--", file], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return null;
    // 空 diff（例如文件被还原成与 HEAD 一致）不算解析失败：本次没改 ⇒ 没有命中该算
    return parseDiffHunkRanges(r.stdout);
  } catch (_) {
    return null;
  }
}

function parseSecurityHitLines(output, file) {
  let fileLevel = 0;
  let mentioned = 0;
  const rel = String(file || '').replace(/\\/g, '/');
  const relBack = String(file || '').replace(/\//g, '\\');
  const base = path.basename(rel);
  // ★ CCG 第八轮 i5 的**过度收紧**（自查补正，本轮实测踩到）：
  //   我把「提到本文件但没给行号」一律当成**文件级命中** ⇒ fail-closed 不过滤。
  //   但扫描器的报告头里本来就有两行提到本文件而无行号：
  //     `扫描路径: D:\…\rpa-view-platforms.js`（无行号）与 `扫描文件: 1`
  //   ⇒ 每次扫这个文件都会判「有文件级命中」⇒ **存量过滤被完全关掉**，
  //   于是该文件里那条**存量** XSS（L1030，改动区间只有 [506,506]）被当成本次引入，
  //   把一次纯注释瘦身的提交拦下来。这是**我自己引入的门禁假阳**（fail-closed 方向，
  //   但代价是合法提交被误阻断，且掩盖了过滤功能本身）。
  //   修法：先剔除扫描器的**行政行**（路径/统计/结果/分隔线/小节标题）。
  //   注意方向仍是 fail-closed —— **只**剔除这些已知非命中形态，
  //   任何其它「提到本文件却无行号」的行照旧算文件级命中。
  const ADMIN_RE = /^(?:扫描路径|扫描文件|扫描结果|统计|问题列表)\s*[:：]/;
  // ★ 第十轮 i1（dismissed，但脆弱性属实 ⇒ 防御性加固）：
  //   第三种形态 `line.includes(basename)` **无法区分同名不同目录**（a/util.js 与 b/util.js 互认）。
  //   当前调用路径是**单文件扫描**（ccg-gate.js:423 传 r.output，报告头 `扫描文件: 1`），
  //   输出里不可能出现第二个文件 ⇒ 该失败场景不可达。但仍按最小改动消除脆弱性：
  //   ① 完整路径（正/反斜杠）命中优先；
  //   ② 只有**一条完整路径命中都没有**时，才退回 basename 兜底；
  //   ③ 兜底前要求「输出里以本 basename 结尾的**不同路径 token 恰好一个**」——
  //      出现多个即无法安全归因，退回空命中（fail-closed，由调用方的 mentioned 诊断兜住）。
  const fullHits = [];
  const baseHits = [];
  const basePaths = new Set();
  const PATH_TOKEN_RE = /([^\s"'(]+[\\/][^\s"'():]+)(?::(\d+))?/g;
  for (const raw of String(output).split(/\r?\n/)) {
    const line = raw.trim();
    if (ADMIN_RE.test(line) || /^[=\-]{5,}$/.test(line)) continue;
    const m = raw.match(/\.(?:js|ts|py|go|java|rs|c|cpp|php):(\d+)/i);
    const isFull = (rel && raw.includes(rel)) || (relBack && raw.includes(relBack));
    const isBase = !isFull && base && raw.includes(base);
    if (isBase) {
      let t;
      PATH_TOKEN_RE.lastIndex = 0;
      while ((t = PATH_TOKEN_RE.exec(raw)) !== null) {
        if (t[1].endsWith(base)) basePaths.add(t[1]);
      }
    }
    if (m) {
      // ★ CCG 第八轮 i5（upheld）：接受两种路径形态 —— 相对路径（正/反斜杠）与 basename 兜底。
      //   只匹配相对路径时，扫描器若输出 **Windows 绝对路径**（D:\…\file.js:12）
      //   会把命中静默丢掉 ⇒ hits=0 ⇒ 落入 fail-closed 保留 FAIL（方向保守），
      //   但会把「路径形态不匹配」伪装成「没有命中」。
      if (isFull) fullHits.push(Number(m[1]));
      else if (isBase) baseHits.push(Number(m[1]));
      continue;
    }
    // 提到本文件但没给行号 ⇒ 文件级命中，无法用区间判定，按 fail-closed 处理
    if (isFull || isBase) {
      fileLevel++;
      mentioned++;
    }
  }
  const baseFallbackSafe = basePaths.size === 1;
  const hits = fullHits.length ? fullHits : (baseFallbackSafe ? baseHits : []);
  // ★ 兜底被拒（输出里出现多个同 basename 的不同路径）时，把条数计入 mentioned，
  //   让调用方走「提到过本文件却没抽到命中 ⇒ 不过滤（fail-closed）+ 显式诊断」的分支。
  //   否则「无法安全归因」会被静默成「没有命中」—— 探针第 ④ 向正是靠这条断言把该静默抓出来。
  if (!fullHits.length && !baseFallbackSafe) mentioned += baseHits.length;
  return { hits, fileLevel, mentioned, basenameFallback: !fullHits.length && hits.length > 0 };
}

/**
 * 对**一个**安全门禁结果做存量过滤，返回调整后的结果（附加 `verdict` 便于断言与审计）。
 *
 * 逐条判定的理由（CCG 第八轮 i1，Critical，upheld）：
 *   原写法是「只要混入**任意一条**存量命中，就把整条输出（含区间内真实新增的命中）
 *   一起豁免」⇒ fail-open，比不比过滤更危险。现在：区间内命中仍然阻断，
 *   只在输出里注明「另有 N 条区间外命中已按存量豁免」。
 *
 * @param {{code:number, blocking:boolean, output:string, file:string}} result 扫描器原始结果
 * @param {Array<[number, number]>|null} ranges `changedLineRanges` 的返回值
 */
function applyPreExistingFilter(result, ranges) {
  const keep = (verdict, note) => ({
    ...result,
    verdict,
    output: note ? result.output + note : result.output,
  });
  if (result.code === 0) return keep("not-blocking");
  if (ranges === null) return keep("fail-closed-ranges-unparsed");
  if (ranges.length === 0) return keep("fail-closed-no-change");

  const parsed = parseSecurityHitLines(result.output, result.file);
  if (parsed.fileLevel > 0) {
    // 文件级命中：无法定位行号 ⇒ fail-closed 不过滤（不放行可能的真实缺陷）
    return keep("fail-closed-file-level",
      `\n[存量过滤·fail-closed] 输出含 ${parsed.fileLevel} 处**文件级命中**（提到本文件但无行号），`
      + "无法用 diff 区间判定 ⇒ 本次不过滤，按原结果阻断。");
  }
  const hits = parsed.hits;
  // ★ CCG 第八轮 i5（upheld）：扫描输出**提到过本文件**却一个行号都没抽出
  //   ⇒ 路径形态不匹配（如扫描器输出绝对路径而我们只认相对路径）/ 同 basename 路径无法安全归因。
  //   必须显式说出，否则会把「解析失败」误读成「没有命中」。
  if (hits.length === 0) {
    if (parsed.mentioned > 0) {
      return keep("fail-closed-unparsed-hits",
        `\n[存量过滤·诊断] 扫描输出提到本文件 ${parsed.mentioned} 次但未抽到任何行号`
        + " ⇒ 路径形态可能不匹配（相对/反斜杠/绝对路径）或同 basename 路径无法安全归因。"
        + "本次不过滤（fail-closed）。");
    }
    return keep("no-hits");
  }
  const inDiff = hits.filter((ln) => ranges.some(([a, b]) => ln >= a && ln <= b));
  const preExisting = hits.filter((ln) => !inDiff.includes(ln));
  if (preExisting.length === 0) return keep("all-in-diff"); // 全部在区间内 ⇒ 全部算本次引入
  // ★ CCG 第八轮 i1（Critical，upheld）：**必须逐条判定，不得整体放行**。
  //   只要混入任意一条存量命中就把整条输出一起豁免 ⇒ fail-open。
  if (inDiff.length > 0) {
    return keep("partial-exempt-kept-blocking",
      `\n[存量过滤·部分豁免] ${preExisting.length}/${hits.length} 处命中不在本次 diff 区间内`
      + `（已按存量豁免）；但仍有 ${inDiff.length} 处**区间内命中 ⇒ 保留阻断**。`
      + `\n           改动区间: ${ranges.map(([a, b]) => `${a}-${b}`).join(", ")}`
      + `\n           命中行号: ${hits.join(", ")}（区间内: ${inDiff.join(", ")}）`);
  }
  // 全部命中都在区间外 ⇒ 整体按存量豁免（保留原样降级）
  return {
    ...result,
    code: 0,
    blocking: false,
    verdict: "all-pre-existing-downgraded",
    output: result.output
      + `\n[存量过滤] ${preExisting.length}/${hits.length} 处命中不在本次 diff 改动区间内 ⇒ 判为存量，不阻断提交。`
      + `\n           改动区间: ${ranges.map(([a, b]) => `${a}-${b}`).join(", ")}`
      + `\n           命中行号: ${hits.join(", ")}（请人工复核是否确为存量）`
      + "\n           （fail-closed：区间解析失败 / 文件级命中 / 本次未改此文件时不过滤）",
  };
}

module.exports = {
  parseDiffHunkRanges,
  changedLineRanges,
  parseSecurityHitLines,
  applyPreExistingFilter,
};
