/**
 * 图文卡片分页渲染 preload API
 *
 * 工厂函数：createCardsApi(ipcRenderer)
 *   - ipcRenderer 由 preload/index.js 注入，便于测试 mock
 *   - 暴露为**扁平方法名**（cardsRender），与渲染端桥接层 invokeWithFallback 口径一致
 *     （命名空间形态要用 invokeNamespace，本特性没有理由多引入一层）
 *
 * 通道名为字面量：`.github/scripts/check-ipc-bridge.js` 与
 * `electron/tests/ipc-contract.test.js` 都按源码字面量对账，改成变量拼接即静默失配。
 *
 * 返回信封**保持主进程原样**（{ code, data } / { code, message }）：领域码到文案的映射
 * 集中在渲染层 locale，故不在这里二次剥壳 —— 与 podcast 的 unwrap 不同是**有意**的。
 *
 * 访问级别：不在 PUBLIC_METHODS / ADMIN_ONLY_METHODS 名单内 ⇒ 默认 authenticated。
 *
 * ⚠️ 调用方必须传**纯 JSON**：Vue ref/reactive 是 Proxy，直接经 invoke 传会报
 * "An object could not be cloned"。渲染端从 ref 取出的对象一律
 * `JSON.parse(JSON.stringify(obj))` 脱壳后再传。
 */

/**
 * @param {Electron.IpcRenderer} ipcRenderer
 * @returns {object} 扁平方法集合
 */
function createCardsApi (ipcRenderer) {
  return {
    /**
     * 分页渲染：入参 { pages: string[][], widthPx?, heightPx? }，
     * 成功返回 { code: 0, data: [png 路径...] }（路径数 === pages 长度）。
     *
     * ★ 失败纪律由主进程保证：任一步失败即返回 { code, message }，
     *   **不返回部分产物** —— 少一页比全失败更危险（用户会以为发全了）。
     */
    cardsRender: (payload) => ipcRenderer.invoke('render:cards', payload),
  }
}

module.exports = { createCardsApi }
