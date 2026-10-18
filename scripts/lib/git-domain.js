'use strict';
/**
 * git-domain.js — 「该不该被量」的唯一判据：扫描域取自 git，而不是磁盘。
 *
 * 域 = 被跟踪文件（`git ls-files`）∪ 未被 .gitignore 排除的未跟踪文件 —— 即 `git status` 的口径，也正是 CI 检出的口径。
 * 术语（QM-6 前端轴 I4）：本模块与其锁统一以「被跟踪」为主称谓；本仓既有文档里同概念还写作「受管 / 在索引里 / 索引内」，指的是同一件事。
 *
 * 为什么要有这个共享模块：同一句话在两个门禁里各写一份时，两份必然漂移（本仓反复出现的"单一实现"议题）。
 * `check-max-lines`（#3876）与 `check-debt-budget`（本次）都要按域过滤，实现只留这一份，
 * 并由 `scripts/lib/git-domain.test.js` 逐条锁语义；两个消费者各自的集成锁只测"过滤有没有生效"。
 *
 * 六条语义（QM-6 后端轴 I5：语义编号与用例编号**不是同一套**，映射如实写在这里，改任何一条都要同时改对应锁）：
 *   语义 ①→用例 ②/⑧；②→③；③→⑤/⑥；④→④；⑤→①/⑨/⑪；⑥→⑦。用例 ⑩ 不属六条语义，
 *   它是「消费者套件必须整份真的跑了」的夹具完整性锁（防 import 期 process.exit 造成的文件级假绿）。
 *  ① 不退回磁盘全量：#3782（bundle-untrack）之后构建产物只在磁盘存在且被忽略，
 *     按磁盘扫就成了「本机跑过 build:preload 就红、CI 永远看不见」—— 两个域比一份账；
 *  ② 不收窄成「只看索引」：未提交但未被忽略的新文件仍是新增债，必须可见；
 *  ③ 取不到读数（非工作树 / git 缺失 / 空集合）一律抛错，由调用方转独立退出码出声，
 *     与「发现违规」分开 —— 把工具的失明读成结论是本仓反复出现的同型错误；
 *  ④ 并集不是 check-ignore：被跟踪但同时命中 .gitignore 的文件（历史上 `git add -f` 过的产物）
 *     **仍在域内** —— 「被跟踪就该被量」。改成"只取非忽略项"会静默停止测量这类文件，比假红更糟；
 *  ⑤ 集合里的路径一律**相对 root**（`git ls-files` 按 cwd 输出）、正斜杠形态；
 *     因此 root 只能指向「一个仓库根」，指到仓库子目录会让坐标系整体错位；
 *  ⑥ 机器态会改域：global/system 档里的 `core.excludesFile` 能把文件从 `--exclude-standard` 里藏掉。
 *     判据本体**按调用方的 git 环境如实取域**（不替调用方改配置）—— 因为这条不变量是「域 == git status
 *     口径」，而 git status 本身就吃机器态。为此 env 是**显式入参**（默认 process.env）：
 *     没有这个入口，"实现屏蔽了机器态"这类断言根本无法验证（实测：把 env 强制写成 process.env 的变异
 *     曾经 0 红 —— 见 M11），有了它才能做"带 system 档 vs 置 NOSYSTEM"的两档 A/B。
 *
 * 用法：const { gitDomain } = require('<path>/scripts/lib/git-domain');
 *      const domain = gitDomain(repoRoot);   // Set<string>，相对 repoRoot
 */

const { spawnSync } = require('node:child_process');

const MAX_BUFFER = 64 * 1024 * 1024;
const SAME_WIN = process.platform === 'win32';
function normPath(p) {
  let s = p;
  try { s = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); } catch (_) { /* 取不到真实路径时退回 resolve，比对仍按大小写折叠 */ }
  s = require('node:path').resolve(s).replace(/\\/g, '/');
  return SAME_WIN ? s.toLowerCase() : s;
}
/** root 必须是 git 自己的 toplevel（linked worktree 的 toplevel 就是它自己，因此换 worktree 仍然通过）。 */
function assertRepoRoot(rootDir, env) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: rootDir, encoding: 'utf8', maxBuffer: MAX_BUFFER, env });
  if (r.error) throw new Error('无法从 git 取得扫描域：git 不可执行（' + r.error.message + '）');
  if (r.status !== 0) {
    throw new Error('无法从 git 取得扫描域：' + rootDir + ' 不是 git 工作树（git rev-parse --show-toplevel 返回 rc=' + r.status
      + ' ' + String(r.stderr || '').trim() + '）');
  }
  const top = String(r.stdout || '').trim();
  if (!top) throw new Error('无法从 git 取得扫描域：git rev-parse --show-toplevel 返回空串（读不到 toplevel 不等同于"通过"）');
  if (normPath(top) !== normPath(rootDir)) {
    throw new Error('无法从 git 取得扫描域：root 必须是仓库根，传入 ' + rootDir + ' 的 toplevel 是 ' + top
      + ' —— 指到子目录会让 ls-files 的相对路径与账本键坐标系错位，判定会变成"全零通过"');
  }
} // 本仓域 ≈ 1 万条，实测远小于 1MB；留足量避免静默截断

/**
 * @param {string} rootDir 仓库根绝对路径（必传 —— 缺参时"按脚本所在目录降级"会让两个消费者量到两棵树）
 * @returns {Set<string>} 域内文件路径（相对 rootDir，正斜杠）
 * @throws {Error} git 不可执行 / 非工作树 / root 不是仓库根（指到子目录）/ 空集合
 */
function gitDomain(rootDir, opts) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('gitDomain 需要显式传入仓库根路径（root 必传），拒绝按脚本所在目录降级');
  }
  const env = (opts && opts.env) || process.env;
  // root 必须是**仓库根**：`git ls-files` 按 cwd 输出相对路径，指到子目录时域与账本键
  // 不在同一坐标系，判定会"全零通过"（QM-6 后端轴 W1 实测：--root scripts ⇒ domain=217、
  // filesOver500=0、rc=0）。这条检查放共享实现里，两个消费者一起收口。
  assertRepoRoot(rootDir, env);
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', maxBuffer: MAX_BUFFER, env });
    if (r.error) throw new Error('无法从 git 取得扫描域：git 不可执行（' + r.error.message + '）');
    if (r.status !== 0) {
      throw new Error('无法从 git 取得扫描域：git ' + args.join(' ') + ' 在 ' + rootDir
        + ' 返回 rc=' + r.status + ' ' + String(r.stderr || '').trim());
    }
    return String(r.stdout || '').split('\0').filter(Boolean);
  };
  const set = new Set(run(['ls-files', '-z']));
  // ls-files 没有 -u/<mode>（那是 status/add 的旗标，误用会 rc=129）；默认不折叠目录，
  // 只要不加 --directory，输出即逐文件 —— 与探针用的 `status -uall` 同口径。
  for (const p of run(['ls-files', '-z', '--others', '--exclude-standard'])) set.add(p);
  if (set.size === 0) {
    throw new Error('无法从 git 取得扫描域：git 报告 0 个文件（空域不等于「没有债」，拒绝据此出结论）');
  }
  return set;
}

module.exports = { gitDomain };
