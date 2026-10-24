/**
 * publish-phases —— 发布相位的共享语义（QM-6 i2）
 *
 * 为什么单独一个文件而不是各写一份：终态相位同时被两个方向相反的消费方读取 ——
 * `stores/publishProgress.js`（会话是否结束）与 `utils/publish-progress-staleness.js`
 * （停滞判据的射程）。让后者 import 前者会形成循环依赖（store 也要用陈旧判据），
 * 让两者各抄一份就是本仓反复出现的「消费方各抄一份、改一处静默漂移」。
 * 所以把这一小张语义表提到谁都能依赖的中立位置。
 *
 * 注意：这不替代 store 里的 `PHASE_ENUM`（那是**全部**相位的真源，且带
 * 「终态集合必须由 PHASE_ENUM 派生」的既有约束）。本文件只持有"哪些相位算结束"这一件事。
 */

/** 进入这些相位后不再期待新事件（与 store 的 TERMINAL_PHASES 同一份定义） */
export const PUBLISH_TERMINAL_PHASES = new Set(['success', 'failed', 'cancelled'])
