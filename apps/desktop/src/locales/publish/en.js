/**
 * publish 命名空间文案（locales 结构拆分，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3）
 * 从 locales/en.js 拆出，键名与拆出前完全一致；zh/en 成对维护（CI Gate 7）。
 */
export default {
    title: 'Title',
    content: 'Content',
    platform: 'Platform',
    tags: 'Tags',
    publishBtn: 'Publish',
    saveDraft: 'Save Draft',
    publishing: 'Publishing...',
    success: 'Published successfully',
    failed: 'Publish failed',
    failureDraftSaved: 'Publish failed: your content was saved to Drafts automatically. Restore it from Drafts and retry.',
    api: {
      modeApi: 'Direct API',
      modeDom: 'Browser RPA',
      modeFallback: 'Fallback',
      modeApiHint: 'Published directly via the platform official HTTP API',
      modeDomHint: 'Published via headless browser automation',
      modeFallbackHint: 'API publish unavailable; automatically fell back to browser publish',
    },
    riskHold: {

      suspended: 'Risk control detected. {count} publish target(s) including "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page.',
      suspendedAllAccounts: 'Risk control detected. All accounts for "{platform}" have been paused automatically. Go to the platform creator center, publish one post manually and pass the verification, then resume from the Accounts page.',
      resumeConfirm: 'Resume publishing to "{platform}"? Make sure you have completed verification in the platform creator center (publish one post manually and pass the verification), otherwise it will pause again.',
      resumed: 'Resumed publishing to "{platform}"',
      resumeFailed: 'Failed to resume publishing: {message}',
      resume: 'Resume publishing',
      body: 'Risk control detected while publishing to "{platform}". Go to the platform creator center, publish one post manually and pass the verification, then lift the hold on the Accounts page.',
      badge: '⚠ Risk hold',
      guidance: 'Publishing is paused for this account due to platform risk control. Go to the platform creator center, publish one post manually and pass the verification (a verification prompt will appear during publishing), then lift the hold on the Accounts page.',
      guidanceAllAccounts: 'Publishing is paused for all accounts of this platform due to platform risk control. Go to the platform creator center, publish one post manually and pass the verification (a verification prompt will appear during publishing), then lift the hold on the Accounts page.',
      scopeAllAccounts: 'All accounts',
      detectedAt: 'Detected at {time}',
      evidenceStrong: 'Reason: platform risk control',
      evidenceWeak: 'Reason: possible risk signal (weak)',
    },
  }
