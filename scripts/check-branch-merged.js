// 「分支内容是否已完整进主干」的机械判据 —— 删本地分支前的闸门（只读，不删任何东西）。
//
// 为什么要有这个文件（2026-10-16）：这条判据此前只以 AGENTS.md 的散文存在，每轮清理由会话临时手写探针执行。
// 散文判据挡不住两类事故：① 判据本体写错（旧口径「`git diff --stat <tip> <mergeSHA>` 为空」在 5 例真实合并里
// 3 例假阳性）；② 判据非空时人照样删——本轮真实发生一次（差量 52/10/5 行仍删了 worktree 与分支）。
// 所以把它变成一条命令：红了就停手，绿了才允许走 safe-worktree-remove.ps1 + `git branch -D`。
//
// 判据本体（对应 AGENTS.md「收尾链上的已知假失败」的 C 口径；2026-10-17 v3 起按**份数 + 可解释容量**对账）：
//   ① 逐文件先比 blob —— 强判据，零成本。**两侧同为缺席也算相等**：我把文件删了、主干也没有，那是删除落地了。
//   ② 不等时按键的**份数**双向对账，而不是"出现过即违规"：
//        缺口 tip(k) − main(k) > 0 —— 只有"他人对该键的净删除容量"能解释；
//          且当这份份数是我带来的（tip>base）时，还要求它**随本次合并落地过**（否则"别人加过又撤"能替我的未落地行作保）。
//        超出 main(k) − tip(k) > 0 —— 只有"他人净新增容量"能解释；解释不了时若我本是净删除 ⇒ LOST，
//          若我从没写过这个键 ⇒ UNATTRIBUTED（说不清就不许据此删分支，但也不谎报"我的东西丢了"）。
//      ⛔ 加法等式（main = base + Σ链上净增减）**只当自检，不当判据**，实测理由：判据若再叠上
//      "该行须随我的合并落地过"这道血统前提并无条件适用，就会把 fork 时就存在的存量算成丢失 ——
//      真实仓 bf520a13c 的 CHANGELOG 两行读数是 base=2 / tip=2 / main=0（主干后来把行里那个 BEL 控制字节改掉了），
//      他人的删除容量本来足以解释，却被 landed=0 压成容量 0 ⇒ 假 LOST；git grep 复核确认这两行不是我带来的内容。
//      血统前提因此收窄为"只对 tip>base 的键生效"。等式本身仍然每次跑：链上求和 ≠ main−base
//      ⇒ 我漏读了某种 git 形态 ⇒ 退出码 2（见 assertChainCloses，它本轮抓到我自己两处解析错）。
//   ③ 「多会话共用写面」不再靠手抄文件名名单，也不再按文件类别分两支 —— 份数口径对普通文件与热写面是同一条规则。
//   ④ 二进制文件没有行级判据可用（git 不给补丁，份数无从数）：退回到"我那份字节是否随本次合并进过主干"，并在输出里点名这次降级。
//   ⑤ 判据自己取不到读数一律按「未证实」处理并走独立退出码 2 —— 把工具的失明读成结论，是本仓「装饰性门禁」的同型。
//   ⑥ `violations[]` 逐键字段的读法（QM-6 前端轴提示 `dir` 之名易被读成"目录"，故在此写明，不改字段名）：
//        `dir` 是**缺口方向**三态（`short` / `over-deleted` / `over-extra`），与目录无关；`by` 是要解释的份数差；
//        `capacity` 是该键上他人净增/净减的**合计**（逐笔贡献者由 `lineAttributions` 点名，不在这里重复）；
//        `landedWithMerge` 是**跨多个 merge 取最大**份数，不是逐 merge 明细 —— 同分支多 PR 改同一文件时它偏宽松，
//        这条遗留已登记在 PRD §9「遗留」，读数时须知道它是上界而非分解。
//
// 参考系（2026-10-17 v2 修正，`--against`，默认 origin/main → 回落 main 并打印落点）：
//   判定域是「**主干现在**有没有这份内容」，`--merge` 只用来做归因排除（哪笔是本次合并自身）。
//   上一版把判定域钉在 merge 快照上，上线当天就被自己的清理任务否证：`toutiao-ms-token`
//   （tip b0df701cf，7 个已合并 PR）报 `lost=65 files=66`，而点名的 3628 行里 **3369 行就在当时的
//   origin/main 上**。机制不是主干丢了东西，而是分支 re-sync 过 main 之后 `merge-base(ref, merge)`
//   退化成 merge 本身 ⇒ 差量里混进**别人后来合进主干的行**，而那份快照按定义还没有它们 ⇒ 逐份 LOST ⇒
//   跨 merge 取 best 仍是 LOST。改为对 `against` 取 merge-base 之后，别人的行天然进不了判定域。
//   顺带把「空差量」从判据故障里分出来：内容与主干一致时"无差量"就是**通过态**（只在 ref 与 against
//   同指一处时才按参数误用报 2）——否则每次清理一个已完全落地的分支都要先撞一次红灯。
//
// 退出码：0 全部落地（可删）/ 1 存在 LOST 或 UNATTRIBUTED（禁止删）/ 2 判据自身故障（fail-closed，同样禁止据此删）。
// 依赖：只用 node 内置模块 —— 本文件被 quality-gate.yml 的 changes job 点名，而那个 job 没有 Install deps。
'use strict';

const { execFileSync } = require('child_process');

const VERDICTS = ['IDENTICAL', 'DRIFT-ATTRIBUTED', 'LOST', 'UNATTRIBUTED', 'JUDGE_ERROR', 'DIFFERENT-LANDING'];
const EXIT_OK = 0;
const EXIT_LOST = 1;
const EXIT_JUDGE_ERROR = 2;

// 行切分：保留每个换行符属于上一行（lookbehind split），CRLF/LF 混存文件不得被统一行尾。
function splitLines(s) {
  return s === '' ? [] : s.split(/(?<=\n)/);
}

// 比较用的归一化：去掉行尾换行与首尾空白。**只用于比较，不用于产物**（产物一律回显原始行）。
function key(line) {
  return line.replace(/[\r\n]+$/, '').trim();
}

