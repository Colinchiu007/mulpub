/**
 * creator.js — 博主监控的 preload 桥
 *
 * 与既有 aggregation 桥同构：只做通道转发，不含业务判断。
 *
 * ⚠ 两处都必须是字面量：
 *   ① 每个转发都要写成 ipcRenderer 加 invoke 加「引号包住的通道名」的完整形状
 *      —— check-ipc-bridge.js 的 RE2 正则要求**标识符以 ipcRenderer 开头**，
 *      且通道名必须是引号字面量；
 *   ② 形参名就叫 ipcRenderer —— 换成 renderer 会提不到通道，
 *      检查器会逐条报「Handler 已注册但 preload 未暴露」。
 *   改成把通道名存进变量再传进去的间接调用同样会被漏掉。
 *   可测性靠形参注入解决（调用方传 ipcRenderer），不靠间接调用。
 *
 * ⚠ 这段说明**刻意不写出可被提取的通道样例**：ipc-contract.test.js 扫的是本文件
 *   全文文本，注释里出现的「invoke 加引号字面量」形状会被当成真通道提出来，
 *   然后因主进程没有同名 handler 而红。踩过一次：示例写成 creator:xxx 就红了。
 */
const { ipcRenderer } = require('electron')

function createCreatorApi (ipcRenderer) {
  return {
    creatorList: () => ipcRenderer.invoke('creator:list'),
    creatorFollow: (payload) => ipcRenderer.invoke('creator:follow', payload),
    creatorUnfollow: (payload) => ipcRenderer.invoke('creator:unfollow', payload),
    creatorToggle: (payload) => ipcRenderer.invoke('creator:toggle', payload),
    creatorCheckNow: (payload) => ipcRenderer.invoke('creator:check-now', payload),
    creatorDiscoveries: (payload) => ipcRenderer.invoke('creator:discoveries', payload),
    creatorCollect: (payload) => ipcRenderer.invoke('creator:collect', payload),
    creatorCollectOne: (payload) => ipcRenderer.invoke('creator:collect-one', payload),
    creatorSkipOne: (payload) => ipcRenderer.invoke('creator:skip-one', payload),
    creatorSendToWriter: (payload) => ipcRenderer.invoke('creator:send-to-writer', payload),
    creatorPendingTotal: () => ipcRenderer.invoke('creator:pending-total'),
    // 凭证（读方向永不回传明文；写方向是全仓唯一接受明文的入口）
    creatorCredentialStatus: () => ipcRenderer.invoke('creator:credential-status'),
    creatorCredentialSet: (payload) => ipcRenderer.invoke('creator:credential-set', payload),
    creatorCredentialClear: () => ipcRenderer.invoke('creator:credential-clear'),
    // 依赖状态：发现腿（是否接线）与正文腿（字幕可选依赖）分开报，UI 据此只对阻塞项禁功能
    creatorDependencyStatus: () => ipcRenderer.invoke('creator:dependency-status'),
  }
}

module.exports = { createCreatorApi }