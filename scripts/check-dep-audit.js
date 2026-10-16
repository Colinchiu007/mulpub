#!/usr/bin/env node
/**
 * check-dep-audit.js — 依赖漏洞审计基线棘轮（审计 P2·依赖锁定 / [v2] 未覆盖维度补跑）
 *
 * 为什么要有这个门禁：审计报告 v2 明确指出「本轮未运行 npm audit / osv-scanner /
 * pip-audit，已知 CVE 结论缺失」。缺结论本身就是风险 —— 所以这里把两个扫描器接成
 * 可复现的常驻控制：
 *   - npm 侧：`pnpm audit --prod --json`（必须显式走官方 registry，
 *     npmmirror 镜像没有 audit 端点，会报 ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS）
 *   - ops-center 侧：`npm audit --omit=dev --json`，cwd 落在 ops-center/frontend
 *     （该包不在 pnpm workspace 内、自带 package-lock.json ⇒ 与 pnpm 的 --prod 同语义取 --omit=dev）
 *   - python 侧：`pip-audit -r ops-center/backend/requirements.txt --format json`
 *
 * 判定（四条，全部按 advisory id 逐条比对，不做「数量阈值」这种可被抵消的口径）：
 *   1. NEW_ADVISORY        —— 出现基线之外的新公告 → 阻断（要么升级，要么登记并给结论）
 *   2. RESOLVED_STILL_BASELINED —— 基线里的公告已不再命中 → 阻断（清账，防基线腐化）
 *   3. BASELINE_META_INVALID —— 条目缺 decision / decision 非法 / reviewBy 已过期 → 阻断
 *      （挂账必须写清「为什么不马上修」和「什么时候回看」，不允许无限期挂账）
 *   4. DECISION_CONTRADICTS_PATCHED —— decision=upgrade-tracked 却给不出「能逃出漏洞区间」的
 *      targetVersion → 阻断。动因是 axios 那轮实测：12 条公告被登记成 `upgrade-tracked` 挂账，
 *      而修复版本 1.20.0 早在 2026-08-26 就发布了 —— 「挂账」与「可修」之间没有任何东西在对账。
 *
 * 扫描器本身跑不起来（离线 / 端点不可达）时**不判失败**，改为 SCANNER_UNAVAILABLE 告警：
 * 让 PR 因网络抖动变红会让门禁被人为关掉，反而更危险。周计划任务是本门禁的权威来源。
 *
 * 用法：
 *   node scripts/check-dep-audit.js               # 检查（CI）
 *   node scripts/check-dep-audit.js --update      # 扫描并把新公告并入基线
 *   node scripts/check-dep-audit.js --json        # JSON 输出
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'dep-audit-baseline.json');
const PIP_REQUIREMENTS = 'ops-center/backend/requirements.txt';
// ops-center/frontend 不在 pnpm workspace 里（pnpm-workspace.yaml 只列 apps/* 与 packages/*），
// 它自带 package-lock.json 由 npm 管理。上一轮 axios 收口时它是被点名的「遗留」：
// 既不在本门禁的扫描域内、也没有任何 workflow 装它，却以"看起来受门禁保护"的形态存在。
// 本域就是把那句话说成真判据。
const OPS_FRONTEND_REL = 'ops-center/frontend';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

// 域 → 解析器的显式映射（新增域必须在这里登记，否则该域按 DOMAIN_NOT_WIRED 当场判红）。
const PARSERS = {
  'npm': (json) => parseNpmAudit(json),
  'pip': (json) => parsePipAudit(json),
  'npm-opscenter': (json, source) => parseNpmAuditV2(json, source),
};
const VALID_DECISIONS = ['upgrade-tracked', 'accepted-risk', 'not-exploitable', 'no-fix-available'];
// 扫描域清单（顺序即输出顺序）。'npm-opscenter' 是独立 source 名，与 pnpm 的 'npm' 不共用基线键 ——
// 否则同一个 GHSA 在两个域各命中一次会互相冒充"已登记"，且 --update 时后写的会把先写的抹掉。
const DOMAINS = ['npm', 'npm-opscenter', 'pip'];

function shellRun (cmd, args, opts = {}) {
  try {
    const res = spawnSync(cmd, args, {
      cwd: opts.cwd || ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    if (res.error) return { ok: false, error: String(res.error.message || res.error) };
    const out = String(res.stdout || '');
    const start = out.indexOf('{');
    if (start < 0) {
      return { ok: false, error: '扫描器无 JSON 输出：' + String(res.stderr || '').slice(0, 300) };
    }
    try {
      return { ok: true, json: JSON.parse(out.slice(start)) };
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败: ' + e.message };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** 默认扫描器：真实调 pnpm / npm / pip-audit（用例注入假实现，避免依赖网络）。 */
function createDefaultRunners (registry) {
  return {
    npm: () => shellRun('pnpm', ['audit', '--prod', '--json', '--registry=' + registry]),
    // ops-center/frontend 不在 pnpm workspace 内（pnpm-workspace.yaml 只列 apps/* 与 packages/*），
    // 它自带 package-lock.json 由 npm 管理 ⇒ 上一轮 axios 的「遗留」原文：它既不在本门禁的两个扫描域里，
    // 也没有任何 workflow 装它，于是以「看起来受门禁保护」的形态存在。这里把它真的扫进来。
    // --omit=dev 与 pnpm 侧的 --prod 同语义（本机实测：--omit=dev ⇒ 0 条；全量 ⇒ 3 包 / 12 公告，
    // 全部落在 vitest→@vitest/mocker→undici 这条 dev 链上）。
    'npm-opscenter': () => shellRun(
      'npm', ['audit', '--omit=dev', '--json', '--registry=' + registry],
      { cwd: path.join(ROOT, OPS_FRONTEND_REL) },
    ),
    pip: () => shellRun('pip-audit', ['-r', PIP_REQUIREMENTS, '--format', 'json', '--progress-spinner', 'off']),
  };
}

