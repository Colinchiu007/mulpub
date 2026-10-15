/**
 * usePublishAddAccountTargets.js — 发布页「无账号平台空态出口」的接线层
 *
 * 与 `usePublishGroupTargets` 同一范式：判据本体在
 * `@/features/publish/usePublishAddAccount`（依赖注入、可单测），这里只做
 * 「store ↔ 视图」的桥，让 `views/Publish.vue` 不必为这段接线付出多行。
 *
 * 为什么必须单独成文（不是过度设计）：`Publish.vue` 被 `check-max-lines` 的
 * **点名还账** targets 盯着（`max-lines-baseline.json` 里 `Publish.vue: 1773`，
 * 容差 0）。接线内联要 13 行、必红；抽到这里后视图只增「1 行调用 + 1 行 v-bind」，
 * 并顺带把 `loadAccounts` 一并收进来，使净变化为负。
 * 依据 `01-docs/learnings.md:17959`：「点名还账文件…正确姿势是接线逻辑抽独立 composable…
 * 结构性拆分才是正解」（纯删注释是脆解）。
 *
 * 契约见 `01-docs/PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md`。
 */
import { useTabStore } from '@/stores/tab'
import { usePublishAddAccount } from '@/features/publish/usePublishAddAccount'

export function usePublishAddAccountTargets ({
  accountStore,
  platformStore,
  isPublishing,
  notifyError,
  notifyWarning,
}) {
  const tabStore = useTabStore()

  const { refreshing, openLoginForPlatform, refreshAccounts } = usePublishAddAccount({
    tabStore,
    accountStore,
    notifyError,
    notifyWarning,
    platformLabel: (id) => platformStore.getLabel(id) || id,
  })

  // busy 判据在**调用时**读 isPublishing()，不是 setup 时捕获：用户点「添加」要读到当时的发布态。
  // 取函数而非 ref 还有一层必要性——本 composable 在 `usePublishFlow` 之前调用（与
  // `usePublishGroupTargets` 同处），那时 `publishing` 尚未初始化；闭包延迟求值可避开 TDZ。
  const onAddAccount = (platformId) => openLoginForPlatform(platformId, { busy: isPublishing() === true })
  const onRefreshAccounts = () => refreshAccounts()

  /** 账号列表首次加载（原 `views/Publish.vue` 的 `loadAccounts` 内联实现，2026-10-15 移入）。 */
  async function loadAccounts () {
    await accountStore.ensureLoaded()
  }

  return {
    // 直接喂给 `<PublishTargetSelector v-bind="…" />`：键名按 Vue 的事件归一化命名
    // （`onAddAccount` ↔ `emit('add-account')`），已由 PublishTargetSelector.test.js 的
    // v-bind 契约用例钉住，不靠"Vue 应该会转"的推断。
    addAccountBindings: { refreshingAccounts: refreshing, onAddAccount, onRefreshAccounts },
    loadAccounts,
  }
}
