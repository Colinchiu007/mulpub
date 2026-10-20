'use strict'
/**
 * enforce-gate 文件/路径门面（forced-update-gate 2026-10-19）。
 *
 * 独立模块的动机：enforce-gate.js 状态机保持纯依赖注入（可测），Electron
 * app/fs 的真实绑定集中在这里——phase1 一行装配，测试无需 mock electron。
 */
const fs = require('fs')
const path = require('path')

const STATE_VERSION = 1

function enforceGateStatePaths (app) {
  const userData = app.getPath('userData')
  return {
    stateFile: path.join(userData, 'enforce-gate-state.json'),
    gateHtmlPath: path.join(__dirname, '..', 'enforce-gate', 'gate.html'),
    preloadPath: path.join(__dirname, '..', 'enforce-gate', 'gate-preload.js'),
  }
}

/** Node fs 门面：tmp+rename 原子写 / 读 / 删（异常向上抛，由状态机层兜底）。 */
function createNodeFileFacades () {
  return {
    readStateFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeStateFileAtomic: (p, state) => {
      const tmp = p + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
      fs.renameSync(tmp, p)
    },
    removeStateFile: (p) => {
      try { fs.unlinkSync(p) } catch (e) {
        if (e && e.code !== 'ENOENT') throw e
      }
    },
  }
}

module.exports = { enforceGateStatePaths, createNodeFileFacades, STATE_VERSION }
