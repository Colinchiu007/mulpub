import {
  accountCheckLogin,
  accountDelete,
  accountGetProxy,
  accountSetProxy,
  authClose,
  authCompleteLogin,
  authOpenLogin,
  authOpenQrCodeLogin,
  authQrCodeClose,
} from '@/api/publisher'

export function useAccountActions() {
  async function openLogin(mode, platform, accountId) {
    if (!platform) throw new Error('平台不能为空')
    if (mode === 'browser') return authOpenLogin(platform, accountId)
    if (mode === 'qrcode') return authOpenQrCodeLogin(platform)
    throw new Error('不支持的登录方式')
  }

  async function closeLogin(mode) {
    if (mode === 'qrcode') return authQrCodeClose()
    return authClose()
  }

  async function completeLogin(mode) {
    if (mode === 'qrcode') throw new Error('扫码登录会自动完成，无需手动确认')
    if (mode !== 'browser') throw new Error('没有正在进行的网页登录')
    return authCompleteLogin()
  }

  async function checkLogin(account) {
    if (!account?.platform || !account?.id) throw new Error('账号信息不完整')
    return accountCheckLogin(account.platform, account.id)
  }

  async function remove(accountId) {
    if (!accountId) throw new Error('账号 ID 不能为空')
    return accountDelete(accountId)
  }

  async function setProxy(account, proxy) {
    if (!account?.id || !account?.platform) throw new Error('账号信息不完整')
    return accountSetProxy(account.id, account.platform, proxy)
  }

  /**
   * 按需读取账号当前的代理状态（打开代理设置弹窗时调用）。
   *
   * 列表接口不再返回 proxy，所以这里是渲染端**唯一**能拿到"当前代理"的入口。
   * 读的是掩码后的公开态（hostMasked / port / type / hasAuthentication），
   * username/password 永不外传。
   */
  async function getProxy(account) {
    const accountId = account?.id || account?.accountId || account?.account_id
    if (!accountId) throw new Error('账号信息不完整')
    return accountGetProxy(accountId, account?.platform)
  }

  return { openLogin, completeLogin, closeLogin, checkLogin, remove, setProxy, getProxy }
}