function multisetOf(lines) {
  const m = new Map();
  for (const l of lines) {
    const k = key(l);
    if (k === '') continue;            // 空行/纯空白行不参与判定，否则每个文件都必红
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// 原始行代表（按 key 取第一条原文），用于把结论打印成人能核对的文本。
function representatives(lines) {
  const map = new Map();
  for (const l of lines) {
    const k = key(l);
    if (k !== '' && !map.has(k)) map.set(k, l);
  }
  return map;
}

/**
 * 他人净数按"同一笔内 + 与 − 相抵"算，且**必须先过段落结构**再认内容行。
 *
 * ⛔ 不能写 `if (t.startsWith('+++') || t.startsWith('---')) continue`：那是 v2 的真实盲区。
 *   删除一个 `---` 行，补丁里就是 `----`（− 再加 ---），被这个前缀判断当成文件头整行吃掉 ⇒
 *   删除侧净数被少算，真实仓实测把 CHANGELOG.md 的 `---` 判成 short=3（v3 第一版当场踩到，
 *   靠"链上求和 == main−base"这条恒等式自检暴露）。
 *   正解：只有**本文件段落里第一个 `@@` 之前**的行才是段落头（diff --git / index / --- / +++ / new mode），
 *   进入 hunk 之后一切 + / − 都是内容行；`\ No newline at end of file` 单独排除。
 */
function parsePatchNet(patch) {
  const net = new Map();
  let inHunk = false;
  let binary = false;
  for (const raw of patch.split('\n')) {
    const t = raw.replace(/[\r\n]+$/, '');
    if (t.startsWith('diff --git')) { inHunk = false; continue; }
    if (/^@@/.test(t)) { inHunk = true; continue; }
    if (!inHunk) {
      if (/Binary files /.test(t) || t.startsWith('GIT binary patch')) binary = true;
      continue;
    }
    if (t.charCodeAt(0) === 92) continue;                 // "\ No newline at end of file"
    if (!(t.startsWith('+') || t.startsWith('-'))) continue;
    const k = key(t.slice(1));
    if (k === '') continue;
    net.set(k, (net.get(k) || 0) + (t.startsWith('+') ? 1 : -1));
  }
  return { net, binary };
}

/**
 * v3 判据本体：**份数 + 可解释容量**，不是"出现过即违规"，也不是"加法等式"。
 *
 *   deficit(k) = tip(k) − main(k) > 0   ⇒ 我那份内容有副本只剩在分支上。
 *     可解释容量 = min( 他人对该键的"净删除"容量, 该行随本次合并进过主干的份数 )
 *     —— 两个都必须：没有"它曾进过主干"这一步，别人加过又撤的同文行就能替我的未落地行作保
 *        （QM-6 后端轴命中的洗白路径，T18）；没有容量，就是真丢失。
 *   excess(k) = main(k) − tip(k) > 0     ⇒ 主干多了我以为不该有的份数（我的删除被丢，或凭空多份）。
 *     可解释容量 = 他人对该键的"净新增"容量；超出容量的那部分才是违规。
 *
 * ⛔ 为什么这里**不用**"main = base + Σ(链上各笔净增减)"这条加法等式当判据（本会话先写成这样、被真实仓否证）：
 *   两条分支交出**逐字相同**的一行时，主干只会出现一份（第二次是幂等无操作）。
 *   等式会算出"我的那一份没落地"，而 git grep 实测该行在主干、份数与我的 tip 相同 ⇒ 假阳性。
 *   本仓这类重复贡献是常态（AGENTS 记过"同一条回填标题相隔 20 分钟各落一遍"）。
 *   等式仍然保留，但只当**自检**用（链上求和 != main−base ⇒ 我的解析漏了一种 git 形态 ⇒ 退出码 2），
 *   不当结论用。这两件事必须分开。
 */
function reconcileCounts(tipMap, mainMap, baseMap, caps, landedCount) {
  const short = [];
  const over = [];
  const keys = new Set([].concat(
    Array.from(tipMap.keys()), Array.from(mainMap.keys()), Array.from(caps.add.keys()), Array.from(caps.rem.keys())));
  for (const k of keys) {
    const tip = tipMap.get(k) || 0;
    const main = mainMap.get(k) || 0;
    if (!Number.isFinite(tip) || !Number.isFinite(main)) {
      throw new JudgeError('份数比较取到非数（判据自身故障，不得当"已合并"读）：key=' + JSON.stringify(k));
    }
    if (main < tip) {
      // 缺口分两种，只有一种要"随我的合并落地过"这道血统前提：
      //   这个键的份数**是我带来的**（tip > base）⇒ 血统前提必须有，否则别人加过又撤的同文行
      //      就能替"我的行从未落地"作保（QM-6 后端轴命中，T18）；
      //   份数与 base 相同（我根本没动过它）⇒ 这些副本本来就是主干上的存量，主干后来少了
      //      就是别人的删除，**不是我的工作**，不得拿"我的合并产物里没有"来拦清理。
      // 实测动因：bf520a13c 的 CHANGELOG 里两行含 BEL 控制字节（"：\x07utonomous-loop.yml"），
      // 主干后来把它修成了 "：autonomous-loop.yml"；这两行是 fork 时就有的存量 ⇒ 上一版把血统
      // 前提无条件套上去，容量被 landed=0 压成 0 ⇒ 假 LOST。控制字节本身归 Gate 12b 管，不在这里守。
      const introducedByMe = (tipMap.get(k) || 0) > (baseMap.get(k) || 0);
      const removalCap = caps.rem.get(k) || 0;
      const capacity = introducedByMe
        ? Math.min(removalCap, typeof landedCount === 'function' ? landedCount(k) : 0)
        : removalCap;
      const unexplained = tip - main - capacity;
      if (unexplained > 0) short.push({ key: k, by: unexplained, capacity: capacity, introducedByMe: introducedByMe });
    } else if (main > tip) {
      const addCap = caps.add.get(k) || 0;
      const unexplained = main - tip - addCap;
      if (unexplained > 0) {
        // 同样是"主干比我的 tip 多"，两种成因必须分开：
        //   我对这个键本是**净删除** ⇒ 多出来的就是我那次删除被合并丢掉 ⇒ 与工作有关，算 LOST；
        //   我从没删过它 ⇒ 只是谁也解释不了的多余内容，说不清就不许据此删分支，但也不谎报"我的东西丢了"。
        over.push({ key: k, by: unexplained, capacity: addCap, deletion: tip - (baseMap.get(k) || 0) < 0 });
      }
    }
  }
  return { short, over };
}

/**
 * 他人提交的**容量**表（不是净数）：add = 各笔正净增之和，rem = 各笔负净减的绝对值之和。
 * 按笔取绝对值再相加，是因为容量回答"这些差异最多能被解释掉多少"，
 * 而净数回答"实际变化了多少" —— 两者混用会把 T18 的加又撤算成 0 容量（对）或 2 容量（错）。
 */
function capacityCounts(entries) {
  const add = new Map();
  const rem = new Map();
  for (const e of entries) {
    for (const [k, v] of e.net) {
      if (v > 0) add.set(k, (add.get(k) || 0) + v);
      else if (v < 0) rem.set(k, (rem.get(k) || 0) - v);
    }
  }
  return { add, rem };
}

/**
 * 链上各笔（含本次合并）对每个键的净份数表 —— **只给恒等式自检用**。
 * 走 first-parent 链并要求合并提交对第一父出补丁（`--diff-merges=first-parent`）：
 * 默认 `git log -p` 对合并提交不给补丁，实测区间里有 27 个合并提交时求和少算，
 * 把 CHANGELOG.md 的 `---` 演成 short=1885。
 */
function netCounts(entries) {
  const m = new Map();
  for (const e of entries) {
    for (const [k, v] of e.net) {
      if (v === 0) continue;
      m.set(k, (m.get(k) || 0) + v);
    }
  }
  for (const [k, v] of Array.from(m)) if (v === 0) m.delete(k);
  return m;
}

// ---------------------------------------------------------------- git 只读封装
function git(root, args, allowFail) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', root].concat(args), { encoding: 'buffer', maxBuffer: 1 << 28 }).toString('latin1') };
  } catch (e) {
    if (allowFail) return { ok: false, out: '', err: String(e.message || e).slice(0, 200) };
    throw new JudgeError('git ' + args.join(' ') + ' 失败：' + String(e.message || e).slice(0, 200));
  }
}

