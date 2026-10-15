/**
 * QM-1 启动验证的子进程环境纪律（fix-qm1-electron-run-as-node，2026-10-15）。
 *
 * 背景（真机实测，非推测）：
 *   `ELECTRON_RUN_AS_NODE=1` 会让**任何** Electron 可执行文件以「纯 Node」模式启动 ——
 *   主进程拿到的 `require('electron')` 不再是 API 而是个路径字符串，进程随即退出。
 *   表现是 **rc=0、stdout 空、stderr 空、不建窗口、不建 userData**。
 *
 *   本机 DSH 会话环境默认带这个变量（它是宿主为「用 Electron 二进制跑 Node 脚本」而设的），
 *   于是从这类 shell 里跑 QM-1 启动验证，打包产物会「静默退出」。
 *   对只看 stderr 是否为空的三层判据来说，这与「启动干净、无输出」**完全同形** ⇒ 假绿。
 *
 * 决策：把「剔除该变量」做成机械动作，而不是写在文档里靠临场自觉
 *   （本仓 R0 的教训原话：写进记忆、文档与提交信息都没能阻止第 5 次，因为依赖临场自觉）。
 *   同时**不静默**：父环境若带该变量，必须出声告警，让判据的读者知道这次运行曾被它威胁过。
 */

/** Electron 以 Node 模式启动的开关；出现即意味着子进程不会真的成为 GUI 应用。 */
const ELECTRON_RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

/**
 * 构造给被测 Electron 应用的子进程 env：剔除 `ELECTRON_RUN_AS_NODE`。
 * 纯函数，不改动入参（调用方常常直接传 `process.env`，就地改会污染整条进程链）。
 * @param {Record<string, string|undefined>} parentEnv
 * @returns {Record<string, string|undefined>}
 */
function buildChildEnv (parentEnv) {
  const env = { ...(parentEnv || {}) }
  delete env[ELECTRON_RUN_AS_NODE]
  return env
}

/**
 * 父环境是否带着那个变量。带着 ⇒ 返回一句可打印的告警；否则返回 null。
 * 之所以要「出声」而不是静默剔除：静默剔除会让「本机环境一直有问题」这件事
 * 永远不被知道，而它同时会影响**手工**启动验证与其它工具链。
 * @param {Record<string, string|undefined>} parentEnv
 * @returns {string|null}
 */
function envDefectNotice (parentEnv) {
  const v = (parentEnv || {})[ELECTRON_RUN_AS_NODE]
  if (v === undefined || v === '') return null
  return `父环境带着 ${ELECTRON_RUN_AS_NODE}=${v} —— 它会让孩子进程以纯 Node 模式启动并`
    + '静默退出（rc=0、stdout/stderr 全空），对「只看 stderr」的判据同形于「启动干净」⇒ 假绿。'
    + ' 已在子进程 env 中剔除该变量；本次运行不再受它影响。'
}

module.exports = { ELECTRON_RUN_AS_NODE, buildChildEnv, envDefectNotice }
