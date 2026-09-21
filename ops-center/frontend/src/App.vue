<template>
  <el-container class="app-container">
    <el-aside v-if="authStore.isLoggedIn" width="220px" class="app-sidebar">
      <div class="logo">
        <el-icon :size="24"><Setting /></el-icon>
        <span>OpsCenter</span>
      </div>
      <el-menu
        :default-active="route.path"
        router
        background-color="var(--color-sidebar-bg)"
        text-color="var(--color-sidebar-text)"
        active-text-color="var(--color-sidebar-text-active)"
      >
        <template v-for="item in visibleMenuItems" :key="item.path">
          <el-menu-item :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </template>
      </el-menu>
      <div class="sidebar-footer">
        <span>{{ authStore.username }}</span>
        <el-button text @click="logout">退出</el-button>
      </div>
    </el-aside>
    <el-main>
      <PageGuide v-if="route.meta.requiresAuth" :guide="pageGuide" />
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useMenuStore } from './stores/menu'
import PageGuide from './components/PageGuide.vue'
import { getPageGuide } from './pageGuides'

const route = useRoute()
const authStore = useAuthStore()
const menuStore = useMenuStore()

// 侧边栏与菜单设置页共用单一事实源口径（menuStore.visibleForRole），
// 避免两处各自维护过滤规则导致漂移（2026-09-21 菜单设置少 5 项事故）
const visibleMenuItems = computed(() => menuStore.visibleForRole(authStore.role))

function logout() {
  authStore.logout()
}

const pageGuide = computed(() => getPageGuide(route.name))
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.app-container { height: 100vh; overflow: hidden; }
.app-sidebar {
  background: var(--color-sidebar-bg);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.app-sidebar .el-menu {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  color: var(--color-sidebar-text-active);
  font-size: var(--font-size-md);
  font-weight: 600;
}
.sidebar-footer {
  margin-top: auto;
  padding: 16px 24px;
  color: var(--color-sidebar-text);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--color-sidebar-text-dim);
}
.sidebar-footer .el-button { color: var(--color-sidebar-text); }
.el-menu { border-right: none !important; }
.el-main {
  height: 100%;
  overflow-y: auto;
}
</style>