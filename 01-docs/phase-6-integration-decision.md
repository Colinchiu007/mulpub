# Phase 6.1 决策记录：api-publish-engine 与 python-backend 整合

**日期**: 2026-07-09
**决策者**: 用户确认（B + 轻量 C）
**遵循规范**: AGENTS.md 阶段 3（技术架构）— 选最简单的方案

---

## 决策摘要

**选定方案**: B + 轻量 C

- **B（保持双栈明确分工）**：api-publish-engine (JS) 与 python-backend (Python) 维持双栈，为 4 个重叠平台指定唯一主责任栈。
- **轻量 C（仅共享平台元数据）**：把 `platform-configs.js` 的 25 平台静态配置收敛到 `shared-utils` 的 YAML `platform-config`，两端共同消费。

**未选方案**:
- A（全合并到 Python，废弃 JS）— 移植 30+ 平台成本高、进程内 require 改 HTTP 性能回退、签名算法跨语言等价性风险大。

---

## 现状事实（决策依据）

### 接线方式

| 包 | 语言 | 接线方式 | 调用方 |
|----|------|---------|--------|
| api-publish-engine | JS | Electron **进程内 require**（微秒级） | `apps/desktop/electron/services/api-platform-adapter.js` + `rpa-view-manager.js` |
| python-backend | Python | Electron **spawn 子进程** → HTTP:8299 | `apps/desktop/electron/services/python-bridge.js` |

### 平台覆盖

| 包 | 完整适配器 | generic-config | 重心 |
|----|-----------|---------------|------|
| api-publish-engine | 7（zhihu/douyin/kuaishou/baijiahao/wechat_mp/shipinhao/weibo） | ~25 | 发布引擎（签名/上传/限流/调度） |
| python-backend | 4（douyin/wechat_mp/xiaohongshu/bilibili） | 0 | 视频创作树 + RPA 发布 |

### 4 个重叠平台主责任栈指定

| 平台 | 主责任栈 | 理由 |
|------|---------|------|
| `douyin` | **Python** | API+RPA 双模式更鲁棒；认证捕获 localStorage+IndexedDB 更完整 |
| `wechat_mp` | **Python** | 官方 OAuth API 比 JS cookie hack 规范 |
| `xiaohongshu` | **Python** | JS 侧是 generic-adapter 空壳（无专门适配器），基本不可用 |
| `bilibili` | **Python** | JS 侧 `publishPath=""` 空壳，基本不可用 |

JS 侧专注其独有平台：zhihu / kuaishou / baijiahao / shipinhao / weibo / youtube / tiktok / twitter 等。

### 独有资产

- **JS 侧**：第三方远程签名服务接入（`qianming.yixiaoer.cn`，可用环境变量 `MP_SIGNER_BASE` 覆盖）+ 反编译本地签名算法（`signer-local.js`：CSDN HMAC-SHA256 / 小红书 X-s X-t / 抖音 _signature / 快手 __NS_sig3）
- **Python 侧**：Playwright 浏览器上下文（签名由浏览器原生计算，更稳但更慢）

### 未被消费的预留面

- api-publish-engine 自带的 HTTP 服务（`src/publish-api-server.js`）+ Python SDK（`clients/python/publish_api_client.py`）：全仓库 grep 显示无人调用。是"公共 API"预留面，当前不接入。

---

## 落地计划

### 阶段 1：4 个重叠平台路由标注（JS 侧）

在 api-publish-engine 的 REGISTRY 中为 douyin/wechat_mp/xiaohongshu/bilibili 标注 `delegateTo: 'python'`，让 `api-platform-adapter.js` 的路由层优先走 Python HTTP，JS 适配器作为文档化的回退。

### 阶段 2：平台元数据收敛（轻量 C）

把 `packages/api-publish-engine/src/adapters/platform-configs.js` 的 25 平台静态配置迁到 `packages/shared-utils` 的 YAML `platform-config`，JS/Python 两端共同消费。新增平台只改一处。

### 阶段 3：废弃 JS 侧空壳配置

从 `platform-configs.js` 移除 xiaohongshu / bilibili 的空壳配置（`publishPath=""`），或在配置中标注 `deprecated: true`。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 4 个重叠平台路由标注后，JS 适配器仍可能被旧代码直接调用 | 路由层加 `console.warn` 提示 delegate-to-python；保留 JS 适配器作为回退，不删除 |
| 平台元数据迁移 YAML 后两端解析不一致 | 写跨包集成测试验证 JS/Python 解析同一 YAML 得到等价配置 |
| 第三方远程签名服务 `qianming.yixiaoer.cn` 不可用时 JS 侧降级 | 已有 `signer-local.js` 本地回退，保持现状；端点可用 `MP_SIGNER_BASE` 环境变量覆盖 |

---

## 关键文件索引

### JS 侧
- `/workspace/packages/api-publish-engine/src/index.js` — REGISTRY 定义
- `/workspace/packages/api-publish-engine/src/adapters/platform-configs.js` — 25 平台静态配置
- `/workspace/packages/api-publish-engine/src/signer.js` + `signer-local.js` — 签名服务
- `/workspace/apps/desktop/electron/services/api-platform-adapter.js` — 进程内 require + 路由
- `/workspace/apps/desktop/electron/services/rpa-view-manager.js` — API-first 路径

### Python 侧
- `/workspace/packages/python-backend/src/server.py` — FastAPI 入口（端口 8299）
- `/workspace/packages/python-backend/src/multi_publish/publishers/{douyin,wechat_mp,xiaohongshu,bilibili}.py`
- `/workspace/apps/desktop/electron/services/python-bridge.js` — spawn 子进程

### 共享层（待建）
- `/workspace/packages/shared-utils/` — 平台元数据 YAML 收敛目标
