# 设计：文案库一级页面数据聚合

## 方案选型

**选定：方案 B——纯 renderer 实时合成聚合（4 源）**

| 方案 | 描述 | 结论 |
|------|------|------|
| A：主进程新聚合 IPC | 主进程读 4 源合并返回 | 拒绝：collected_items/rewrites/drafts 均为 settings key，renderer 已有成熟读取路径；新增主进程聚合层重复且增加 IPC 契约面 |
| B：renderer composable 聚合 | useCopyLibrarySources.js 并行拉 4 源，统一形状合并 | **选定**：与 useCopyLibrary 既有模式一致，双入口（采集页 tab + 一级页面）共享数据层，写入路径 readCurrent() 保证最终一致 |
| C：独立 SQLite 表 | 新 copy_library 表，各来源写入时双写 | 拒绝：双写漂移风险，且 story2video 项目已有独立存储 |

## 数据流

```
CopyLibraryView.vue
  └─ useCopyLibrarySources()
       ├─ storeGetSetting('collected_items')      → 采集条目（实时合成）
       ├─ storeGetSetting('copy_library_rewrites') → 改写条目（复用 useCopyLibrary）
       ├─ draftList()                              → 草稿条目（热门选题创作产物）
       └─ story2videoListProjects()                → 视频项目（sourceText 截断预览）
            ↓ buildUnifiedItems() 统一形状 + compareByCreatedAtDesc 排序
       → { items, filterByOrigin, searchByKeyword }
```

## 统一条目形状（UNIFIED_ITEM）

```js
{
  id: 'collect:<id>' | 'rewrite:<id>' | 'draft:<id>' | 'video:<projectId>',
  origin: 'collect' | 'rewrite' | 'draft' | 'video',
  title, content(预览截断500字), wordCount, platform, sourceUrl, createdAt,
  metadata: { videoProjectId? }  // 来源特有
}
```

## 边界与守卫

- sourceText 预览截断 500 字（SOURCE_PREVIEW_LIMIT），全文经 story2videoGetProject 按需加载
- drafts 条目无 id 时跳过（fail-safe）
- 各来源加载失败互不阻塞（Promise.allSettled 语义），单源失败显示该源空而非整页崩
- owner 隔离：4 源均走既有 owner-scoped settings/IPC，无新增越权面
- 不做内容级去重：同正文跨阶段（采集→草稿→发布）是不同业务实体，按来源独立展示

## 菜单与路由契约

- route-registry.js 先登记（维护规则：先登记再加路由），key=copy-library，group=primary，icon=Document（@element-plus/icons-vue）
- SIDEBAR_MENU_KEY_ORDER：collection 与 rewrite 之间插入
- sidebar-menu.test.js EXPECTED_DERIVED_MENU 同步 +1 条
- ops-center CATALOG 同步（key/label/group/desc），运营端可配置显示隐藏（不加强制显示）
