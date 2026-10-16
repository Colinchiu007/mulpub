// @ts-check
/**
 * sidecar-asset-fetch.js — 可复用「下载 + 校验」单一实现（PR-2 §7.1）
 *
 * 为什么必须有这个模块：camofox wrapper 的 postinstall **不做任何 sha256 校验**
 * （lib/camoufox-download.js 的 checkAsset 只匹配资源名前缀，且 postinstall 的
 * fail() 走 process.exit(0) —— 下载失败安装照样"成功"）。故凡是要拉 sidecar 构件的
 * 路径（fetch-bin 手动拉、sidecar-host 自动拉）都必须自带校验。
 *
 * 单一实现的理由：fetch-bin 与 sidecar-host.start() 都要"下载后校验"。抄两份必然
 * 漂移，漂移形状是「fetch-bin 拉的构件 sidecar-host 拒收」或反之——那种缺陷在
 * 用户侧表现为"明明手动拉过却仍说缺文件"，极难归因。
 *
 * 四条不变量：
 *  1. 校验不符 ⇒ **先删掉已落盘载荷**再抛错（不把「校验不过的字节」留在磁盘上）
 *  2. 目标已存在且校验通过 ⇒ 跳过下载（幂等；fetch-bin 可重复跑）
 *  3. 目标已存在但校验不符 ⇒ 重新拉取（自愈：上次拉到一半 / 被截断 / 被篡改）
 *  4. 网络失败 ⇒ 原样抛出并清理，**不冒充成功**（与 camofox 的 exit(0) 相反）
 */
const fs = require('fs')
const path = require('path')

/**
 * 下载并校验一个 sidecar 构件。
 * @param {object} spec
 * @param {string} spec.url 下载地址
 * @param {string} spec.destPath 目标文件绝对路径（受控路径）
 * @param {string} spec.expectedSha256 期望 sha256（hex，64 位）——由调用方从
 *   sidecar-lock.json 的官方取值传入，本函数不信任任何环境/默认值
 * @param {object} deps 注入依赖（测试全假；生产由调用方传真实实现）
 * @param {(url: string, dest: string) => Promise<void>} deps.fetchFile
 * @param {(p: string) => Promise<string>} deps.sha256File
 * @param {(p: string) => void} [deps.removeFile]
 * @returns {Promise<{ downloaded: boolean, path: string, sha256: string }>}
 */
async function fetchAndVerifyAsset (spec, deps) {
  const { url, destPath, expectedSha256 } = spec
  const { fetchFile, sha256File } = deps
  const removeFile = deps.removeFile || ((p) => { try { fs.rmSync(p, { force: true }) } catch (_) { /* ignore */ } })

  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('expectedSha256 必须是 64 位十六进制，实得 ' + JSON.stringify(expectedSha256))
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true })

  // —— 不变量 2：已存在且校验通过 ⇒ 跳过下载（但仍校验一次，防"上次拉到一半"）——
  if (fs.existsSync(destPath)) {
    const existing = await sha256File(destPath)
    if (existing === expectedSha256) {
      return { downloaded: false, path: destPath, sha256: existing }
    }
    // —— 不变量 3：已存在但校验不符 ⇒ 重新拉取自愈 ——
  }

  // 下载到**同目录临时文件**：避免半成品落在 destPath 上被误判为"已存在"
  const tmpPath = destPath + '.part'
  try {
    await fetchFile(url, tmpPath)
  } catch (e) {
    // —— 不变量 4：网络失败 ⇒ 清理并原样抛出，不冒充成功 ——
    removeFile(tmpPath)
    throw e
  }

  const got = await sha256File(tmpPath)
  if (got !== expectedSha256) {
    // —— 不变量 1：校验不符 ⇒ 先删掉已落盘载荷再抛错 ——
    removeFile(tmpPath)
    throw new Error('构件 sha256 校验不符，已拒绝落地并删除: expected=' + expectedSha256 + ' got=' + got)
  }

  fs.renameSync(tmpPath, destPath)
  return { downloaded: true, path: destPath, sha256: got }
}

module.exports = { fetchAndVerifyAsset }
