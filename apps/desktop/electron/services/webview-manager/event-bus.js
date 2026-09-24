// @ts-check
/**
 * WebviewManager 事件广播模块
 * 管理订阅者集合，向渲染进程广播标签页状态变化
 */
const log = require('../logger')

module.exports = {
  /**
   * 广播事件给所有订阅者
   * @param {string} event
   * @param {Object} data
   */
  _broadcast (event, data) {
    var self = this
    self._subscribers.forEach(function (subscriberId) {
      try {
        if (self.mainWindow && !self.mainWindow.isDestroyed()) {
          self.mainWindow.webContents.send('page-manager:' + event, {
            subscriberId: subscriberId,
            data: data
          })
        }
      } catch (e) { /* ignore */ }
    })
  },

  /**
   * 广播导航事件
   * @param {string} tabId
   */
  _broadcastNav (tabId) {
    var self = this
    var state = self._tabStates.get(tabId)
    if (!state) return
    self._broadcast('navigation-changed', {
      tabId: tabId,
      url: state.url,
      title: state.title,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      homeShell: !!state.homeShell,
      spaRoute: state.spaRoute || ''
    })
  }
}
