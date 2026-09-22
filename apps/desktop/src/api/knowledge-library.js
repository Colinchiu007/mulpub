/**
 * 知识库 API 封装 — 调用 Electron IPC
 * 所有 Vue 组件通过此文件访问 Electron IPC，不直接调用 window.electronAPI
 */
import { invoke, invokeWithFallback } from "./electron-bridge";

// ─── 爆款库 ─────────────────────────────
export async function addViralToLibrary(item) { return invokeWithFallback("addViralToLibrary", { code: -1, data: null }, item) }
export async function addViralBatchToLibrary(items) { return invokeWithFallback("addViralBatchToLibrary", { code: -1, data: { count: 0 } }, items) }
export async function listViralItems(params) { return invokeWithFallback("listViralItems", { code: -1, data: { items: [], total: 0 } }, params) }
export async function getViralItem(id) { return invokeWithFallback("getViralItem", { code: -1, data: null }, id) }
export async function updateViralItem(id, updates) { return invokeWithFallback("updateViralItem", { code: -1, data: null }, id, updates) }
export async function deleteViralItem(id) { return invokeWithFallback("deleteViralItem", { code: -1, data: null }, id) }
export async function searchViralItems(query, limit) { return invokeWithFallback("searchViralItems", { code: -1, data: [] }, query, limit) }

// ─── 模式卡片（P1：LLM 提取的结构化爆款模式）───
export async function listPatternCards(params) { return invokeWithFallback("listPatternCards", { code: -1, data: { items: [], total: 0 } }, params) }
export async function getPatternQueueStats() { return invokeWithFallback("getPatternQueueStats", { code: -1, data: { pending: 0, deferred: 0 } }) }
export async function reextractPattern(viralItemId) { return invokeWithFallback("reextractPattern", { code: -1, data: null }, viralItemId) }

// ─── 效果闭环（P2）─────────────────────
export async function listTrackedContent(params) { return invokeWithFallback("listTrackedContent", { code: -1, data: { items: [], total: 0 } }, params) }
export async function addManualSnapshot(trackedContentId, metrics) { return invokeWithFallback("addManualSnapshot", { code: -1, data: null }, trackedContentId, metrics) }
export async function recomputeAttribution() { return invokeWithFallback("recomputeAttribution", { code: -1, data: null }) }
export async function listPatternPerformance(params) { return invokeWithFallback("listPatternPerformance", { code: -1, data: { items: [] } }, params) }
export async function triggerPerformanceRecrawl() { return invokeWithFallback("triggerPerformanceRecrawl", { code: -1, data: null }) }

// ─── 个人知识库 ─────────────────────────
export async function addPersonalToLibrary(item) { return invokeWithFallback("addPersonalToLibrary", { code: -1, data: null }, item) }
export async function addPersonalBatchToLibrary(items) { return invokeWithFallback("addPersonalBatchToLibrary", { code: -1, data: { count: 0 } }, items) }
export async function listPersonalItems(params) { return invokeWithFallback("listPersonalItems", { code: -1, data: { items: [], total: 0 } }, params) }
export async function getPersonalItem(id) { return invokeWithFallback("getPersonalItem", { code: -1, data: null }, id) }
export async function updatePersonalItem(id, updates) { return invokeWithFallback("updatePersonalItem", { code: -1, data: null }, id, updates) }
export async function deletePersonalItem(id) { return invokeWithFallback("deletePersonalItem", { code: -1, data: null }, id) }
export async function searchPersonalItems(query, limit) { return invokeWithFallback("searchPersonalItems", { code: -1, data: [] }, query, limit) }

// ─── 常量：9 个个人知识库类别 ────────────
export const PERSONAL_CATEGORIES = [
  { value: 'personal_ip_persona', label: '个人IP人设', type: 'constraint' },
  { value: 'personal_background', label: '个人背景', type: 'material' },
  { value: 'personal_stories', label: '个人故事', type: 'material' },
  { value: 'growth_experience', label: '成长经历', type: 'material' },
  { value: 'emotional_experience', label: '情感经历', type: 'material' },
  { value: 'work_experience', label: '工作经历', type: 'authority' },
  { value: 'project_experience', label: '项目经验', type: 'authority' },
  { value: 'personal_opinions', label: '个人观点', type: 'stance' },
  { value: 'family_stories', label: '家人故事', type: 'material' },
]

export const PERSONAL_CATEGORY_LABELS = Object.fromEntries(
  PERSONAL_CATEGORIES.map(c => [c.value, c.label])
)

// ─── 文件批量导入 ─────────────────────────
export async function importFiles(files, categoryPerFile) { return invokeWithFallback("importFiles", { code: -1, data: null }, files, categoryPerFile) }

// ─── 飞书导出 ─────────────────────────────
export async function exportViralToFeishu(title) { return invokeWithFallback("exportViralToFeishu", { code: -1, data: null }, title) }
export async function exportPersonalToFeishu(title) { return invokeWithFallback("exportPersonalToFeishu", { code: -1, data: null }, title) }
