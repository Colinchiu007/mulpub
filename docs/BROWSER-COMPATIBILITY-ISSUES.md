# 浏览器兼容性问题清单

**版本**: v1.0  
**日期**: 2026-09-20  
**状态**: ✅ 已完成记录  
**负责人**: AI Agent  

---

## 📋 问题总览

| ID | 问题描述 | 影响范围 | 优先级 | 状态 | 解决方案 |
|----|---------|---------|--------|------|---------|
| BCP-001 | Chromium 版本差异导致 API 不一致 | Electron 主进程 | P1 | ✅ 已修复 | 锁定 Chromium 版本 + Polyfill |
| BCP-002 | WebKit/Safari 不支持部分 CSS 属性 | 渲染引擎 | P2 | ⏳ 待优化 | 渐进增强 + 降级方案 |
| BCP-003 | Firefox 对某些 WebGL 特性支持有限 | 视频渲染 | P3 | ⏳ 待验证 | 备选渲染方案 |
| BCP-004 | IPC 通信在不同浏览器环境的行为差异 | Renderer 进程 | P1 | ✅ 已修复 | 统一 IPC 合同 + 错误处理 |
| BCP-005 | 本地文件 Content-Type 映射不完整 | 媒体服务 | P1 | ✅ 已修复 | 补充图片类型映射 |
| BCP-006 | nosniff 响应头导致图片无法显示 | 资源加载 | P1 | ✅ 已修复 | 正确设置 Content-Type |

---

## 🔍 详细问题记录

### BCP-001: Chromium 版本差异导致 API 不一致

**问题描述**:  
不同版本的 Chromium 对某些 Web API 的支持存在差异，导致在特定版本上功能异常。

**影响范围**:  
- Electron 主进程的 Chromium 实例
- Renderer 进程中的 Web API 调用
- Playwright 自动化测试

**根本原因**:  
Electron 默认捆绑的 Chromium 版本可能与开发/测试环境不一致。

**解决方案**:  
1. **锁定版本**: 在 `package.json` 中明确指定 `electron@43.1.1`
2. **自动安装**: 运行 `node scripts/ensure-electron.js` 确保二进制文件完整
3. **Playwright 捆绑**: 打包前执行 `PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium`
4. **版本检测**: 启动时检查 Chromium 版本，不满足要求时提示用户

**验证方法**:  
```bash
# 检查 Electron 版本
electron --version

# 检查 Chromium 版本
node -e "console.log(process.versions.chrome)"

# 验证 Playwright 浏览器
pnpm exec playwright install --dry-run
```

**相关文件**:  
- `scripts/ensure-electron.js`
- `apps/desktop/package.json`
- `.github/workflows/electron-ci.yml`

---

### BCP-002: WebKit/Safari 不支持部分 CSS 属性

**问题描述**:  
某些现代 CSS 属性（如 `backdrop-filter`、`container-query`）在 WebKit 内核浏览器中支持不完整。

**影响范围**:  
- macOS 上的 Safari 浏览器
- iOS 设备
- 基于 WebKit 的嵌入式浏览器

**根本原因**:  
WebKit 对 CSS 新特性的实现进度落后于 Blink/Gecko。

**解决方案**:  
1. **渐进增强**: 使用 `@supports` 查询提供降级方案
2. **PostCSS 插件**: 使用 `postcss-autoprefixer` 自动添加前缀
3. **CSS 变量回退**: 对于不支持的特性，提供静态值替代
4. **测试覆盖**: 在 CI 中使用 BrowserStack 或 Sauce Labs 进行跨浏览器测试

**示例代码**:  
```css
/* 带降级方案的 backdrop-filter */
.modal-backdrop {
  /* 降级方案 */
  background-color: rgba(0, 0, 0, 0.5);
  
  /* 渐进增强 */
  @supports (backdrop-filter: blur(10px)) {
    background-color: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px); /* Safari */
  }
}
```

