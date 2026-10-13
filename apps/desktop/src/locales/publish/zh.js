/**
 * publish 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/zh.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: '标题',
    content: '内容',
    platform: '平台',
    tags: '标签',
    publishBtn: '发布',
    saveDraft: '保存草稿',
    publishing: '发布中...',
    success: '发布成功',
    failed: '发布失败',
    failureDraftSaved: '发布失败：内容已自动保存到草稿箱，可在草稿箱中恢复后重试',
    api: {
      modeApi: 'API 直连',
      modeDom: 'RPA 浏览器',
      modeFallback: '降级发布',
      modeApiHint: '通过平台官方 HTTP API 直连发布',
      modeDomHint: '通过隐形浏览器自动化发布',
      modeFallbackHint: 'API 发布不可用，已自动降级为浏览器发布',
    },
    riskHold: {

      suspended: '检测到风控，「{platform}」等 {count} 个发布目标已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。',
      suspendedAllAccounts: '检测到风控，「{platform}」该平台全部账号已自动暂停后续发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页手动恢复。',
      resumeConfirm: '确认恢复「{platform}」的发布？请确保已在该平台创作者中心完成验证（手动发布一篇内容并通过验证），否则会再次触发风控暂停。',
      resumed: '已恢复「{platform}」的发布',
      resumeFailed: '恢复发布失败：{message}',
      resume: '恢复发布',
      body: '检测到「{platform}」发布触发风控。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。',
      badge: '⚠ 风控挂起',
      guidance: '该账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。',
      guidanceAllAccounts: '该平台全部账号因平台风控已暂停发布。请前往该平台创作者中心手动发布一篇内容完成验证（发布时会弹出验证，通过即可），然后在账号管理页解除挂起。',
      scopeAllAccounts: '全平台账号',
      detectedAt: '检测于 {time}',
      evidenceStrong: '判定依据：平台风控拦截',
      evidenceWeak: '判定依据：疑似风控信号（弱）',
    },
  }
