## 1. 规格与回归测试

- [x] 1.1 补充 film-engineering IPC 合法参数转发回归测试，覆盖首屏 list-shots 及至少一个复制/导出通道，并先确认旧实现红测
- [x] 1.2 保留并运行现有 sender 拒绝、空值校验和数量边界测试
- [x] 1.3 修复 renderer 导出/生成负载中的响应式代理，并补充 structuredClone 纯 JSON 回归
- [x] 1.4 新增真实打包 Electron E2E 脚本，覆盖入口、详情、复制、导出、套用、方法论与生成

## 2. 实现

- [x] 2.1 修正 withKit，将 IPC event 和业务参数按原顺序传给内部 handler
- [x] 2.2 运行电影工程 IPC 与 composable 定向测试，确认进入页面的参数校验提示不再出现
- [x] 2.3 修复点击分镜不打开详情抽屉的状态缺陷，真实窗口验证通过

## 3. 交付验证

- [x] 3.1 运行 node --check、git diff --check、OpenSpec strict validate 和依赖解析检查
- [x] 3.2 完成双模型/本地代码审查，记录风险与未覆盖项