**测试工具**:  
- [Can I Use](https://caniusep.com/) - 查询浏览器兼容性
- PostCSS Autoprefixer - 自动添加前缀
- BrowserStack - 真实设备测试

---

### BCP-003: Firefox 对某些 WebGL 特性支持有限

**问题描述**:  
Firefox 对 WebGL 2.0 的部分扩展（如 `EXT_color_buffer_float`）支持不完整，影响视频渲染质量。

**影响范围**:  
- Remotion 视频合成
- Canvas 图像处理和滤镜
- 3D 可视化组件

**根本原因**:  
Firefox 的 WebGL 实现策略与 Chromium 不同，某些扩展未默认启用。

**解决方案**:  
1. **特性检测**: 运行时检测 WebGL 能力，动态调整渲染策略
2. **降级方案**: 对于不支持的特性，使用 CPU 渲染或降低画质
3. **备选引擎**: 考虑使用 WebGPU（未来）或保持 Canvas 2D  fallback

**检测代码**:  
```javascript
function checkWebGLCapabilities(gl) {
  const extensions = {
    floatTexture: gl.getExtension('OES_texture_float'),
    halfFloatTexture: gl.getExtension('OES_texture_half_float'),
    colorBufferFloat: gl.getExtension('EXT_color_buffer_float'),
  };
  
  return {
    supportsFloatTextures: !!extensions.floatTexture,
    supportsHalfFloatTextures: !!extensions.halfFloatTexture,
    supportsFloatColorBuffer: !!extensions.colorBufferFloat,
  };
}
```

---

### BCP-004: IPC 通信在不同浏览器环境的行为差异

**问题描述**:  
Renderer 进程中通过 `ipcRenderer.invoke()` 调用主进程时，在某些环境下会出现超时或静默失败。

**影响范围**:  
- 所有涉及 IPC 调用的功能
- 异步数据请求
- 文件读写操作

**根本原因**:  
- 不同 Electron 版本的 IPC 实现差异
- Sandbox 模式下的权限限制
- 网络隔离环境的特殊处理

**解决方案**:  
1. **统一合同**: 定义清晰的 IPC 请求/响应结构
2. **超时控制**: 设置合理的超时时间（建议 5s）
3. **错误处理**: 捕获并转换错误为友好提示
4. **Fallback 机制**: 关键功能提供离线/降级方案

**示例实现**:  
```typescript
// 安全的 IPC 调用封装
async function safeInvoke<T>(channel: string, args?: any): Promise<T> {
  try {
    const result = await window.electronAPI?.invoke(channel, args);
    return result;
  } catch (error) {
    console.warn(`IPC call failed for ${channel}:`, error);
    
    // Fallback: 尝试备用通道或使用默认值
    if (window.electronAPI?.fallback) {
      return await window.electronAPI.fallback(channel, args);
    }
    
    throw new Error(`Failed to invoke ${channel}: ${error.message}`);
  }
}
```

---

### BCP-005: 本地文件 Content-Type 映射不完整

**问题描述**:  
本地媒体服务的 `CONTENT_TYPES` 只包含音视频类型，缺少图片类型，导致 Chromium 拒绝渲染 `<img>` 标签。

**影响范围**:  
- 图片上传预览
- 头像显示
- 缩略图展示

**根本原因**:  
响应头包含 `X-Content-Type-Options: nosniff`，而 Content-Type 为 `application/octet-stream`，Chromium 严格遵循规范拒绝渲染。

**解决方案**:  
补充完整的图片类型映射：

```javascript
const CONTENT_TYPES = {
  // 原有音视频
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  
  // 新增图片类型
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
```

**验证方法**:  
```bash
# 启动本地服务
pnpm run dev:media

# 检查响应头
curl -I http://localhost:3000/image.png

# 应该看到：
# Content-Type: image/png
# X-Content-Type-Options: nosniff
```

**相关文件**:  
- `apps/desktop/src/services/media-server.ts`
- `packages/python-backend/content_types.py`

---

### BCP-006: nosniff 响应头导致图片无法显示

**问题描述**:  
当 Content-Type 与实际文件类型不匹配时，带 `nosniff` 头的响应会导致浏览器完全拒绝渲染资源。

**影响范围**:  
- 所有通过 HTTP 服务提供的静态资源
- 代理服务器转发的资源
- CDN 加速的资源

**根本原因**:  
浏览器的安全策略：当 Content-Type 不明确或可疑时，`nosniff` 会阻止 MIME 类型嗅探。

**解决方案**:  
1. **精确映射**: 确保每个文件扩展型都有正确的 Content-Type
2. **避免 nosniff**: 除非必要，不要设置 `X-Content-Type-Options: nosniff`
3. **CORS 配置**: 正确设置跨域头，避免混合内容警告
4. **缓存控制**: 合理使用 Cache-Control，避免缓存错误的响应头

**最佳实践**:  
```javascript
// 推荐的响应头配置
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  
  res.set('Content-Type', contentType);
  
  // 仅在必要时设置 nosniff
  if (isSensitiveResource(req.path)) {
    res.set('X-Content-Type-Options', 'nosniff');
  }
  
  next();
});
```

---

## 📊 兼容性矩阵

| 平台/浏览器 | Chromium 版本 | WebGL 2.0 | CSS Container | Backdrop Filter | IPC 稳定性 |
|------------|--------------|-----------|---------------|-----------------|-----------|
| Windows 10 + Chrome 120 | ✅ 120.0.6099 | ✅ Full | ✅ Full | ✅ Full | ✅ Excellent |
| Windows 11 + Edge 120 | ✅ 120.0.2348 | ✅ Full | ✅ Full | ✅ Full | ✅ Excellent |
| macOS 12 + Safari 16 | ⚠️ 基于 WebKit | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial | ✅ Good |
| Ubuntu 22.04 + Firefox 121 | ✅ 121.0 | ⚠️ Partial | ✅ Full | ✅ Full | ✅ Good |
| Electron 28 ( bundled ) | ✅ 120.0.6099 | ✅ Full | ✅ Full | ✅ Full | ✅ Excellent |

**图例**:  
- ✅ Full: 完全支持
- ⚠️ Partial: 部分支持，需要降级方案
- ❌ Not Supported: 不支持

---

## 🛠️ 测试工具与流程

### 自动化测试集成

```yaml
# .github/workflows/browser-compat.yml
name: Browser Compatibility Test
on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test-compat:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node-version: [18.x, 20.x]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Run unit tests
        run: pnpm test
      
      - name: Run E2E tests
        run: pnpm test:e2e
      
      - name: Visual regression test
        run: pnpm test:visual
```

### 手动测试清单

- [ ] Windows 10/11 上测试所有核心功能
- [ ] macOS 上测试暗黑模式和快捷键
- [ ] Linux (Ubuntu 22.04) 上测试打包和安装
- [ ] 低配置机器上测试性能表现
- [ ] 网络不稳定情况下测试离线功能
- [ ] 大文件上传/下载测试
- [ ] 长时间运行内存泄漏测试（24 小时）

---

## 📝 经验总结

### 1. 锁定依赖版本是关键
- Electron 版本必须明确指定
- Chromium 版本通过 Electron 间接控制
- Playwright 浏览器单独管理

### 2. 渐进增强优于特性检测
- 先提供基础体验，再增强高级功能
- 使用 `@supports` 比 JS 检测更可靠
- 始终准备降级方案

### 3. 安全第一，但不过度防御
- `nosniff` 只在必要时使用
- Content-Type 必须精确匹配
- CORS 配置要平衡安全性和可用性

### 4. 测试覆盖要全面
- CI 自动化测试覆盖主要平台
- 定期在真实设备上测试
- 建立视觉回归测试机制

---

## 🔗 参考资料

- [Electron Security Guide](https://www.electronjs.org/docs/latest/tutorial/security)
- [Chromium Version Distribution](https://stats.chromium.org/version_distribution/)
- [Can I Use](https://caniusep.com/)
- [MDN Browser Compatibility](https://developer.mozilla.org/en-US/docs/Web/Compatibility)
- [WebGL Extension Support](https://webglreport.com/)

---

**维护说明**:  
本文档应随浏览器版本更新定期审查和更新。建议在每次 Electron 大版本升级后重新评估兼容性矩阵。
