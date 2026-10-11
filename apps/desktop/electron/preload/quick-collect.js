/**
 * 快捷采集 preload API
 *
 * 工厂函数：createQuickCollectApi(ipcRenderer)
 *   - ipcRenderer 由 preload/index.js 注入，便于测试 mock
 *   - 暴露为**扁平方法名**（quickCollectRun / quickCollectListPresets / onQuickCollectProgress），
 *     与渲染端桥接层 src/api/quick-collect.js 的 invokeWithFallback 口径一致
 *     （命名空间形态要用 invokeNamespace，本特性没有理由多引入一层）
 *
 * 通道名为字面量：`.github/scripts/check-ipc-bridge.js` 与
 * `electron/tests/ipc-contract.test.js` 都按源码字面量对账，改成变量拼接即静默失配。
 *
 * 返回信封**保持主进程原样**（{ code, data } / { code, message }）：本特性只有两处消费点
 * （面板与 composable），领域码到文案的映射集中在渲染层 locale，故不在这里二次剥壳
 * —— 与 podcast 的 unwrap 不同是**有意**的：它那套剥壳对应的是外部 API 的 ok/err 合同。
 *
 * 访问级别：不在 PUBLIC_METHODS / ADMIN_ONLY_METHODS 名单内 ⇒ 默认 authenticated。
 */

/**
 * @param {Electron.IpcRenderer} ipcRenderer
 * @returns {object} 扁平方法集合
 */
function createQuickCollectApi (ipcRenderer) {
  return {
    quickCollectListPresets: () => ipcRenderer.invoke('quick-collect:list-presets'),
    quickCollectRun: (payload) => ipcRenderer.invoke('quick-collect:run', payload),
    onQuickCollectProgress: (callback) => {
      const listener = (_event, payload) => {
        try {
          callback(payload)
        } catch (_) { /* 订阅者异常不得冒泡到 preload */ }
      }
      ipcRenderer.on('quick-collect:progress', listener)
      return () => {
        try {
          ipcRenderer.removeListener('quick-collect:progress', listener)
        } catch (_) { /* 已销毁的 ipcRenderer 上 removeListener 可能抛错，忽略 */ }
      }
    },
  }
}

module.exports = { createQuickCollectApi }
