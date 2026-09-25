'use strict'
/**
 * 签名页基建 provider 槽（W3 design §1/§2）
 *
 * 引擎侧唯一入口：bridge 函数由桌面装配层注入（electron main IPC signer:invoke）。
 * 本模块不引入任何 HTTP 客户端——bridge 是唯一外发通道，且由调用方控制。
 *
 * 契约：
 * - 未注入 bridge → fail-closed 抛「签名页未就绪」
 * - 仅 verified 命令可求签
 * - bridge 返回值必须是纯字符串（非对象/null/undefined）
 * - 限流 ≤3 次异常/platform → degraded → 后续拒绝
 * - payload JSON 序列化后尺寸上限 1MB
 */

const MAX_PAYLOAD_SIZE = 1024 * 1024 // 1MB
const MAX_FAILS_BEFORE_DEGRADED = 3

function createBrowserPageProvider () {
  /** @type {((signCommand: string, payload: object) => Promise<string>)|null} */
  let bridge = null

  /** command → platform 映射 */
  const commandPlatform = new Map()
  /** 已注册命令集合 */
  const registeredCommands = new Set()
  /** 已验证命令集合 */
  const verifiedCommands = new Set()

  /** platform → { failCount, degraded } */
  const platformState = new Map()

  function getOrCreateState (platform) {
    if (!platformState.has(platform)) {
      platformState.set(platform, { failCount: 0, degraded: false })
    }
    return platformState.get(platform)
  }

  /**
   * 注入 bridge 函数（桌面装配层在 app ready 后调用）
   * @param {(signCommand: string, payload: object) => Promise<string>} fn
   */
  function setBridge (fn) {
    if (typeof fn !== 'function') {
      throw new Error('browser-page-provider: setBridge requires a function')
    }
    bridge = fn
  }

  /**
   * 注册命令白名单（指定归属平台）
   * @param {string[]} commands - signCommand 列表
   * @param {string} platform - 平台标识（如 'kuaishou'）
   */
  function registerCommands (commands, platform) {
    if (!Array.isArray(commands) || !platform) {
      throw new Error('browser-page-provider: registerCommands(commands[], platform)')
    }
    for (const cmd of commands) {
      registeredCommands.add(cmd)
      commandPlatform.set(cmd, platform)
    }
  }

  /**
   * 标记命令为已验证（拦截法双验证通过后由 electron 侧回调）
   * @param {string} command
   */
  function verify (command) {
    if (!registeredCommands.has(command)) {
      throw new Error(`browser-page-provider: cannot verify unregistered command "${command}"`)
    }
    verifiedCommands.add(command)
  }

  /**
   * 标记命令为未验证（抽取失败/比对不一致时回退）
   * @param {string} command
   */
  function unverify (command) {
    verifiedCommands.delete(command)
  }

  /**
   * 求签主入口
   * @param {string} signCommand
   * @param {object} payload
   * @returns {Promise<string>} 签名字符串
   */
  async function sign (signCommand, payload) {
    // 1. bridge 未注入 → fail-closed
    if (!bridge) {
      throw new Error('\u7b7e\u540d\u9875\u672a\u5c31\u7edc\uff08browser-page-provider: bridge not injected\uff09')
    }

    // 2. 命令未注册 → 白名单拒绝
    if (!registeredCommands.has(signCommand)) {
      throw new Error(`browser-page-provider: unknown command "${signCommand}" (not registered)`)
    }

    const platform = commandPlatform.get(signCommand)
    const state = getOrCreateState(platform)

    // 3. 已降级 → 直接拒绝
    if (state.degraded) {
      throw new Error(`browser-page-provider: platform "${platform}" \u5df2\u964d\u7ea7 (degraded), \u8bf7\u7b49\u5f85\u81ea\u6108\u6216\u624b\u52a8 resetState`)
    }

    // 4. 未验证 → 拒绝
    if (!verifiedCommands.has(signCommand)) {
      throw new Error(`browser-page-provider: command "${signCommand}" \u672a\u9a8c\u8bc1 (unverified)`)
    }

    // 5. payload 尺寸校验
    const serialized = JSON.stringify(payload || {})
    if (serialized.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`browser-page-provider: payload \u5c3a\u5bf8\u8d85\u8fc7\u4e0a\u9650 (size=${serialized.length}, limit=${MAX_PAYLOAD_SIZE})`)
    }

    // 6. 调用 bridge
    try {
      const result = await bridge(signCommand, payload)
      // 返回值必须是纯字符串
      if (typeof result !== 'string' || result.length === 0) {
        throw new Error('browser-page-provider: bridge \u8fd4\u56de\u503c\u5fc5\u987b\u662f\u975e\u7a7a\u5b57\u7b26\u4e32 (got ' + typeof result + ')')
      }
      // 成功则重置失败计数
      state.failCount = 0
      return result
    } catch (err) {
      // 如果是本模块抛出的校验错误（非 bridge 调用失败），直接透传不计入限流
      if (err.message.startsWith('browser-page-provider:')) {
        throw err
      }
      // bridge 调用异常 → 计入限流
      state.failCount++
      if (state.failCount >= MAX_FAILS_BEFORE_DEGRADED) {
        state.degraded = true
      }
      throw err
    }
  }

  /**
   * 查询平台状态
   * @param {string} platform
   * @returns {{ degraded: boolean, failCount: number }}
   */
  function status (platform) {
    const st = getOrCreateState(platform)
    return { degraded: st.degraded, failCount: st.failCount }
  }

  /**
   * 重置平台状态（自愈/reload 后调用）
   * @param {string} platform
   */
  function resetState (platform) {
    platformState.delete(platform)
  }

  return { setBridge, registerCommands, verify, unverify, sign, status, resetState }
}

module.exports = { createBrowserPageProvider }
