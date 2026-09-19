import { defineComponent, computed } from 'vue'

interface NavigationProps {
  mode?: 'sidebar' | 'topbar'
  collapsed?: boolean
  activeItem?: string
}

interface NavItem {
  id: string
  label: string
  icon?: string
  href?: string
  children?: NavItem[]
}

export const Navigation = defineComponent({
  name: 'MpNavigation',
  props: {
    mode: {
      type: String as () => 'sidebar' | 'topbar',
      default: 'sidebar'
    },
    collapsed: {
      type: Boolean,
      default: false
    },
    activeItem: {
      type: String,
      default: ''
    }
  },
  emits: ['item-click'],
  setup(props, { emit }) {
    // 示例导航项数据
    const navItems: NavItem[] = [
      { id: 'dashboard', label: '仪表盘', icon: '📊' },
      { id: 'videos', label: '视频管理', icon: '🎬' },
      { id: 'projects', label: '项目管理', icon: '📁' },
      { id: 'settings', label: '设置', icon: '⚙️' }
    ]

    const isNavItemActive = (itemId: string) => {
      return itemId === props.activeItem
    }

    const handleItemClick = (item: NavItem) => {
      emit('item-click', item)
    }

    const navigationClass = computed(() => {
      return [
        'mp-navigation',
        `mp-navigation--${props.mode}`,
        { 'mp-navigation--collapsed': props.collapsed && props.mode === 'sidebar' }
      ]
    })

    return {
      navItems,
      isNavItemActive,
      handleItemClick,
      navigationClass
    }
  },
  template: `
    <nav :class="navigationClass">
      <div class="mp-navigation__brand" v-if="mode === 'sidebar' && !collapsed">
        <h1 class="mp-brand">Multi-Publish</h1>
      </div>
      
      <ul class="mp-navigation__list">
        <li 
          v-for="item in navItems" 
          :key="item.id"
          class="mp-navigation__item"
          :class="{ 'mp-navigation__item--active': isNavItemActive(item.id) }"
          @click="handleItemClick(item)"
        >
          <a href="#" class="mp-navigation__link">
            <span v-if="item.icon" class="mp-nav-icon">{{ item.icon }}</span>
            <span v-if="!collapsed || mode === 'topbar'" class="mp-nav-label">{{ item.label }}</span>
          </a>
          
          <!-- 子菜单支持 -->
          <ul v-if="item.children && (!collapsed || mode === 'topbar')" class="mp-navigation__submenu">
            <li 
              v-for="child in item.children" 
              :key="child.id"
              class="mp-navigation__sub-item"
              :class="{ 'mp-navigation__sub-item--active': isNavItemActive(child.id) }"
            >
              <a href="#" class="mp-navigation__sub-link">{{ child.label }}</a>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
  `,
  styles: `
    .mp-navigation {
      display: flex;
      flex-direction: column;
      background-color: var(--color-neutral-900);
      color: white;
      transition: all 0.2s ease;
    }

    .mp-navigation--sidebar {
      width: 240px;
      min-width: 240px;
      height: 100vh;
      border-right: 1px solid var(--color-neutral-700);
    }

    .mp-navigation--sidebar.mp-navigation--collapsed {
      width: 64px;
      min-width: 64px;
    }

    .mp-navigation--topbar {
      width: 100%;
      height: 64px;
      border-bottom: 1px solid var(--color-neutral-700);
    }

    .mp-navigation__brand {
      padding: var(--spacing-4) var(--spacing-6);
      border-bottom: 1px solid var(--color-neutral-700);
    }

    .mp-brand {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      margin: 0;
      color: white;
    }

    .mp-navigation__list {
      list-style: none;
      margin: 0;
      padding: var(--spacing-4) 0;
      flex: 1;
    }

    .mp-navigation__item {
      margin-bottom: var(--spacing-1);
    }

    .mp-navigation__link {
      display: flex;
      align-items: center;
      padding: var(--spacing-3) var(--spacing-4);
      color: var(--color-neutral-300);
      text-decoration: none;
      transition: all 0.15s ease;
      cursor: pointer;
    }

    .mp-navigation__link:hover {
      background-color: rgba(255, 255, 255, 0.1);
      color: white;
    }

    .mp-navigation__item--active .mp-navigation__link {
      background-color: var(--color-primary-500);
      color: white;
    }

    .mp-nav-icon {
      font-size: var(--icon-size-md);
      margin-right: var(--spacing-3);
      width: 24px;
      text-align: center;
    }

    .mp-nav-label {
      font-size: var(--font-size-base);
    }

    .mp-navigation--sidebar.mp-navigation--collapsed .mp-nav-label {
      display: none;
    }

    .mp-navigation__submenu {
      list-style: none;
      margin: 0;
      padding: 0;
      background-color: rgba(0, 0, 0, 0.2);
    }

    .mp-navigation__sub-item {
      padding-left: calc(64px + var(--spacing-4));
    }

    .mp-navigation__sub-link {
      display: block;
      padding: var(--spacing-2) var(--spacing-4);
      color: var(--color-neutral-400);
      text-decoration: none;
      font-size: var(--font-size-sm);
      transition: all 0.15s ease;
    }

    .mp-navigation__sub-link:hover {
      color: white;
    }

    .mp-navigation__sub-item--active .mp-navigation__sub-link {
      color: var(--color-primary-400);
    }

    /* Topbar Mode */
    .mp-navigation--topbar .mp-navigation__list {
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 0 var(--spacing-6);
    }

    .mp-navigation--topbar .mp-navigation__item {
      margin-bottom: 0;
      margin-left: var(--spacing-4);
    }

    .mp-navigation--topbar .mp-navigation__link {
      border-radius: var(--border-radius-md);
    }

    .mp-navigation--topbar .mp-navigation__item--active .mp-navigation__link {
      background-color: var(--color-primary-500);
    }
  `
})

export default Navigation