class JudgeError extends Error {}

function verifyRef(root, ref) {
  const r = git(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'], true);
  if (!r.ok) return null;
  return r.out.trim();
}

// 差量的起点：分支与**参考系**的分叉点。取不到即判据故障 —— 没有 base 就什么都判不了，
// 不得退化成"整棵树都比一遍"或"当作没有差异"。
function mergeBase(root, a, b) {
  const mb = git(root, ['merge-base', a, b], true);
  const out = mb.ok ? mb.out.trim() : '';
  if (out === '') throw new JudgeError('取不到 merge-base：' + String(a).slice(0, 8) + ' / ' + String(b).slice(0, 8));
  return out;
}

// 某 ref 的树里该文件是否存在及其 blob oid；不存在返回 null，ref 坏由调用方先挡掉。
function blobOid(root, ref, file) {
  const r = git(root, ['ls-tree', ref, '--', file], true);
  if (!r.ok) throw new JudgeError('ls-tree ' + ref + ' ' + file + ' 读不到');
  const line = r.out.split('\n').find((l) => l.trim() !== '');
  if (!line) return null;
  const m = /^(\d+)\s+\w+\s+([0-9a-f]{40})\t/.exec(line);
  if (!m) throw new JudgeError('ls-tree 输出解析不出 oid：' + line.slice(0, 60));
  return m[2];
}

function blobText(root, oid) {
  const r = git(root, ['cat-file', 'blob', oid], true);
  if (!r.ok) throw new JudgeError('cat-file ' + oid.slice(0, 8) + ' 读不到');
  return r.out;
}

// 我在 base..ref 上对这个文件的 +/- 行
// 差异归因 + 逐行归因共用同一次 `git log -p` 读数。
// ⛔ 这里**不能**用 `git log -S<行>`：判据内部把 blob 按 latin1 读以保字节，而 execFileSync 会把字符串
//   参数按 **UTF-8** 编码送出 ⇒ 中文行在 argv 上变成 mojibake（æ → c3 a6），与 blob 的真实字节永远对不上。
//   实测后果（2026-10-17，真实仓 gate4-desktop-exclusion 的记录文件）：同一文件里纯 ASCII 的
//   `sync_status: PENDING` 归因命中，紧随其后的两条中文行全部救不走 —— 即"判据对非 ASCII 行永久失明"，
//   而本仓入库文档绝大多数是中文。改为在**同一字节空间**里比对补丁行。
function patchesFor(root, base, against, file, excludeShas) {
  // 分隔符放在 %H **之前**：git 会在每条记录的格式化行后接换行再接补丁，
  // 若把 %x00 放在 %H 之后，split 出来的分片就会"上一段的尾巴带着下一段的 sha"，
  // 于是 sha 与 patch 错位配对 —— 实测这样构造出的归因列表 sha 全错（T2 当场抓住）。
  // --first-parent + --diff-merges=first-parent：见 netCounts 的注释，缺了它们链上有真合并提交时求和必少算。
  const l = git(root, ['log', '--first-parent', '--diff-merges=first-parent',
    '--format=%x00%H%x09%h%x09%s', '-p', base + '..' + against, '--', file], true);
  if (!l.ok) throw new JudgeError('log -p 归因失败：' + file);
  const skip = new Set(excludeShas || []);
  const out = [];
  const chunks = l.out.split('\0');
  for (let i = 1; i < chunks.length; i++) {
    const body = chunks[i].replace(/^\n/, '');
    const nl = body.indexOf('\n');
    const head = nl < 0 ? body : body.slice(0, nl);
    const patch = nl < 0 ? '' : body.slice(nl + 1);
    const [sha, abbrev, subject] = head.split('\t');
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;     // 形状断言：解析退化不得当"有归因"
    const parsed = parsePatchNet(patch);
    const entry = { sha, subject: (abbrev || '') + ' ' + (subject || ''), net: parsed.net, binary: parsed.binary };
    if (skip.has(sha)) continue;                   // 本次合并自身不算他人
    out.push(entry);
  }
  return out;
}

// 文件级归因：base..against 的 first-parent 链里除本次合并之外，还有谁碰过这个文件。
function attributionsForRoot(root, base, against, file, excludeShas) {
  return patchesFor(root, base, against, file, excludeShas)
    .map((e) => ({ sha: e.sha, subject: e.subject }));
}

// 逐行点名（方向敏感）：
//   want='removed' —— 这一行为什么现在比预期少：链上必须有一笔提交对它**净为负**；
//   want='added'   —— 这一行为什么比预期多：链上必须有一笔提交对它**净为正**。
// "净"由 parsePatchNet 在段落结构内算，同一笔里挪位置（net=0）不算证据 ——
// 这正是 QM-6 后端轴命中的那条洗白路径（T18 钉住），v3 里它由守恒式自己保证。
function findLineCommit(entries, line, want) {
  const k = key(line);
  if (k === '') return null;
  for (const e of entries) {
    const v = e.net.get(k) || 0;
    if (want === 'removed' && v < 0) return { sha: e.sha, subject: e.subject };
    if (want === 'added' && v > 0) return { sha: e.sha, subject: e.subject };
  }
  return null;
}

// 区间内（排除本次合并）把这份文件**整份删掉**的具名提交 —— 缺席形态唯一的正当解释。
// 与 patchesFor 同一套分片写法：%x00 放在 %H **之前**，并把 sha 做形状断言，
// 否则解析退化时会把"读不到"演成"有人删的"（v2 实测错过一次，M8 钉住）。
function deletionCommitsFor(root, base, against, file, excludeShas) {
  const l = git(root, ['log', '--diff-filter=D', '--format=%x00%H%x09%h%x09%s', base + '..' + against, '--', file], true);
  if (!l.ok) throw new JudgeError('log --diff-filter=D 归因失败：' + file);
  const skip = new Set(excludeShas || []);
  const out = [];
  for (const chunk of l.out.split('\0').slice(1)) {
    const head = chunk.split('\n')[0];
    const [sha, abbrev, subject] = head.split('\t');
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    if (skip.has(sha)) continue;
    out.push({ sha: sha, subject: (abbrev || '') + ' ' + (subject || '') });
  }
  return out;
}

/**
 * 恒等式自检：Σ(链上各笔对该文件的净增减) 必须精确等于 main − base 的份数差。
 * 闭不上就是"我的读数/解析漏了一种 git 形态"，而不是"内容丢了" —— 本轮实测靠它抓到两处自己的错：
 *   ① 段落头用 startsWith('---') 判定，把删除 `---` 行产生的 `----` 当成文件头整行吃掉；
 *   ② `git log -p` 对合并提交不给补丁，区间里有 27 个合并提交时求和少算（CHANGELOG 的 `---` 被演成 short=1885）。
 * 这一条把"工具的数学错了"与"内容真的没落地"分开 —— 前者走退出码 2，后者才走 1。
 * ⛔ 它**不是**判据（不做任何结论），也正因为真实仓里它总是闭合，没法靠现场夹具反证 ⇒
 *   所以单独抽成函数并配直接的正/负控锁，而不是让它只活在 classifyFile 里当一段无法证伪的代码。
 */
function assertChainCloses(file, baseMap, mainMap, chainNet) {
  const openKeys = [];
  for (const k of new Set([].concat(Array.from(baseMap.keys()), Array.from(mainMap.keys()), Array.from(chainNet.keys())))) {
    const lhs = (mainMap.get(k) || 0) - (baseMap.get(k) || 0);
    const rhs = chainNet.get(k) || 0;
    if (lhs !== rhs) openKeys.push({ key: k, by: lhs - rhs });
  }
  if (openKeys.length > 0) {
    const sample = openKeys.slice(0, 2).map((o) => JSON.stringify(o.key.slice(0, 30)) + ' 偏差 ' + o.by).join(' / ');
    throw new JudgeError(file + '：链上求和与 main−base 不闭合（' + openKeys.length + ' 个键；' + sample +
      '）⇒ 归因面漏看了某种 git 形态，此时既不能判"已合并"也不能判"丢失"');
  }
  return openKeys;
}

// ---------------------------------------------------------------- 单文件判定
// 我的行"进过主干几份"的唯一凭据 = 本次合并（们）的产物里该键的份数，逐份取最大。
// 缺了这一步，"别人加过又撤的同文行"就能替我的未落地行作保（QM-6 后端轴命中，T18 钉住）。
function mergedCopiesOf(root, mergedShas, file) {
  const per = [];
  for (const sha of mergedShas || []) {
    if (!sha) { per.push(null); continue; }
    const oid = blobOid(root, sha, file);
    per.push(oid === null ? null : multisetOf(splitLines(blobText(root, oid))));
  }
  return (k) => {
    let mx = 0;
    for (const m of per) if (m) mx = Math.max(mx, m.get(k) || 0);
    return mx;
  };
}

// 「合并产物里这个文件的那一份」相对「我这版」和「改动起点」是什么关系。**读数不宣称方向**。
// 三分而不是两分，是因为"产物 ≠ 我这版"有两种成因，危险方向相反：
//   not-carried —— 产物**等于起点** ⇒ 这笔合并根本没带上我的改动，那是真丢失，不得被另一格洗白；
//   different   —— 产物既不是我这版也不是起点 ⇒ 只知道"这笔落地的不是我当前这版"。
//                  方向未定：可能是评审改了产物再落地（本仓 #3733 就是这种），也可能是**分支在这笔之后
//                  自己又前进了**（同一分支被两笔 PR 用过时，早期那笔合法落地的版本也会落进这一格 ——
//                  由 QM-6 后端轴 B1 提出并经本地复现证实，见测试 T33）。要定性必须去比 blob，不得由本读数代答。
// 只比较 tip 与 merge 两个 blob 会把前两格合成一格，那正是最危险的一次合并。
function classifyRevision(mergeBlob, tipBlob, baseBlob) {
  if (mergeBlob === tipBlob) return 'carried';
  if (mergeBlob === baseBlob) return 'not-carried';
  return 'different';
}

// 「版本不同」能不能被显式放行 —— 这是**唯一**一处决定旗标覆盖面放多大宽的地方。
// 2026-10-20 的现场读数把"降这一格就能解锁分支"这句话否证了一半，因此这里刻意做成三条都不满足即不放行：
//   not-carried 存在 ⇒ 有一笔合并**根本没带上**我这版 ⇒ 永不放行（旗标若把它稀释掉就是替真丢失作保）；
//   carried > 0      ⇒ 逐字节带过我这版、主干现在却没有 ⇒ 那是"落地之后被删"，不是"被修订"，方向相反；
//   三格皆空/取不到  ⇒ 没有任何一笔合并可证明"落的是另一版" ⇒ 按未证实处理。
// 注意它**不是**一个安全属性：`#2729` 的 `rpa-view-navigation-helpers.js` 报"我这版独有 228 行"，
// 而那句话在主干同一文件 :194 原样存在，缺口是热写面的重复键**份数**。所以放行只发生在有人当面授权、
// 且这一行仍把双向规模一起打出来的前提下 —— 默认档永远不放行（见 T34）。
function releaseEligibleForLanding(rev) {
  if (!rev) return false;
  const different = rev.different || [];
  const notCarried = rev.notCarried || [];
  return different.length > 0 && notCarried.length === 0 && !rev.carried;
}

// 两份文本的按键差异规模（按行多重集，不做任何归一化 —— 与判定本体同一口径）。
function lineDiffScale(tipText, mergeText) {
  const am = multisetOf(splitLines(tipText));
  const bm = multisetOf(splitLines(mergeText));
  let onlyInMerge = 0, onlyInTip = 0;
  for (const k of new Set([...am.keys(), ...bm.keys()])) {
    const a = am.get(k) || 0, b = bm.get(k) || 0;
    if (b > a) onlyInMerge += b - a; else onlyInTip += a - b;
  }
  return { onlyInMerge, onlyInTip };
}

function revisionsAtMerge(root, mergedShas, file, tipBlob, baseBlob) {
  const out = { carried: 0, different: [], notCarried: [] };
  for (const sha of mergedShas || []) {
    if (!sha) continue;
    const mb = blobOid(root, sha, file);
    const kind = classifyRevision(mb, tipBlob, baseBlob);
    if (kind === 'carried') { out.carried++; continue; }
    if (kind === 'not-carried') { out.notCarried.push({ at: String(sha).slice(0, 9) }); continue; }
    const d = lineDiffScale(tipBlob === null ? '' : blobText(root, tipBlob), mb === null ? '' : blobText(root, mb));
    out.different.push({ at: String(sha).slice(0, 9), onlyInMerge: d.onlyInMerge, onlyInTip: d.onlyInTip });
  }
  return out;
}

function classifyFile(root, { ref, against, base, file, excludeShas }) {
  const tipBlob = blobOid(root, ref, file);
  const againstBlob = blobOid(root, against, file);
  // 两侧同形即"没有差异"——包括**都为缺席**（我把文件删了、主干也没有了）：那正是删除落地了。
  // v2 在这里要求 tipBlob 非 null，于是"删文件的 PR 完整落地"也被判 LOST（第三类假阳性）。
  if (tipBlob === againstBlob) {
    return { verdict: 'IDENTICAL', attributions: [], lineAttributions: [], missingAdded: [], reappearedRemoved: [] };
  }
  // 链上一次读全（含本次合并），既给"他人"用，也给下面的恒等式自检用 —— 两次 git log 会翻倍成本，故只取一次。
  const allEntries = patchesFor(root, base, against, file, []);
  const skip = new Set(excludeShas || []);
  const entries = allEntries.filter((e) => !skip.has(e.sha));
  const attributions = entries.map((e) => ({ sha: e.sha, subject: e.subject }));

  const baseBlob = base ? blobOid(root, base, file) : null;
  const tipText = tipBlob === null ? '' : blobText(root, tipBlob);
  const mainText = againstBlob === null ? '' : blobText(root, againstBlob);
  const baseText = baseBlob === null ? '' : blobText(root, baseBlob);
  // 落地版本读数：只解释"为什么报缺"，不参与判据宽严 —— 退出码仍由 LOST/UNATTRIBUTED 决定。
  const revisions = revisionsAtMerge(root, excludeShas, file, tipBlob, baseBlob);
  // 二进制（含 NUL，或链上出现 "Binary files … differ"）：git 不给补丁，份数根本数不出来。
  // 这一族必须单列，否则恒等式自检会把每个 PNG 分支都判成 rc=2 —— 那不是严格，是工具失明。
  const binaryFile = [tipBlob, againstBlob, base].some((oid, i) => {
    const txt = i === 0 ? tipText : (i === 1 ? mainText : baseText);
    return txt.indexOf('\0') >= 0;
  }) || allEntries.some((e) => e.binary);

  // 整份文件不在主干：能点名"谁删的"就是漂移，点不出就是本次合并把它漏了。
  if (againstBlob === null) {
    const del = deletionCommitsFor(root, base, against, file, excludeShas);
    if (del.length > 0) {
      return {
        verdict: 'DRIFT-ATTRIBUTED', fileAbsentOnMain: true, fileDeletedByOthers: true,
        attributions: dedupeBySha(attributions.concat(del)), lineAttributions: del,
        missingAdded: [], reappearedRemoved: [], revisionsAtMerge: revisions,
      };
    }
    const tipLines = tipBlob === null ? [] : splitLines(tipText);
    return {
      verdict: 'LOST', fileAbsentOnMain: true, fileDeletedByOthers: false, attributions,
      lineAttributions: [], missingAdded: [...representatives(tipLines).values()], reappearedRemoved: [],
      revisionsAtMerge: revisions,
    };
  }

  if (binaryFile) {
    // 二进制没有行级判据可用 ⇒ 只问一件事：**我那份字节有没有随本次合并进过主干**。
    // 进了 ⇒ 差异是后来别人改的（可归因）；没进 ⇒ 我的产物被换过，删分支就会丢那份字节。
    const mergeCarriedIt = (excludeShas || []).some((sha) => sha && blobOid(root, sha, file) === tipBlob);
    const tag = { binaryFile: true, revisionsAtMerge: revisions, missingAdded: mergeCarriedIt ? [] : [tipText.slice(0, 24) + '\n'], reappearedRemoved: [] };
    if (mergeCarriedIt && attributions.length > 0) {
      return Object.assign({ verdict: 'DRIFT-ATTRIBUTED', attributions, lineAttributions: [] }, tag, { missingAdded: [], reappearedRemoved: [] });
    }
    if (mergeCarriedIt) {
      return Object.assign({ verdict: 'UNATTRIBUTED', attributions: [], lineAttributions: [] }, tag, { missingAdded: [], reappearedRemoved: [] });
    }
    return Object.assign({ verdict: 'LOST', attributions, lineAttributions: [] }, tag);
  }

  const tipMap = multisetOf(splitLines(tipText));
  const mainMap = multisetOf(splitLines(mainText));
  const baseMap = multisetOf(splitLines(baseText));
  const tipReps = representatives(splitLines(tipText));
  const mainReps = representatives(splitLines(mainText));

  // 恒等式自检（本体已抽成 assertChainCloses，便于直接配正/负控锁）：只诊断"归因面能不能读全这段历史"，不参与结论。
  assertChainCloses(file, baseMap, mainMap, netCounts(allEntries));

  const caps = capacityCounts(entries);
  const landed = mergedCopiesOf(root, excludeShas, file);
  const rec = reconcileCounts(tipMap, mainMap, baseMap, caps, landed);
  const detailOf = (dir, v) => ({
    dir: dir, key: v.key, by: v.by, capacity: v.capacity,
    base: baseMap.get(v.key) || 0, tip: tipMap.get(v.key) || 0, main: mainMap.get(v.key) || 0,
    landedWithMerge: landed(v.key),
  });

  const missingAdded = [];
  const reappearedRemoved = [];
  const unexplainedOver = [];
  const violations = [];
  for (const s of rec.short) {
    missingAdded.push(tipReps.get(s.key) || mainReps.get(s.key) || (s.key + '\n'));
    violations.push(detailOf('short', s));
  }
  for (const o of rec.over) {
    // 同样是"主干比预期多"，两种成因必须分开：
    //   我对这个键本是**净删除** ⇒ 多出来的就是我那次删除被合并丢掉了 ⇒ 与工作有关，算 LOST；
    //   我从没删过它 ⇒ 只是一份谁也解释不了的多余内容，说不清就不许据此删分支，但也不谎报"我的东西丢了"。
    if (o.deletion) reappearedRemoved.push(mainReps.get(o.key) || tipReps.get(o.key) || (o.key + '\n'));
    else unexplainedOver.push(mainReps.get(o.key) || (o.key + '\n'));
    violations.push(detailOf(o.deletion ? 'over-deleted' : 'over-extra', o));
  }

  // 逐行点名：守恒能对上是因为他人净增减抵掉了差 ⇒ 把那些键的贡献者打出来（不是"该文件有别人动过"）。
  const lineAttributions = [];
  const seenLine = new Set();
  for (const k of new Set([].concat(Array.from(caps.add.keys()), Array.from(caps.rem.keys())))) {
    const who = findLineCommit(entries, k + '\n', (caps.add.get(k) || 0) > 0 ? 'added' : 'removed');
    if (who && !seenLine.has(who.sha)) { seenLine.add(who.sha); lineAttributions.push(who); }
  }

  if (missingAdded.length > 0 || reappearedRemoved.length > 0) {
    return {
      verdict: 'LOST', fileAbsentOnMain: false, attributions, lineAttributions,
      missingAdded, reappearedRemoved, unexplainedOver, violations, revisionsAtMerge: revisions,
    };
  }
  if (unexplainedOver.length > 0) {
    return {
      verdict: 'UNATTRIBUTED', fileAbsentOnMain: false, attributions, lineAttributions,
      missingAdded: [], reappearedRemoved: [], unexplainedOver, violations, revisionsAtMerge: revisions,
    };
  }
  if (attributions.length === 0 && lineAttributions.length === 0) {
    return { verdict: 'UNATTRIBUTED', attributions: [], lineAttributions: [], missingAdded: [], reappearedRemoved: [], violations: [], revisionsAtMerge: revisions };
  }
  return {
    verdict: 'DRIFT-ATTRIBUTED',
    attributions: dedupeBySha(attributions.concat(lineAttributions)),
    lineAttributions,
    missingAdded: [], reappearedRemoved: [], violations: [], revisionsAtMerge: revisions,
  };
}

function dedupeBySha(list) {
  const seen = new Set();
  const out = [];
  for (const a of list || []) {
    if (!a || !a.sha || seen.has(a.sha)) continue;
    seen.add(a.sha);
    out.push(a);
  }
  return out;
}

/**
 * 对 (ref, merges[]) 跑判据，返回结构化结果。不打印、不决定退出码。
 * 判定域 = `--against`（默认 origin/main，取不到回落 main）；merges 仅用于归因排除。
 * 任何"判据自己没读到数"的情形置 judgeError=true 并附原因 —— 调用方必须走 2，不得读成 0 或 1。
 */
function collect(opts) {
  const root = opts.root || process.cwd();
  const res = {
    ref: opts.ref, merges: opts.merges || [], files: [], judgeError: false, reasons: [],
    against: null, againstSha: null, emptyDelta: false,
  };
  try {
    if (!opts.ref || !verifyRef(root, opts.ref)) throw new JudgeError('--ref 取不到提交：' + opts.ref);
    const refSha = verifyRef(root, opts.ref);
    if (opts.merges.length === 0) throw new JudgeError('merge SHA 清单为空');
    if (opts.base && !verifyRef(root, opts.base)) throw new JudgeError('--base 取不到提交：' + opts.base);
    for (const m of opts.merges) if (!verifyRef(root, m)) throw new JudgeError('--merge 取不到提交：' + m);

    // 参考系解析：显式传入必须可解析；默认档按 origin/main → main 回落，落点一律打印（回落不得静默）。
    let againstName = opts.against;
    let againstSha = null;
    if (againstName) {
      againstSha = verifyRef(root, againstName);
      if (!againstSha) throw new JudgeError('--against 取不到提交：' + againstName);
    } else {
      for (const cand of ['origin/main', 'main']) {
        againstSha = verifyRef(root, cand);
        if (againstSha) { againstName = cand; break; }
      }
      if (!againstSha) throw new JudgeError('默认参考系 origin/main 与 main 都取不到 —— 先 git fetch，或显式传 --against');
    }
    res.against = againstName;
    res.againstSha = againstSha;

    const base = opts.base ? verifyRef(root, opts.base) : mergeBase(root, refSha, againstSha);
    const mergedShas = opts.merges.map((x) => verifyRef(root, x));
    const d = git(root, ['diff', '--name-only', base, refSha], true);
    if (!d.ok) throw new JudgeError('取改动集失败：' + base.slice(0, 8) + '..' + refSha.slice(0, 8));
    const files = splitLines(d.out).map((l) => l.replace(/[\r\n]+$/, '')).filter((l) => l !== '');
    for (const f of files) {
      res.files.push(Object.assign({ file: f },
        classifyFile(root, {
          ref: refSha, against: againstSha, base, file: f,
          excludeShas: mergedShas,
        })));
    }
    // 反失明分两种，方向相反，不得合并：
    //  ① ref 与 against 同指一处 ⇒ 参数误用（把主干自己当成分支传进来了）⇒ 判据故障；
    //  ② 差量为空而两者不同 ⇒ 该分支相对主干已无独有内容 ⇒ **合法通过态**（上一版把它当 ①，
    //     于是每清一个"已完全落地"的分支都要先撞一次红灯，而红了就停手这条规矩本身是对的——
    //     把一个正常状态做成故障，等于训练使用者绕过闸门）。
    if (res.files.length === 0) {
      if (refSha === againstSha) throw new JudgeError('改动集为空且 ref 与 against 同指一处（请核对 --ref/--against/--merge）');
      res.emptyDelta = true;
    }
    for (const f of res.files) {
      if (f.verdict === 'JUDGE_ERROR') throw new JudgeError('文件判定异常：' + f.file);
    }
    // 显式放行档：**默认档这一段整条跳过**（T34 锁的就是这个"跳过"）。
    // 只把 LOST 且通过 releaseEligibleForLanding 的行改档；UNATTRIBUTED / JUDGE_ERROR / not-carried 一律不动。
    res.optIn = { allowDifferentLanding: !!opts.allowDifferentLanding };
    if (opts.allowDifferentLanding) {
      res.releasedDifferent = 0;
      for (const f of res.files) {
        if (f.verdict !== 'LOST') continue;
        if (!releaseEligibleForLanding(f.revisionsAtMerge)) continue;
        f.verdict = 'DIFFERENT-LANDING';
        f.releasedByOptIn = true;
        res.releasedDifferent++;
      }
    }
  } catch (e) {
    if (e instanceof JudgeError) {
      res.judgeError = true;
      res.reasons.push(e.message);
    } else {
      throw e;
    }
  }
  return res;
}

// ---------------------------------------------------------------- CLI
const KNOWN_FLAGS = ['--ref', '--merge', '--base', '--against', '--root', '--json', '--help', '--allow-different-landing'];
const BOOL_FLAGS = ['--json', '--help'];

function parseArgv(argv) {
  const o = { merges: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (!KNOWN_FLAGS.includes(name)) throw new JudgeError('未知旗标：' + a + '（可用：' + KNOWN_FLAGS.join(' ') + '）');
    // 显式放行旗标：只认"出现即生效"，不接受取值（`--allow-different-landing=false` 这种写法
    // 会被读成"有人以为它能关掉放宽"，而它其实已经生效 ⇒ 一律按未知用法拒绝）。
    if (name === '--allow-different-landing') {
      if (eq >= 0) throw new JudgeError('旗标 --allow-different-landing 不接受取值（它是"本次由人授权"的声明，写成 =false 会被读成能关）');
      o.allowDifferentLanding = true;
      continue;
    }
    if (BOOL_FLAGS.includes(name)) { o[name.slice(2)] = true; continue; }
    // --flag=v 与 --flag v 两种写法都必须生效（只认一种会把"smoke 只跑 4 个"静默放大成整域两趟，同族实测见 AGENTS.md）
    let val = eq >= 0 ? a.slice(eq + 1) : argv[i + 1];
    if (eq < 0 && (val === undefined || String(val).startsWith('--'))) throw new JudgeError('旗标 ' + name + ' 缺取值');
    if (eq < 0) i++;
    if (name === '--ref') o.ref = val;
    else if (name === '--merge') o.merges = String(val).split(',').map((s) => s.trim()).filter(Boolean);
    else if (name === '--base') o.base = val;
    else if (name === '--against') o.against = val;
    else if (name === '--root') o.root = val;
  }
  return o;
}

// 打印用：内部按 latin1 保字节，输出时还原成 UTF-8，否则中文行会变成乱码。
function show(line) {
  return Buffer.from(String(line), 'latin1').toString('utf8').replace(/[\r\n]+$/, '');
}

// 落地版本读数的人话形态。**不参与退出码**：它回答"为什么报缺"，不回答"能不能删"。
function describeRevisions(rev) {
  if (!rev) return '';
  const parts = [];
  const different = rev.different || [];
  const notCarried = rev.notCarried || [];
  if (different.length) {
    parts.push('版本不同@' + different.slice(0, 2).map((x) =>
      x.at + '(主干独有' + x.onlyInMerge + '行/我这版独有' + x.onlyInTip + '行)').join(',') +
      (different.length > 2 ? ' …(共 ' + different.length + ' 笔)' : ''));
  }
  if (notCarried.length) {
    parts.push('根本没带上@' + notCarried.slice(0, 2).map((x) => x.at).join(',') +
      (notCarried.length > 2 ? ' …(共 ' + notCarried.length + ' 笔)' : ''));
  }
  return parts.length ? ' 落地版本=' + parts.join(' ; ') : '';
}

// `--json` 也是给人/机器核对证据用的出口，所以同样必须做 latin1→UTF-8 还原。
// v2 只还原了 plain 出口，于是 --json 里的中文违规行打成 mojibake（æ 一切），
// 而自动化消费者只会读 --json —— 等于把最关键的那份证据做成不可用。
function readable(r) {
  const one = (f) => Object.assign({}, f, {
    missingAdded: (f.missingAdded || []).map(show),
    reappearedRemoved: (f.reappearedRemoved || []).map(show),
    unexplainedOver: (f.unexplainedOver || []).map(show),
    // violations[].key 也是同一份 latin1 原文 —— 漏掉它，--json 里的中文证据依旧是 mojibake，
    // 而 plain 出口看着正常，于是"已经修好编码"这句话只对一半的出口成立。
    violations: (f.violations || []).map((v) => Object.assign({}, v, { key: show(v.key) })),
    attributions: (f.attributions || []).map((a) => ({ sha: a.sha, subject: show(a.subject) })),
    lineAttributions: (f.lineAttributions || []).map((a) => ({ sha: a.sha, subject: show(a.subject) })),
  });
  return Object.assign({}, r, { files: (r.files || []).map(one), reasons: (r.reasons || []).slice() });
}

function main(argv) {
  let o;
  try {
    o = parseArgv(argv);
  } catch (e) {
    console.error('[BRANCH-MERGED] 参数不合法：' + e.message);
    return EXIT_JUDGE_ERROR;
  }
  if (o.help) {
    console.log('用法：node scripts/check-branch-merged.js --ref <branch|sha|tag> --merge <sha>[,<sha>...] [--against origin/main] [--base <ref>] [--root <repo>] [--json] [--allow-different-landing]');
    console.log('  判定域 = --against（默认 origin/main，取不到回落 main 并打印落点）；--merge 仅用于归因排除。');
    console.log('退出码：0 内容已完整进主干（可删分支）/ 1 存在 LOST 或 UNATTRIBUTED（禁止删）/ 2 判据自身故障（同样禁止据此删）');
    return EXIT_OK;
  }
  if (!o.ref) { console.error('[BRANCH-MERGED] 缺 --ref（不得当成"没有问题"）'); return EXIT_JUDGE_ERROR; }
  if (o.merges.length === 0) { console.error('[BRANCH-MERGED] 缺 --merge（归因排除要用）'); return EXIT_JUDGE_ERROR; }

  const r = collect({
    ref: o.ref, merges: o.merges, base: o.base, against: o.against,
    root: o.root || process.cwd(), allowDifferentLanding: !!o.allowDifferentLanding,
  });
  const counts = { IDENTICAL: 0, 'DRIFT-ATTRIBUTED': 0, LOST: 0, UNATTRIBUTED: 0, JUDGE_ERROR: 0, 'DIFFERENT-LANDING': 0 };
  for (const f of r.files) counts[f.verdict] = (counts[f.verdict] || 0) + 1;
  const againstNote = r.against ? 'against=' + r.against + '@' + String(r.againstSha).slice(0, 9) : 'against=<未解析>';

  if (o.json) {
    console.log(JSON.stringify(Object.assign(readable(r), { counts: counts }), null, 2));
  } else {
    if (r.emptyDelta) {
      console.log('[BRANCH-MERGED] ref 相对 ' + againstNote + ' 无差量 ⇒ 该分支已无独有内容（这是通过态，不是判据失明）');
    }
    for (const f of r.files) {
      const all = f.attributions || [];
      const who = all.slice(0, 6).map((a) => show(a.subject).slice(0, 60));
      const more = all.length > 6 ? ' …(共 ' + all.length + ' 笔)' : '';
      console.log(f.file + ' ' + f.verdict +
        ((f.fileAbsentOnMain ? 1 : 0) ? '(整份文件不在主干' + (f.fileDeletedByOthers ? '，后被具名提交删除' : '') + ')' : '') +
        (f.binaryFile ? '(二进制，行级判据不适用)' : '') +
        (who.length ? ' ←归因: ' + who.join(' / ') + more : '') +
        (f.missingAdded && f.missingAdded.length ? ' 缺失新增行=' + f.missingAdded.map(show).slice(0, 3).join(' | ') : '') +
        (f.reappearedRemoved && f.reappearedRemoved.length ? ' 删除行复现=' + f.reappearedRemoved.map(show).slice(0, 3).join(' | ') : '') +
        (f.unexplainedOver && f.unexplainedOver.length ? ' 多余内容未归因=' + f.unexplainedOver.map(show).slice(0, 3).join(' | ') : '') +
        (f.violations && f.violations.length ? ' 份数=' + f.violations.slice(0, 2).map((v) =>
          v.dir + ' ' + v.by + '(base=' + v.base + ' tip=' + v.tip + ' main=' + v.main +
          ' 可解释容量=' + v.capacity + ' 随合并落地过(跨 PR 取最大)=' + v.landedWithMerge + ')').join(' ; ') : '') +
        describeRevisions(f.revisionsAtMerge));
    }
  }
  const revOf = (v) => (v && v.revisionsAtMerge) || {};
  const nDifferent = r.files.filter((x) => ((revOf(x).different) || []).length > 0).length;
  const nNotCarried = r.files.filter((x) => ((revOf(x).notCarried) || []).length > 0).length;
  const released = (r.releasedDifferent || 0);
  if (o.allowDifferentLanding) {
    console.log('[BRANCH-MERGED][OPT-IN] --allow-different-landing 生效：放行 ' + released +
      ' 个「落地版本不同」的 LOST 行。**放行不等于内容已落地** —— 本旗标只承认"这笔合并落的是另一版"，' +
      '不承认方向（可能是评审改了产物，也可能那份拷贝根本没落、主干靠重复键份数看着还在）。' +
      '删分支前须逐行核 落地版本= 的双向规模，必要时比 blob；「根本没带上」那格本旗标永不放行。');
  }
  console.log('[BRANCH-MERGED] ref=' + String(o.ref).slice(0, 12) + ' ' + againstNote +
    ' merges=' + r.merges.length + ' files=' + r.files.length +
    ' identical=' + counts.IDENTICAL + ' drift=' + counts['DRIFT-ATTRIBUTED'] +
    ' lost=' + counts.LOST + ' unattributed=' + counts.UNATTRIBUTED +
    ' judge_error=' + (r.judgeError ? 1 : 0) +
    ' 落地版本不同=' + nDifferent + ' 没带上=' + nNotCarried +
    (o.allowDifferentLanding ? ' 放行=' + released : ''));
  if (r.judgeError) {
    for (const why of r.reasons) console.error('[BRANCH-MERGED] 判据自身故障（按"未证实"处理，不得据此删分支）：' + why);
    return EXIT_JUDGE_ERROR;
  }
  if (counts.LOST > 0 || counts.UNATTRIBUTED > 0) return EXIT_LOST;
  return EXIT_OK;
}

module.exports = {
  VERDICTS, EXIT_OK, EXIT_LOST, EXIT_JUDGE_ERROR,
  splitLines, key, multisetOf, reconcileCounts, capacityCounts, netCounts, parsePatchNet, assertChainCloses,
  JudgeError,
  classifyRevision, lineDiffScale, revisionsAtMerge, describeRevisions, releaseEligibleForLanding,
  classifyFile, collect, main, parseArgv,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
