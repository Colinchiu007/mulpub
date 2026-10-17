/**
 * License Store — Pinia
 * Manages license/pro status for the frontend
 */
import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { getApi } from "@/api/electron-bridge"

export const useLicenseStore = defineStore("license", () => {
  const info = ref({ type: "free", isPro: false, features: [], daysRemaining: 0 })
  const loading = ref(false)

  async function load() {
    const api = getApi()
    if (!api) return
    loading.value = true
    try {
      const res = await api.licenseInfo()
      if (res && res.code === 0) {
        info.value = res.data
      }
    } catch (e) {
      info.value = { type: "free", isPro: false, features: [], daysRemaining: 0 }
    } finally {
      loading.value = false
    }
  }

  // 2026-10-17 remove-buyout-license：`activate(key)` 已移除。
  // 它调 `window.electronAPI.licenseActivate`，而该桥接与主进程 `license:activate`
  // handler、`licenseManager.activate()` 一并随买断授权模型删除。渲染层不再有
  // 任何「本地写授权」的入口 —— 兑换码核销只走服务端 POST /api/v1/redeem（会员中心）。
  // 全仓已确认无调用方（本文件外零命中）。

  async function deactivate() {
    const api = getApi()
    if (!api) return
    await api.licenseDeactivate()
    await load()
  }

  async function activateTrial() {
    const api = getApi()
    if (!api) return false
    try {
      const res = await api.licenseActivateTrial()
      if (res && res.code === 0) {
        await load()
        return true
      }
      return false
    } catch (e) {
      return false
    }
  }

  const isPro = computed(() => info.value.isPro || false)
  const isTrial = computed(() => info.value.isTrial || false)
  const isFree = computed(() => !info.value.isPro)
  const licenseType = computed(() => info.value.type || "free")
  const daysRemaining = computed(() => info.value.daysRemaining || 0)

  return {
    info, loading, load, deactivate, activateTrial,
    isPro, isTrial, isFree, licenseType, daysRemaining,
  }
})
