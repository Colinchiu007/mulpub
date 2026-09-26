/**
 * 账号云镜像同步文案（PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10.4）
 *
 * 从 locales/zh.js 的 accountsPage 命名空间拆出，由装配文件 locales/zh.js import 后展开回原位置，
 * 键名与拆出前完全一致。zh/en 必须成对修改：check-locale-sync.js --pair-base 已把
 * locales/ 目录下每个 zh.js 与同名目录的 en.js 配成一个成对口径。
 */
export default {
  // ─── 账号云镜像同步（PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §10.4，与 en.js 行序一致）───
  // 错误文案键落位说明：PRD 写的是 accountsPage.cloudSync.err.<code>，但 vue-i18n 只按对象路径
  // 解析——'cloudSync' 不能既是按钮文案叶子又是 err 的父对象（已实测 flat 点分键不会被命中）。
  // 因此沿用同命名空间 accountCheckStatus 的「错误码→文案」嵌套表先例，落为 cloudSyncErr.<分组名>
  // （分组而非逐码：见 AccountCloudSyncDialog.vue 的 ERROR_CODE_GROUPS 与 §7.5 码表）。
  cloudSync: '同步云端',
  cloudSyncBusy: '同步中…',
  cloudSyncTitle: '同步到云端',
  cloudSyncAria: '同步账号到云端',
  cloudDigestLoading: '正在获取云端账号信息…',
  cloudDigestTotal: '云端现有 {total} 个账号',
  cloudDigestEmpty: '云端还没有账号，本次将首次上传',
  cloudDigestLocal: '本机 {local} 个账号将参与同步',
  cloudDigestTombstone: '其中 {count} 个已删除账号不会被恢复',
  cloudDigestPrivacy: '登录凭证将加密后上传；可在需要时一键清除云端数据',
  cloudDigestFailed: '无法获取云端账号信息，请检查网络后重试',
  cloudDigestRetry: '重试',
  cloudSyncProgress: '同步中 {done}/{total}',
  cloudSyncElapsed: '已用时 {seconds} 秒',
  cloudSyncDone: (ctx) => {
    const parts = []
    if (Number(ctx.named('created')) > 0) parts.push('新增 ' + ctx.named('created'))
    if (Number(ctx.named('updated')) > 0) parts.push('更新 ' + ctx.named('updated'))
    if (Number(ctx.named('restored')) > 0) parts.push('恢复 ' + ctx.named('restored'))
    return '同步完成' + (parts.length ? '：' + parts.join('，') : '')
  },
  cloudSyncPartial: '同步部分完成：{ok} 个成功，{fail} 个失败',
  cloudSyncAllFailed: '同步失败：{fail} 个账号未上传',
  cloudOutcomeCreated: '已上传',
  cloudOutcomeUpdated: '已更新',
  cloudOutcomeUnchanged: '已是最新',
  cloudOutcomeRestored: '已恢复到本机',
  cloudOutcomeSkippedTombstone: '已跳过（云端标记删除）',
  cloudOutcomeConflictLocal: '冲突：保留本机登录状态',
  cloudOutcomeConflictCloud: '冲突：采用云端登录状态',
  cloudOutcomeInvalidCredential: '凭证已失效，需重新登录',
  cloudOutcomeUidUnavailable: '未能确认账号身份，已跳过',
  cloudOutcomeFailed: '失败',
  cloudSyncBackground: '后台继续',
  cloudSyncStop: '停止同步',
  cloudSyncStopping: '正在停止…',
  cloudSyncStopped: '已停止：剩余账号未同步',
  cloudSyncClose: '完成',
  cloudSyncNoAccounts: '暂无可同步的账号',
  cloudSyncGateBusy: '登录检测进行中，请稍后再同步',
  cloudDisconnect: '断开云端',
  cloudDisconnectConfirm: '将清除云端全部 {count} 个账号镜像，本机账号与登录状态不受影响。是否继续？',
  cloudDisconnectSuccess: '云端账号已清除',
  cloudDisconnectFailed: '云端未完全清除：{deleted} 已删，{remaining} 仍在，请重试',
  cloudSyncErr: {
    unauthorized: '请先登录后再同步',
    serviceUnavailable: '云端同步服务暂不可用，请稍后再试',
    kmsUnavailable: '云端加密服务未就绪，本次未上传任何凭证',
    credentialTooLarge: '该账号登录数据过大，无法上传',
    budgetExceeded: '同步超时，未完成',
    inProgress: '已有一次同步在进行中',
    // 以下按「语义分组」而非逐码建键（原因见 AccountCloudSyncDialog.vue 的码表注释）
    invalidData: '账号信息格式不正确，未上传',
    invalidCredential: '登录数据格式不正确，未上传',
    tooMany: '本次提交账号过多，未上传',
    // 只用于同步过程区里的断开类失败行；断开云端按钮自身的失败提示仍是上面的 cloudDisconnectFailed（含计数）
    disconnectPartial: '云端未完全清除，请重试',
    // 未登记码的兜底句：失败行的原因栏不允许空白
    cloudFailed: '云端未接受该账号，请稍后重试',
  },
}
