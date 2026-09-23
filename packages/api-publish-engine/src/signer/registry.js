'use strict'

/**
 * 进程内签名注册表（W1 §2）
 *
 * 契约：register(signCommand, implFn) / sign(signCommand, payload) → signature
 * - 未知或未注册的 signCommand 一律 fail-closed（抛错），绝不静默返回空串继续发布。
 * - 合规红线：注册表只保存纯计算函数，不存在任何注入远程 HTTP 客户端（axios/http）
 *   的路径；引擎运行时代码不得再出现第三方签名服务域名或环境变量后门。
 *
 * 默认实例在 signer/index.js 中注册 Tier-A 本地算法；各平台发布链（§4）在装载时
 * 追加注册自己的签名 command。
 */

function createRegistry () {
  const impls = new Map()

  function register (signCommand, implFn) {
    if (typeof signCommand !== 'string' || signCommand.length === 0) {
      throw new Error('signer/registry: signCommand must be a non-empty string')
    }
    if (typeof implFn !== 'function') {
      throw new Error(`signer/registry: impl for "${signCommand}" must be a function`)
    }
    impls.set(signCommand, implFn)
    return signCommand
  }

  function has (signCommand) {
    return impls.has(signCommand)
  }

  function list () {
    return [...impls.keys()].sort()
  }

  function unregister (signCommand) {
    return impls.delete(signCommand)
  }

  async function sign (signCommand, payload) {
    const impl = impls.get(signCommand)
    if (!impl) {
      throw new Error(
        `signer/registry: unknown signCommand "${signCommand}" (fail-closed, refusing to publish)`,
      )
    }
    return impl(payload)
  }

  return { register, sign, has, list, unregister }
}

module.exports = { createRegistry }
