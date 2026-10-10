/**
 * 播客 RSS 频道 preload API
 *
 * 工厂函数：createPodcastApi(ipcRenderer)
 *   - ipcRenderer 由 preload/index.js 注入，便于测试 mock
 *
 * 暴露到 window.electronAPI.podcast（嵌套对象）。
 *
 * ⛔ 本文件是 envelope 的**唯一剥壳点**（AGENTS.md「跨包响应信封只在一处剥」的同族纪律）：
 * 主进程 podcast handler 一律返回 { code:0, data:{…} } / { code, message, issues }，
 * 而渲染层 composable 合同是 { ok:true, …data } / { ok:false, code, message, issues }。
 * 两种形状只能在这里转换一次：渲染层再判 code、或 handler 直接回 ok，都会出现
 * 「同一件事两份判据」，届时哪一层错无法归因（并行开发时最容易各写各的）。
 *
 * 访问级别：不在 PUBLIC_METHODS 名单内 ⇒ 默认 authenticated（业务面）。
 * 未登录调用被 access-control **同步**抛出 LicensePermissionError（本文件的包装函数
 * 是普通函数，不是 async）。该错误不在这里消化：渲染侧桥接层
 * src/api/podcast-channel.js 按 electron-bridge 的 M-14 口径把权限类前置条件归进
 * 「环境不可用」，用户最终看到的是 PODCAST_IPC_UNAVAILABLE（模块暂不可用），
 * 而不是 PODCAST_IPC_EXCEPTION（调用失败，请重试）。
 */

/** renderer 侧自有错误码：与 composable usePodcastChannel.js 的常量逐字一致 */
const IPC_EXCEPTION = 'PODCAST_IPC_EXCEPTION';

/**
 * 把一次 invoke 的主进程 envelope 转成渲染层合同。
 * 返回值缺席 / 非对象 / code 非 0 三种情况都不得伪装成成功——那会让界面显示「已保存」而库里没动。
 */
function unwrap(invoke) {
  return async (...args) => {
    const res = await invoke(...args);
    if (res == null || typeof res !== 'object') {
      return { ok: false, code: IPC_EXCEPTION };
    }
    if (res.code === 0) {
      const data = res.data && typeof res.data === 'object' ? res.data : {};
      return { ok: true, ...data };
    }
    return {
      ok: false,
      code: res.code == null ? IPC_EXCEPTION : res.code,
      subCode: res.subCode == null ? '' : res.subCode,
      message: typeof res.message === 'string' ? res.message : '',
      issues: Array.isArray(res.issues) ? res.issues : [],
    };
  };
}

/**
 * 创建播客频道 API 对象（嵌套到 electronAPI.podcast）
 * @param {Electron.IpcRenderer} ipcRenderer
 * @returns {{ podcast: object }}
 */
function createPodcastApi(ipcRenderer) {
  return {
    podcast: {
      channelList: unwrap(() => ipcRenderer.invoke('podcast:channel:list')),
      channelCreate: unwrap((payload) => ipcRenderer.invoke('podcast:channel:create', payload)),
      channelRename: unwrap((payload) => ipcRenderer.invoke('podcast:channel:rename', payload)),
      channelSetDefault: unwrap((payload) => ipcRenderer.invoke('podcast:channel:setDefault', payload)),
      channelMigrateResolve: unwrap((payload) => ipcRenderer.invoke('podcast:channel:migrate:resolve', payload)),
      hostingGet: unwrap(() => ipcRenderer.invoke('podcast:hosting:get')),
      hostingSave: unwrap((payload) => ipcRenderer.invoke('podcast:hosting:save', payload)),
      hostingCheck: unwrap(() => ipcRenderer.invoke('podcast:hosting:check')),
      feedPublish: unwrap((payload) => ipcRenderer.invoke('podcast:feed:publish', payload)),
      channelGet: unwrap((...a) => ipcRenderer.invoke('podcast:channel:get', ...a)),
      channelSave: unwrap((payload) => ipcRenderer.invoke('podcast:channel:save', payload)),
      episodeList: unwrap(() => ipcRenderer.invoke('podcast:episode:list')),
      episodeSave: unwrap((payload) => ipcRenderer.invoke('podcast:episode:save', payload)),
      episodeRemove: unwrap((id) => ipcRenderer.invoke('podcast:episode:remove', id)),
      feedBuild: unwrap(() => ipcRenderer.invoke('podcast:feed:build')),
      feedVerify: unwrap(() => ipcRenderer.invoke('podcast:feed:verify')),
      endpointList: unwrap(() => ipcRenderer.invoke('podcast:endpoints:list')),
    },
  };
}

module.exports = { createPodcastApi, unwrap, IPC_EXCEPTION };
