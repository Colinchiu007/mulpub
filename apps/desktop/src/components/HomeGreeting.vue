<template>
  <div class="home-greeting" data-testid="home-greeting">
    <h2>
      <span>{{ greetingText }}{{ separator }}</span>
      <a
        v-if="showLoginEntry"
        href="#"
        class="home-login-link"
        data-testid="home-login-link"
        :aria-busy="identityStore.loading"
        @click.prevent="handleLoginClick"
      >{{ t('home.pleaseLogin') }}</a>
      <span v-else>{{ displayName }}</span>
    </h2>
    <p>{{ t('home.subtitle') }}</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity'
import { useNotify } from '@/composables/useNotify'
import { reportError } from '@/utils/report-error'

const { t } = useI18n()
const identityStore = useIdentityStore()
const { notifyWarning } = useNotify()

const separator = '，'

const displayName = computed(() => identityStore.displayName || t('home.user'))

const greetingText = computed(() => {
  const hour = new Date().getHours()
  const key = hour < 6 ? 'lateNight' : hour < 12 ? 'morning' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening'
  return t('home.greetings.' + key)
})

/**
 * 未登录且身份服务可用 → 展示「请登录」链接。
 * status === 'disabled' 表示身份服务未配置/不可用（fail-closed），不提供登录入口，
 * 与 ProfileMenu 的降级策略保持一致。
 */
const showLoginEntry = computed(() => !identityStore.isAuthenticated && identityStore.status !== 'disabled')

async function handleLoginClick() {
  if (identityStore.loading) return
  try {
    // signInOrSwitch: 被拒（主进程残留旧会话）时自动降级为切换账号
    const ok = await identityStore.signInOrSwitch()
    if (!ok || !identityStore.isAuthenticated) {
      notifyWarning('loginGate.loginIncomplete', { message: t('loginGate.loginIncomplete') })
    }
  } catch (e) {
    reportError('home login entry failed', e)
    notifyWarning('loginGate.loginIncomplete', { message: t('loginGate.loginIncomplete') })
  }
}
</script>

<style scoped>
.home-greeting h2 {
  margin: 0 0 4px;
  color: #25252b;
  font-size: 22px;
  font-weight: 600;
}

.home-greeting p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.home-login-link {
  color: var(--color-primary);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.home-login-link:hover,
.home-login-link:focus-visible {
  color: #3f37c9;
  text-decoration: underline;
  outline: none;
}
</style>
