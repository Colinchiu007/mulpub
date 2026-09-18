// @ts-check
/**
 * viral-signal — 爆款分析信号跨页传递（P1-E）
 *
 * 分析成功后写入最近一次分析的爆款信号（推荐角度 + 上升关键词），
 * 改写页（/rewrite?titleHint=）读取并作为软约束注入改写 Prompt。
 * 会话内存信号（不持久化）：分析结果是短期趋势，跨会话无意义。
 */
import { defineStore } from 'pinia'

export const useViralSignalStore = defineStore('viralSignal', {
  state: () => ({
    signal: null, // { topic, angles: string[], keywords: string[], savedAt }
  }),
  actions: {
    /**
     * 记录最近一次爆款分析信号（清洗：非字符串/空白过滤，各 ≤6 条）
     */
    setSignal (payload) {
      if (!payload || typeof payload !== 'object') return
      this.signal = {
        topic: String(payload.topic || '').slice(0, 200),
        angles: Array.isArray(payload.angles)
          ? payload.angles.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim().slice(0, 60)).slice(0, 6)
          : [],
        keywords: Array.isArray(payload.keywords)
          ? payload.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)).slice(0, 6)
          : [],
        savedAt: new Date().toISOString(),
      }
    },
    clearSignal () {
      this.signal = null
    },
  },
})
