# ADR-002: 平台上传实现策略

## 状态

2026-07-03 · 批准

## 上下文

29 个平台适配器的 uploadVideo/uploadCover 目前返回 null，无法实际发布视频。

参考产品 4.0 反编译分析显示各平台使用不同上传后端：
- 腾讯云 COS/DFS：小红书、视频号
- 阿里云 OSS：知乎、得物、CSDN、一点号
- 自定义 CDN：抖音、快手、B站、微博、头条号、百家号等

## 决策

按优先级分三层实现上传：

### 第一层：COS/OSS 平台（优先级 P0）
已有 cos-uploader.js 和 oss-uploader.js，只需补全 token 获取 + 上传编排。

### 第二层：标准 HTTP 上传平台（优先级 P1）
通过 multipart/form-data 或直接 PUT/POST 上传文件。

### 第三层：其他平台（优先级 P2）
实现通用文件上传基类，覆盖剩余平台。

## Upload Orchestrator 设计

upload/
├── index.js              # 统一导出
├── orchestrator.js        # 上传编排（getToken → upload → return fileId）
├── providers/
│   ├── cos-provider.js    # COS token 获取 + 上传
│   ├── oss-provider.js    # OSS token 获取 + 上传
│   └── http-provider.js   # HTTP 直接上传

## 风险

- 平台 API 可能变更（token 获取逻辑最脆弱）
- 无法在不登录的情况下测试

## 缓解措施

- 添加 uploadToken 缓存（减少 API 调用）
- 适配器保留 null fallback（降级时由 RPA 接管）

## 被否决的选项

- 一次性实现所有 29 个上传：token 获取依赖反编译代码，部分平台细节不足
