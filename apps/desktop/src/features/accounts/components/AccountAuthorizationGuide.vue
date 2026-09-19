<template>
  <div v-if="visible" class="authorization-guide" role="dialog" aria-modal="true" aria-labelledby="authorization-guide-title">
    <div class="guide-window">
      <div class="guide-titlebar">
        <strong id="authorization-guide-title">如何完成账号授权</strong>
        <button type="button" title="关闭" aria-label="关闭授权说明" @click="$emit('acknowledge')"><Close /></button>
      </div>
      <div class="guide-content">
        <div class="guide-steps" aria-hidden="true">
          <span><Monitor /></span>
          <i></i>
          <span><CircleCheck /></span>
        </div>
        <p>请在已打开的 {{ platformName || '平台' }} 登录页面完成登录。</p>
        <p>登录页面跳转成功后，点击“我已完成登录”完成账号授权。</p>
      </div>
      <div class="guide-actions">
        <button data-testid="acknowledge-auth-guide" type="button" @click="$emit('acknowledge')">我知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { CircleCheck, Close, Monitor } from '@element-plus/icons-vue'

defineProps({
  visible: { type: Boolean, default: false },
  platformName: { type: String, default: '' },
})

defineEmits(['acknowledge'])
</script>

<style scoped>
.authorization-guide { position: fixed; inset: 56px 0 0 280px; z-index: 9800; display: grid; place-items: center; background: rgba(34, 35, 41, 0.28); }
.guide-window { width: min(360px, calc(100vw - 48px)); border: 1px solid #dedee5; border-radius: 6px; background: #fff; color: #28282f; box-shadow: 0 12px 36px rgba(31, 32, 39, 0.2); }
.guide-titlebar { min-height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid #ececf0; }
.guide-titlebar strong { font-size: 14px; font-weight: 600; }
.guide-titlebar button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: transparent; color: #7e7f88; cursor: pointer; }
.guide-titlebar svg { width: 15px; height: 15px; }
.guide-content { padding: 22px 24px 14px; text-align: center; }
.guide-steps { display: flex; align-items: center; justify-content: center; margin-bottom: 18px; }
.guide-steps span { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid #dcd9ff; border-radius: 50%; background: #f3f2ff; color: #5048e5; }
.guide-steps svg { width: 22px; height: 22px; }
.guide-steps i { width: 58px; height: 1px; background: #d8d8df; }
.guide-content p { margin: 6px 0; color: #666770; font-size: 13px; line-height: 1.65; }
.guide-actions { display: flex; justify-content: flex-end; padding: 10px 14px 14px; }
.guide-actions button { min-width: 80px; min-height: 32px; border: 1px solid #5048e5; border-radius: 5px; background: #5048e5; color: #fff; font-size: 13px; cursor: pointer; }
@media (max-width: 1360px) { .authorization-guide { left: 0; } }
</style>