/**
 * npm audit v2 JSON → 归一化条目（形状与 pnpm 的 `advisories` 完全不同，不能复用 parseNpmAudit）。
 * 顶层 `vulnerabilities` 按**包名**聚合，`via[]` 里每一项才是一条公告；GHSA id 只出现在 `via[].url`。
 * `patched` 从 range 的上界反推：`>=7.0.0 <7.29.1` ⇒ `>=7.29.1`；推不出（无 `<` 上界）留空，
 * 语义就是「没有修复版本」—— 与 parseNpmAudit 的 `<0.0.0` 归一化口径对齐。
 */
function parseNpmAuditV2 (report, source) {
  const vulns = (report && report.vulnerabilities) || {};
  const out = new Map();
  for (const [name, v] of Object.entries(vulns)) {
    const effects = [name].concat(v.effects || []);
    for (const via of v.via || []) {
      if (typeof via === 'string') continue; // 字符串项 = 指向另一个受影响包，不是公告
      const id = ghsaFromUrl(via.url) || ('npm-' + via.source);
      const patched = patchedFromRange(via.range);
      const roots = [...new Set(effects.map((e) => String(e).replace(/^node_modules\//, '').split('>').join('>')))].sort();
      const prev = out.get(id);
      out.set(id, {
        source,
        id,
        module: prev && prev.module !== name ? prev.module + ',' + name : name,
        severity: via.severity || v.severity || 'unknown',
        patched: prev && prev.patched && prev.patched !== patched
          ? [...new Set([prev.patched, patched].filter(Boolean))].join(', ') : patched,
        roots: prev ? [...new Set(prev.roots.concat(roots))].sort() : roots,
      });
    }
  }
  return [...out.values()];
}

/**
 * ">=7.0.0 <7.29.1" -> ">=7.29.1"；无上界 / 空串 -> ""（= 无修复版本）。
 * 多族规格（">=1.0.0 <1.2.3, >=2.0.0 <2.1.5"）必须把**每个** < 上界都收进来 ⇒ ">=1.2.3, >=2.1.5"。
 * 动因（QM-6 外部评审实测，2026-10-05）：旧实现 .exec 只取第一个上界，第二族被静默丢掉，
 * 于是 targetVersion 写 2.0.5 也能"逃过下界"却被判通过 —— 而那正是本判据要拦的闭不了账。
 * 与 parseNpmAuditV2 里同 GHSA 跨包合并时的 ', ' 拼接口径保持一致（同一形状，判据侧只需一种拆法）。
 */
function patchedFromRange (range) {
  const bounds = String(range || '').match(/<\s*(\d+\.\d+\.\d+)/g) || [];
  const uniq = [...new Set(bounds.map((s) => '>=' + /<\s*(\d+\.\d+\.\d+)/.exec(s)[1]))];
  return uniq.join(', ');
}

/** 从公告 URL 里取 GHSA id；取不到返回 null（调用方回退到 npm advisory 数字 id）。 */
function ghsaFromUrl (url) {
  const m = /GHSA-[a-z0-9-]+/i.exec(String(url || ''));
  return m ? m[0].toUpperCase() : null;
}

/** pnpm/npm audit JSON → 归一化条目。按 GHSA id 去重（同一公告可能命中多个 workspace）。 */
function parseNpmAudit (report) {
  const advisories = (report && report.advisories) || {};
  const out = new Map();
  for (const raw of Object.values(advisories)) {
    const id = raw.github_advisory_id || ('npm-' + raw.id);
    const findings = raw.findings || [];
    const roots = [...new Set(findings.flatMap((f) => (f.paths || []).map((p) => String(p).split('>')[0])))].sort();
    const prev = out.get(id);
    // pnpm 对「无修复版本」的公告写 `<0.0.0`；归一成空串，否则它会被下面的自洽判据当成"有修复版可升"。
    const patched = normalizePatched(raw.patched_versions);
    const entry = {
      source: 'npm',
      id,
      module: raw.module_name || 'unknown',
      severity: raw.severity || 'unknown',
      patched,
      roots: prev ? [...new Set(prev.roots.concat(roots))].sort() : roots,
    };
    out.set(id, entry);
  }
  return [...out.values()];
}

/** `<0.0.0` / 空 / null 一律归一为空串 —— 空串在门禁里是「没有修复版本」的**唯一**表示法。 */
function normalizePatched (p) {
  const s = String(p || '').trim();
  if (!s || s === '<0.0.0') return '';
  return s;
}

/** pip-audit JSON → 归一化条目（pip-audit 不给严重度，统一 unknown，由人工在基线里补注）。 */
function parsePipAudit (report) {
  const deps = (report && report.dependencies) || [];
  const out = new Map();
  for (const dep of deps) {
    for (const vuln of dep.vulns || []) {
      const id = vuln.id || vuln.name;
      const fixes = (vuln.fix_versions || []).join(', ');
      if (out.has(id)) {
        const prev = out.get(id);
        if (!prev.module.includes(dep.name)) prev.module += ',' + dep.name;
        // 同一公告在不同包里的修复版本要合并展示，否则「无修复」会盖掉「可升级到 x.y」
        if (fixes && !prev.patched.includes(fixes)) {
          prev.patched = prev.patched ? prev.patched + ', ' + fixes : fixes;
        }
        continue;
      }
      out.set(id, {
        source: 'pip',
        id,
        // aliases 必须一起收：公告换号后旧号只在这里出现，丢了它就等于丢了这条公告的历史身份
        // （见 idsOf 的注释）。pip-audit 在缺字段时不给 aliases，故显式回落成 []。
        aliases: [...new Set((vuln.aliases || []).map(String))].filter((a) => a && a !== id).sort(),
        module: dep.name || 'unknown',
        severity: 'unknown',
        patched: fixes,
        roots: ['ops-center/backend'],
      });
    }
  }
  return [...out.values()];
}

function readBaseline (p) {
  const file = p || BASELINE_PATH;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sortEntries (entries) {
  return entries.slice().sort((a, b) => (a.source + a.id).localeCompare(b.source + b.id));
}

/**
 * 一条公告的**全部身份**：主 id + 别名（去重 + 排序，保证判定确定性）。
 *
 * 为什么需要：公告库会改用自己的新号，并把旧号降级成 aliases 成员。实测 2026-10-16，
 * pip-audit 对 python-jose 3.5.0 报 `id=PYSEC-2026-4298`、`aliases=["CVE-2026-85394",…]`，
 * 而基线当时以 `CVE-2026-85394` 为键 —— 只认主 id 会把**同一条公告、同一版本、
 * 同一「无修复版本」**判成「一条新增 + 一条失效」两条互相矛盾的结论，
 * 而安全结论一个字都没变。危害不止假红：最省事的"修法"是照新号再登记一条，
 * 于是同一条公告在基线里留两份，且旧条目收到 RESOLVED 提示后会被顺手删掉
 * 本来还对的那条；而每次换号都刷一次红，会训练人把这条门禁当噪声忽略。
 */
function idsOf (e) {
  const all = [e.id].concat(Array.isArray(e.aliases) ? e.aliases : []).filter(Boolean).map(String);
  return [...new Set(all)].sort();
}

/**
 * 在基线索引里找 `e` 对应的**所有**条目，返回基线键数组（空数组 = 未命中）。
 *
 * 判据：**同 source** 且身份集合有交集。跨 source 一律不算 —— 不同生态出现同名 id 是巧合，
 * 认了就是拿 pip 的条目去豁免 npm 的公告。
 *
 * 排序后返回：同一 found 条目可能同时命中多条基线（旧 bug「一增一失」造成的双份），
 * 裁决 i1 要求把这些条目**都**认领到 —— 丢任一份都可能丢掉那份上的人工结论。
 *
 * 裁决 i3（双向认同）：**基线条目已存的 aliases 也必须参与匹配**。只从 found 侧取身份是
 * 单向的 —— 公告库完全可能下一轮清理掉 aliases（本轮就观察到 PySEC 把 CVE 收进 aliases，
 * 反向操作同样合理），那时 found 只报旧主键，而基线键是新号 + aliases=[旧号]；
 * 不读基线侧 aliases 就会把旧号判成 NEW_ADVISORY、把新号判成 RESOLVED
 * —— 原事故原样复现。故匹配走两个方向：
 *   ① found 的每个身份 → 直接查基线键；
 *   ② found 的每个身份 → 查「哪条基线条目把该身份列在自己的 aliases 里」。
 */
function matchLedgerKeys (index, e) {
  const hit = new Set();
  const ids = idsOf(e);
  for (const id of ids) {
    const k = e.source + '/' + id;
    if (index.has(k)) hit.add(k);
  }
  // 方向②：基线条目已存的 aliases 反向认领（裁决 i3）。
  // 建一次 alias → 基线键 的反查索引（基线规模 = 挂账条数，量级很小）。
  for (const [k, item] of index) {
    if (!item || item.source !== e.source) continue;
    const itemAliases = Array.isArray(item.aliases) ? item.aliases.map(String) : [];
    if (itemAliases.some((a) => ids.includes(a))) hit.add(k);
  }
  return [...hit].sort();
}

/** 单条命中的便捷包装（保留原调用点语义）。 */
function matchLedgerKey (index, e) {
  const hit = matchLedgerKeys(index, e);
  return hit.length ? hit[0] : null;
}

/** 基线落盘：新增条目只带 TODO 决策（必须人工补结论，否则 META_INVALID 立刻拦下）。 */
function writeBaseline (found, old, p) {
  const file = p || BASELINE_PATH;
  const prevList = (old && old.advisories) || [];
  const prev = new Map(prevList.map((e) => [e.source + '/' + e.id, e]));
  // 裁决 i2：已被某条 found 认领/合并掉的基线键。writeBaseline 按 found 全量重写，
  // 若两条 found 争同一条旧基线（各自 aliases 都含旧号），不记这个集合就会把
  // **同一旧行复制成两份**（同结论、不同 id）—— 正是欠账条目所述
  // 「同一条公告在基线里留两份」的双份复发形态。故后认领的那条不再新建，
  // 而是把它的 aliases 并到先认领的那条上（note 留痕）。
  const consumedPrev = new Set();
  const rawAdvisories = sortEntries(found).map((e) => {
    const key = e.source + '/' + e.id;
    // 换号时也必须认领得到旧条目：否则 --update 会把人工写的 decision/note 冲成 TODO
    // —— 那等于"自愈"顺手把风险分析删了，比不改还糟（本仓 not-exploitable 那条 note
    // 是逐条复核过三处 algorithms 才写出来的）。
    //
    // 裁决 i1（QM-6 critic，已实测证实）：同一个 found 条目可能命中**多条**基线条目
    // —— 旧 bug「一增一失」留下的双份。此时必须**全部认领并合并**：
    // 只认领第一条会把另一条连同它的人工结论一起丢掉，而那条 note 往往正是
    // 「换号前那一轮」写的复核依据。合并策略取保守侧：decision 取排序后第一个
    // 非 TODO 的（有结论优先于没结论），note 去重后按序拼接，两份都留痕。
    // 直接命中也必须继续找别名命中：双份形态下新键那条往往是"换号后随手补的"，
    // 真正的人工结论可能写在旧键那份上。只看 direct 会把它丢掉。
    const matchedKeys = matchLedgerKeys(prev, e);
    const freshKeys = matchedKeys.filter((k) => !consumedPrev.has(k));
    // 裁决 i2：本条 found 争的旧基线已被**另一条 found** 先认领合并掉 ⇒ 本条不再新建行，
    // 只把它的 id 追加到先认领那条的 aliases 上（下一轮报哪个号都能认同）。
    // 放在下面 merged 之后处理，这里先标记跳过。
    if (!freshKeys.length && matchedKeys.length) {
      consumedPrev.add('__skip__:' + key);
      const owner = matchedKeys[0];
      const ownerEntry = prev.get(owner);
      if (ownerEntry) {
        const extra = idsOf(e).filter((x) => x !== e.id && x !== ownerEntry.id);
        const mergedAliases = [...new Set([...(Array.isArray(ownerEntry.aliases) ? ownerEntry.aliases : []), e.id].concat(extra))].sort();
        ownerEntry.aliases = mergedAliases;
        if (!/【多条 found 认领同一条公告，已合并】/.test(String(ownerEntry.note || ''))) {
          ownerEntry.note = String(ownerEntry.note || '') + ' || 【多条 found 认领同一条公告，已合并】' + matchedKeys.map((k) => k).join('/');
        }
      }
      return null;
    }
    const before = freshKeys.length ? prev.get(freshKeys[0]) : null;
    for (const k of freshKeys) consumedPrev.add(k);
    // 落盘 aliases：下一轮哪怕公告库又换回旧号，也能继续双向认同。
    // 裁决 i2：若本条 found 与另一条争同一条旧基线，把另一条的 id 也并进 aliases，
    // 让下一轮无论报哪个号都能认同（合并而非复制）。
    const aliases = idsOf(e).filter((x) => x !== e.id);
    if (before) {
      const merged = Object.assign({}, before, { id: e.id, severity: e.severity, patched: e.patched, roots: e.roots });
      // 把其余命中条目的人工结论并进来（双份形态才非空；单份时 matchedKeys 只有一项）。
      const extras = matchedKeys.slice(1).map((k) => prev.get(k)).filter(Boolean);
      if (extras.length) {
        const decided = [before].concat(extras).find((x) => x.decision && x.decision !== 'TODO');
        if (decided) merged.decision = decided.decision;
        const notes = [before].concat(extras).map((x) => String(x.note || '').trim()).filter(Boolean);
        const uniq = [...new Set(notes)];
        if (uniq.length) merged.note = uniq.join(' || 【同一公告的历史登记，已合并】');
      }
      if (aliases.length) merged.aliases = aliases;
      else delete merged.aliases; // 别名没了就别留陈的，否则会认领到不该认领的公告
      return merged;
    }
    const fresh = {
      source: e.source, id: e.id, module: e.module, severity: e.severity,
      patched: e.patched, roots: e.roots, decision: 'TODO', note: '待补结论（新公告）',
    };
    if (aliases.length) fresh.aliases = aliases;
    return fresh;
  });
  // 裁决 i2：被合并掉的 found（上面返回 null）不落盘，否则就是把同一旧行复制成多份。
  const advisories = sortEntries(rawAdvisories.filter(Boolean));
  const body = {
    '//': '依赖漏洞审计挂账清单（audit-batch-4）。升级/新增依赖后请跑：node scripts/check-dep-audit.js --update 并补齐 decision/note。',
    reviewBy: (old && old.reviewBy) || '',
    advisories,
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

/**
 * 核心判定（纯函数，用例注入假扫描结果）。
 * @returns {{violations: string[], scannedCount: number}}
 */
/**
 * 校验 upgrade-tracked 的目标版本真的逃出了 patched 区间。返回 null = 通过，返回字符串 = 违规描述。
 * 口径：**不引第三方 semver**（本仓依赖里没有任何测试可用的 semver 单例可依赖，装它属越界），
 * 只做「>=X 下界」的逐段数值比较 —— 本仓 patched 字段 100% 是这个形状（实测 24/24），
 * 遇到解析不了的形状一律 fail closed 报违规，而不是放行。
 */
function checkTargetEscapes (item) {
  const key = item.source + '/' + item.id;
  // 无修复版本 ⇒ 「升级中」这个说法本身不成立，先判这条，再谈目标版本。
  if (!String(item.patched || '').trim()) {
    return 'DECISION_CONTRADICTS_PATCHED: ' + key + ' 挂的是 upgrade-tracked，但 patched 为空 —— 没有修复版本就不存在「升级中」，应改判 no-fix-available 并在 note 给出取证';
  }
  const tv = String(item.targetVersion || '').trim();
  if (!tv) {
    return 'DECISION_CONTRADICTS_PATCHED: ' + key + ' decision=upgrade-tracked 却缺 targetVersion —— 挂账必须写明"升到哪个版本"，否则这笔账无法复核（修复版本 ' + item.patched + '）';
  }
  const t = /^(\d+)\.(\d+)\.(\d+)$/.exec(tv);
  if (!t) return 'DECISION_CONTRADICTS_PATCHED: ' + key + ' 的 targetVersion=' + JSON.stringify(tv) + ' 必须是 x.y.z 字面量（不许写区间/通配，那等于没承诺）';
  const got = [Number(t[1]), Number(t[2]), Number(t[3])];
  // patched 可能是**多段**（同 GHSA 跨包合并、或一条公告有 families）—— 必须逐段都逃过。
  // 取"逐段都过"而不是"任一段过"：两种语义我无法从数据里区分，保守侧只会假红不会假绿
  // （假红的出路是写一个更高的 targetVersion，那本来就更安全）。
  const segs = String(item.patched || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) {
    return 'DECISION_CONTRADICTS_PATCHED: ' + key + ' 的 patched 为空却挂着 upgrade-tracked';
  }
  for (const seg of segs) {
    const m = />=\s*(\d+)\.(\d+)\.(\d+)/.exec(seg);
    if (!m) {
      return 'DECISION_CONTRADICTS_PATCHED: ' + key + ' 的 patched 段=' + JSON.stringify(seg) + ' 解析不出可比较的下界（本判据只认 ">=x.y.z"，解析不了即拦）';
    }
    const want = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < 3; i++) {
      if (got[i] > want[i]) break;
      if (got[i] < want[i]) {
        return 'DECISION_CONTRADICTS_PATCHED: ' + key + ' 的目标版本 ' + tv + ' 低于修复下界 ' + seg + ' —— 升上去仍然命中该公告，这笔账永远闭不了（patched 全段=' + item.patched + '）';
      }
    }
  }
  return null; // 每一段都逃过 = 承诺的升级确实闭得上账
}

function evaluate (baseline, found, today, scannedSources) {
  const now = today || new Date().toISOString().slice(0, 10);
  // 只对本轮真的扫过的域判"已不再命中"，否则缺扫描器会被读成基线腐化（假红）。
  const scanned = scannedSources ? new Set(scannedSources) : null;
  const violations = [];
  const migrations = [];
  const list = (baseline && baseline.advisories) || [];
  const ledger = new Map(list.map((e) => [e.source + '/' + e.id, e]));
  const hits = new Map(found.map((e) => [e.source + '/' + e.id, e]));
  // 被「主键或别名」任一路径认领过的基线键：这些不是"已不再命中"，不得进 RESOLVED 分支。
  const claimed = new Set();
  // 已经报过迁移的基线键：同一基线条目只报一次，避免同一件事刷两行。
  const migratedFrom = new Set();
  // 裁决 i2：基线键 → 认领它的 found 主键列表。多条争抢同一条基线时必须出声，
  // 否则第二个（及以后）的 found 会**无任何输出地通过**，而 --update 还会把同一旧行
  // 复制成多份 —— 正是欠账条目所述「同一条公告在基线里留两份」的双份复发形态。
  const claimers = new Map();

  for (const e of sortEntries(found)) {
    const key = e.source + '/' + e.id;
    // 裁决 i1：同一 found 条目可能命中多条基线（旧 bug 的双份）。**全部**认领，
    // 否则没被认领的那条会在下面的 RESOLVED 循环里被报成「已不再命中」，
    // 诱导人把它删掉 —— 而它上面可能正是换号前那一轮写的人工结论。
    // 注意 direct 时也要继续找别名命中：新键那条常是"换号后随手补的"，
    // 人工结论写在旧键那份上，直接短路就会把它判成失效。
    const matchedKeys = matchLedgerKeys(ledger, e);
    const matchedKey = matchedKeys.length ? matchedKeys[0] : null;
    const item = matchedKey ? ledger.get(matchedKey) : null;
    if (!item) {
      violations.push('NEW_ADVISORY: ' + key + ' (' + e.module + ' ' + e.severity + ', 修复版本 ' + (e.patched || '无') + ', 路径 ' + (e.roots || []).join('|') + ') —— 升级依赖，或在基线登记 decision + note');
      continue;
    }
    for (const k of matchedKeys) {
      claimed.add(k);
      if (!claimers.has(k)) claimers.set(k, []);
      claimers.get(k).push(e.id);
    }
    // 命中了但不是同一个主键 ⇒ 同一条公告换号。报成迁移（可见、不阻断），
    // 而不是 NEW + RESOLVED 双报 —— 后者会诱使人"再登记一条"，把同一条公告写两份。
    //
    // 两个都不能少的前提（否则会报出伪迁移）：
    //   ① `!hits.has(matchedKey)` —— 若本轮 found 里**本来就有一条**同键条目，那就不是迁移。
    //      公告库有时会把同一条公告的多个号分别列出来，此时按 found 的排序谁先谁后会决定
    //      "迁移方向"，先看有没有直接命中才不会报出「新号 → 旧号」这种反向伪迁移。
    //   ② `migratedFrom` 去重 —— 同一条基线被两个别名同时命中时只报一次。
    // 裁决 i1 补充：双份都在账上时**不报迁移** —— 两个号都是活的，没有"迁"这回事。
    if (matchedKey !== key && !hits.has(matchedKey) && !migratedFrom.has(matchedKey) && matchedKeys.length === 1) {
      migratedFrom.add(matchedKey);
      // 裁决 i1：迁移必须带**认领证据**。缺了它，审计时无法区分
      // 「同一条公告换号」与「alias 数据误标导致两条无关公告撞车」——
      // 后者会让一条从未登记的真公告连 NEW_ADVISORY 都不报（假阴性比假阳性严重得多）。
      const viaAlias = matchedKey !== key;
      const matchedVia = matchedKey.slice(e.source.length + 1);
      migrations.push({ source: e.source, from: item.id, to: e.id, matchedVia, viaAlias });
    }
    // 结论判定一律挂在**基线条目自己的键**上：那才是人要改的那一行。
    const baseKey = item.source + '/' + item.id;
    if (!item.decision || !VALID_DECISIONS.includes(item.decision)) {
      violations.push('BASELINE_META_INVALID: ' + baseKey + ' 的 decision=' + JSON.stringify(item.decision) + ' 非法（允许 ' + VALID_DECISIONS.join('/') + '）');
    }
    if (!item.note || !String(item.note).trim()) {
      violations.push('BASELINE_META_INVALID: ' + baseKey + ' 缺 note（挂账必须写清为什么不马上修）');
    }
    if (item.decision === 'upgrade-tracked') {
      // 「挂账待升级」是一个可复核的承诺：必须给出逃出漏洞区间的目标版本；
      // 没有修复版本就根本不该挂这个 decision。判据全部在 checkTargetEscapes 里，
      // 这里只调一次 —— 同一条违规的文案不得取决于调用点（用例直接测纯函数时必须拿到同一句话）。
      // 动因（实测）：axios 的 12 条公告曾被登记成 upgrade-tracked 挂账，而修复版 1.20.0 早已发布。
      const bad = checkTargetEscapes(item);
      if (bad) violations.push(bad);
    }
  }

  // 裁决 i2：认领碰撞。多个 found 条目争同一条基线键时，只报第一条迁移、
  // 其余**无任何输出地通过**；而 writeBaseline 会把同一旧行复制成多份
  // ⇒ 「一增一失」以双份形态复发。必须出声点名争抢双方（不阻断，符合登记边界）。
  //
  // 排除合法形态：公告库**本来就把同一条公告的多个号分别列出**（本轮 pip-audit 的
  // python-jose 就是主 id + aliases 两个号都在）。判据用「是否存在某条 found，
  // 其身份集合**覆盖**这些 id 的全部」—— 覆盖即说明它们本属同一条公告，不是争抢。
  // （早先用 `uniq.every(id => hits.has(...))` 是错的：两个新键各自都是 found 条目，
  //   恒为 true ⇒ 碰撞永远不报，那条锁直接失效。）
  for (const [baseKey, ids] of [...claimers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const uniq = [...new Set(ids)].sort();
    if (uniq.length < 2) continue;
    const coveredByOne = found.some((f) => uniq.every((id) => idsOf(f).includes(id)));
    if (!coveredByOne) {
      violations.push('MIGRATION_COLLISION: ' + baseKey + ' 被 ' + uniq.length + ' 条 found 同时认领（'
        + uniq.join(', ') + '）—— 请人工确认它们是同一条公告还是别名数据有误；'
        + '若是同一条，跑 --update 会把它们合并为一条并在 note 留痕');
    }
  }

  for (const item of list) {
    if (scanned && !scanned.has(item.source)) continue;
    const key = item.source + '/' + item.id;
    if (claimed.has(key)) continue;
    if (!hits.has(key)) {
      violations.push('RESOLVED_STILL_BASELINED: ' + key + ' 已不再命中（多半已升级），请 --update 清账');
    }
  }

  const reviewBy = baseline && baseline.reviewBy;
  if (!reviewBy || !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) {
    violations.push('BASELINE_META_INVALID: 顶层 reviewBy 必须是 YYYY-MM-DD（当前 ' + JSON.stringify(reviewBy) + '）');
  } else if (reviewBy < now) {
    violations.push('REVIEW_DEADLINE_PASSED: 挂账复核日 ' + reviewBy + ' 已过（今天 ' + now + '），请重新评审并顺延 reviewBy');
  }

  return { violations, migrations, scannedCount: found.length, ledgerCount: list.length };
}

/**
 * 门禁主体。runners / 基线路径 / 输出全部可注入，使「某一域扫描器缺失时另一域照常判违规」
 * 这条能被用例真跑覆盖 —— 原先 main() 直接读 process.argv 与真实 pnpm/pip-audit，
 * 短路行为没有测试可见的入口，于是"整体 return 0"的假绿在 9 条单测下躺了一整轮。
 * @returns {number} 退出码
 */
function runCheck (opts = {}) {
  const isUpdate = !!opts.isUpdate;
  const isJson = !!opts.isJson;
  const log = opts.log || ((...a) => console.log(...a));
  const error = opts.error || ((...a) => console.error(...a));
  const registry = opts.registry || process.env.NPM_AUDIT_REGISTRY || DEFAULT_REGISTRY;
  const runners = opts.runners || createDefaultRunners(registry);
  const parsers = opts.parsers || PARSERS;
  const bp = opts.baselinePath || BASELINE_PATH;

  const results = {};
  const unavailable = [];
  const notWired = [];   // 域在 DOMAINS 里但没有 runner：接线断了，与"扫描器跑不起来"是两类事
  const scannedSources = [];
  for (const source of DOMAINS) {
    const run = runners[source];
    if (typeof run !== 'function') {
      notWired.push(source + '(缺 runner)');
      // 域在 DOMAINS 里但没有 runner = 接线断了；不得当成"这个域扫过且干净"。
      results[source] = [];
      continue;
    }
    if (typeof parsers[source] !== 'function') {
      notWired.push(source + '(缺解析器)');
      // 有 runner 却没登记解析器时，旧写法会 else 兜底到 parseNpmAuditV2 ⇒ 拿错形状静默解析，
      // 覆盖面窄于声明却不吭声 —— 与 DOMAIN_NOT_WIRED 同罪，必须同样 fail closed。
      results[source] = [];
      continue;
    }
    const res = run();
    if (!res || !res.ok) {
      unavailable.push(source + '(' + ((res && res.error) || 'unknown').slice(0, 160) + ')');
      results[source] = [];
      continue;
    }
    scannedSources.push(source);
    results[source] = parsers[source](res.json, source);
    // 上面一行之所以敢直接索引，是因为循环开头已对 PARSERS[source] 做过函数校验（缺解析器 = 接线断了）。
  }
  const found = DOMAINS.flatMap((s) => results[s] || []);
  // 接线判据先于一切：漏接一个域 = 本轮判据覆盖面窄于声明，不得用"已扫域照常判"放过
  // （SCANNER_UNAVAILABLE 的宽容只针对离线/端点抖动；那是部署事实，这是代码事实）。
  if (notWired.length) {
    error('DOMAIN_NOT_WIRED: 这些域在 DOMAINS 里却没有 runner ⇒ ' + notWired.join(', ') + '；补 createDefaultRunners，或把域从清单里撤掉并写明理由');
    return 1;
  }
  // 全部声明域都没扫成 ⇒ 本轮没有任何判据，不得报通过（否则扫描器配置坏掉会演化成"全绿"）。
  if (!scannedSources.length) {
    error('扫描器全部不可用，本轮无判据 ⇒ 按失败处理：' + unavailable.join(' '));
    return 1;
  }

  // 写基线必须全部声明域齐全：writeBaseline 按 found 原样落盘，缺一个域就会把其余域的挂账静默抹掉。
  if (unavailable.length && isUpdate) {
    error('扫描器不可用，拒绝写基线：' + unavailable.join(' '));
    return 1;
  }
  // 检查路径不得整体短路：原先「任一扫描器不可用 ⇒ return 0」会让本机没有 pip-audit 时
  // npm 侧的新公告连读都没读就判通过（2026-09-28 两条新公告在本地被静默放过）。
  if (unavailable.length) {
    log('::warning::SCANNER_UNAVAILABLE: ' + unavailable.join(' ')
      + ' —— 该域本轮不判（其挂账条目也不判成"已不再命中"），已扫描域照常判违规');
  }

  const base = readBaseline(bp);
  if (isUpdate) {
    const body = writeBaseline(found, base, bp);
    log('基线已写入', bp, '（' + body.advisories.length + ' 条；新增条目 decision=TODO 必须补结论）');
    return 0;
  }
  if (!base) {
    if (unavailable.length) {
      error('扫描器不可用，拒绝生成半份基线：' + unavailable.join(' '));
      return 1;
    }
    log('未找到基线，正在生成：' + bp);
    writeBaseline(found, null, bp);
    log('已生成，请补齐 decision/note 后再次运行以执行门禁。');
    return 0;
  }

  const { violations, migrations, scannedCount, ledgerCount } = evaluate(base, found, undefined, scannedSources);
  if (isJson) {
    log(JSON.stringify({ scannedCount, ledgerCount, found: sortEntries(found), migrations, violations }, null, 2));
  } else {
    log('=== 依赖漏洞审计门禁 ===');
    log('命中分布: ' + DOMAINS.map((s) => s + '=' + (results[s] || []).length).join(' ') + ' 命中=' + scannedCount + ' 挂账=' + ledgerCount);
    // 换号必须出声：静默会让人下次又把它当"幽灵公告"排查一遍（本轮就是这么查的）。
    for (const m of migrations) {
      log('ℹ️ ID_MIGRATED: ' + m.source + '/' + m.from + ' → ' + m.source + '/' + m.to
        + ' —— 同一条公告换了主 id（旧号在 aliases 里），结论沿用；跑 --update 可把基线键迁到新号');
    }
    for (const v of violations) log('❌ ' + v);
    // 裁决 i2（QM-6 critic，已实测证实）：有迁移而零违规时，**不得**说「基线与现实一致」。
    // 实测形态：基线单键旧号 + found 新号 ⇒ violations=0，而基线里的键仍是旧号。
    // 那句话在这种状态下是自相矛盾的；更糟的是 CI 读者会据此认定"已对齐"而不跑
    // --update，于是 stale 基线被永久合法化 —— 正是欠账条目所说「训练人忽略门禁」
    // 的危害的**绿文版本**（红文至少吵，绿文不吵）。
    if (!violations.length && !migrations.length) {
      log('✅ 无新增已知漏洞公告，基线与现实一致且结论完整。' + '（口径：npm 两个域均按 --omit=dev / --prod 扫，dev 依赖不在判据面内）');
    } else if (!violations.length && migrations.length) {
      log('⚠️ 零违规，但基线里还有 ' + migrations.length + ' 条公告的主 id 已变更、键尚未迁移。');
      log('   结论本身有效（同一公告、同一版本、同一结论），但**基线尚未与现实对齐** —— 请跑 node scripts/check-dep-audit.js --update 把键迁到新号。');
    }
  }
  return violations.length ? 1 : 0;
}

function main () {
  const args = process.argv.slice(2);
  return runCheck({ isUpdate: args.includes('--update'), isJson: args.includes('--json') });
}

if (require.main === module) process.exitCode = main();

module.exports = {
  evaluate,
  PARSERS,
  patchedFromRange,
  runCheck,
  parseNpmAudit,
  parsePipAudit,
  parseNpmAuditV2,
  patchedFromRange,
  ghsaFromUrl,
  normalizePatched,
  checkTargetEscapes,
  DOMAINS,
  OPS_FRONTEND_REL,
  readBaseline,
  writeBaseline,
  sortEntries,
  createDefaultRunners,
  shellRun,
  VALID_DECISIONS,
  DEFAULT_REGISTRY,
  BASELINE_PATH,
};
