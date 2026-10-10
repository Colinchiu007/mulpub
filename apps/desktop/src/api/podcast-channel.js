/**
 * podcast-channel.js — 播客 RSS 频道（小宇宙收录）IPC 桥接层
 *
 * 为什么单独一层：desktop-ui-consistency「IPC 渲染端访问单轨制」要求渲染层
 * （views/components/composables/stores）一律不直接触碰桌面端暴露面，
 * 命名空间形态的通道只能通过 electron-bridge 的 invokeNamespace 走。
 * 计数判据由 .github/scripts/check-frontend-consistency.js 钉 0（只降不升），
 * 所以新增播客相关调用必须加在本文件，不得在 composable 里另开第二处取用点。
 *
 * 为什么每个导出直接写方法名字面量，而不是一个 callPodcastIpc(method, …) 转发：
 * electron/tests/ipc-exposure-contract.test.js 的静态判据是**从调用点抽首参字面量**
 * 与 preload 暴露面对账；method 经辅助函数参数转发就变成「生产侧动态取名」，
 * 那条路径会从账上消失（同文件 C-1 与 src/api/tts-voice-catalog.js 头部注释记录的
 * 是同一个形态）。所以这里 8 个导出各自把字面量写在自己那一行，让每条路径都在账上。
 *
 * 合同（与 apps/desktop/electron/ipc-handlers/podcast.js 的 8 个 handle 一一对应）：
 *   channelGet / channelSave / episodeList / episodeSave / episodeRemove
 *   / feedBuild / feedVerify / endpointList
 * 返回值形状由主进程持有，本层不剥壳、不改写、不补默认值——
 * 错误码到文案的映射只在 usePodcastChannel.js 一份，禁止在此另写。
 *
 * 「不可用」与「调用失败」的区分口径：invokeNamespace 只在「无 API / 命名空间缺失 /
 * 方法不存在」时返回 undefined；handler 自身抛错会原样向上抛。两种情况在界面上
 * 语义不同（前者是环境问题、后者是本轮调用失败），所以这里用 available 标志把
 * 这个区分**显式带出去**，而不是压成一个 undefined 让调用方猜；也不在这里 try/catch
 * 吞异常（与 tts-voice-catalog 的「两种失败同一信封」有意不同，本功能的 PRD §9.1
 * 要求界面能区分「播客模块不可用」与「这一轮没成功」）。
 *
 * 例外只有一类，且它是**环境问题**而不是调用失败：preload 的访问控制
 * （access-control 的 createDynamicAccessApi）在「未登录 / 许可证未激活」时
 * 对每个 podcast 方法**同步 throw** LicensePermissionError —— 本页 8 个方法都不在
 * PUBLIC_METHODS 名单内，所以这是生产环境最高频的前置条件失败。electron-bridge
 * 的 M-14 口径对此早有结论（见 invokeWithFallback：「权限不足必须落进 fallback
 * 语义⋯⋯其余错误照原样抛出」），因此这里把它归进 available:false，界面据此显示
 * 「模块暂不可用」而不是「调用失败，请重试」。
 *
 * ⚠️ 写法不可回退成「把 invokeNamespace 返回的 promise 直接交给 envelope」：invokeNamespace
 * 不是 async 函数，权限错误在**参数求值期**就同步抛出，那时 envelope 的 try 还没进场，
 * catch 永远接不到。所以调用必须包在箭头里（thunk），由 envelope 在 try 内调用它。
 * （这条由 usePodcastChannel-ipc.test.js 的结构锁钉住，注释本身不写该形态的字面量——
 * 本仓有过「判据按文本形态抓取、不剥注释」把示例读成真实代码的事故，见 check-ipc-bridge。）
 */
import { invokeNamespace, isPermissionError } from './electron-bridge'

/** preload 暴露面上的命名空间键名（见 apps/desktop/electron/preload/index.js） */
const NS = 'podcast'

/**
 * 把一次命名空间调用的四种结局收成信封：
 *   方法/命名空间缺失（undefined）→ available:false
 *   权限前置条件（LicensePermissionError）→ available:false（同属环境问题）
 *   正常返回 → available:true + result 原样带出
 *   handler 真抛错 → 原样上抛，本层不吞（调用方据此报 IPC_EXCEPTION）
 */
async function envelope (pending) {
  let result
  try {
    result = await pending()
  } catch (err) {
    if (isPermissionError(err)) return { available: false }
    throw err
  }
  return result === undefined ? { available: false } : { available: true, result }
}

// 刀 1 起频道是复数：这 5 个方法承载频道目录本身。
// 每个导出仍各自写死方法名字面量 —— 见本文件头部「为什么不做成 callPodcastIpc(method, …) 转发」，
// electron/tests/ipc-exposure-contract.test.js 的判据是从调用点抽首参字面量。
export async function channelList () {
  return envelope(() => invokeNamespace(NS, 'channelList'))
}

export async function channelCreate (payload) {
  return envelope(() => invokeNamespace(NS, 'channelCreate', payload))
}

export async function channelRename (payload) {
  return envelope(() => invokeNamespace(NS, 'channelRename', payload))
}

export async function channelSetDefault (payload) {
  return envelope(() => invokeNamespace(NS, 'channelSetDefault', payload))
}

export async function channelMigrateResolve (payload) {
  return envelope(() => invokeNamespace(NS, 'channelMigrateResolve', payload))
}

export async function channelGet (payload) {
  return envelope(() => invokeNamespace(NS, 'channelGet', payload))
}

export async function channelSave (payload) {
  return envelope(() => invokeNamespace(NS, 'channelSave', payload))
}

export async function episodeList (payload) {
  return envelope(() => invokeNamespace(NS, 'episodeList', payload))
}

export async function episodeSave (payload) {
  return envelope(() => invokeNamespace(NS, 'episodeSave', payload))
}

export async function episodeRemove (id) {
  return envelope(() => invokeNamespace(NS, 'episodeRemove', id))
}

export async function feedBuild (payload) {
  return envelope(() => invokeNamespace(NS, 'feedBuild', payload))
}

export async function feedVerify (payload) {
  return envelope(() => invokeNamespace(NS, 'feedVerify', payload))
}

export async function endpointList () {
  return envelope(() => invokeNamespace(NS, 'endpointList'))
}

// 刀 2：托管配置与 feed 覆盖上传。每个导出仍各自写死方法名字面量 —— 见本文件头部说明。
export async function hostingGet () {
  return envelope(() => invokeNamespace(NS, 'hostingGet'))
}

export async function hostingSave (payload) {
  return envelope(() => invokeNamespace(NS, 'hostingSave', payload))
}

export async function hostingCheck () {
  return envelope(() => invokeNamespace(NS, 'hostingCheck'))
}

export async function feedPublish (payload) {
  return envelope(() => invokeNamespace(NS, 'feedPublish', payload))
}

