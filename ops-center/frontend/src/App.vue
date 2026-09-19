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
        background-color="#001529"
        text-color="#ffffffb3"
        active-text-color="#fff"
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

const visibleMenuItems = computed(() =>
  menuStore.orderedItems.filter((item) => !item.adminOnly || authStore.role === 'admin')
)

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
  background: #001529;
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
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}
.sidebar-footer {
  margin-top: auto;
  padding: 16px 24px;
  color: #ffffffb3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #ffffff1a;
}
.sidebar-footer .el-button { color: #ffffffb3; }
.el-menu { border-right: none !important; }
.el-main {
  height: 100%;
  overflow-y: auto;
}
</style>