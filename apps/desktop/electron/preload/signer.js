'use strict'
/**
 * 签名页 renderer 桥（W3 task 2.4）
 *
 * 安全边界（design §2.5 / Q17）：
 * - 只暴露白名单通道 signer:invoke / signer:status / signer:prewarm；
 * - 不提供任何 executeJavaScript 原语；
 * - invoke 仅允许 *-browser 签名页 command（主进程 manager 二次白名单，此处仅前缀防呆）；
 * - cookie/登录态从不经 renderer 往返（主进程 bindSignerCookie in-proc 绑定）。
 */
const BROWSER_COMMAND_SUFFIX = '-browser'

function createSignerApi (ipcRenderer) {
  return {
    signerInvoke: async (command, payload) => {
      if (typeof command !== 'string' || !command.endsWith(BROWSER_COMMAND_SUFFIX)) {
        return { code: -2, message: 'signerInvoke: only *-browser signer commands are exposed' }
      }
      return ipcRenderer.invoke('signer:invoke', { command, payload: payload || {} })
    },
    signerStatus: (platform) => ipcRenderer.invoke('signer:status', { platform }),
    signerPrewarm: (platform, sessionKey) => ipcRenderer.invoke('signer:prewarm', { platform, sessionKey }),
  }
}

module.exports = { createSignerApi, BROWSER_COMMAND_SUFFIX }
