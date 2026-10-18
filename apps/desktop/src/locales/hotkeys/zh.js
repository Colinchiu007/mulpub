/**
 * hotkeys 命名空间文案（UX-AUDIT-2026-10-17 阶段 1.6）
 * 设置页「快捷键」面板；label.* 与主进程 electron/services/hotkeys.js 的 labelKey 一一对应，
 * 任一侧漂移会让键位表露出键名而不是用途。zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: '快捷键',
    subtitle: '应用级全局快捷键，在任意页面生效；键位由内置定义，暂不支持自定义。',
    colKeys: '按键',
    colAction: '作用',
    loading: '正在读取快捷键…',
    unavailable: '当前环境读不到快捷键列表（可能在浏览器预览中运行，未连接桌面主进程）。',
    retry: '重新读取',
    customizeHint: '如需修改键位，请通过「设置 → 用户反馈」告诉我们。',
    label: {
      publish: '打开发布页',
      newPublish: '新建发布',
      dashboard: '打开数据看板',
      collection: '打开内容采集',
      home: '返回首页',
      accounts: '打开账号管理',
      keywords: '打开关键词监测',
      viral: '打开爆款分析',
      quit: '退出应用',
    },
  }
