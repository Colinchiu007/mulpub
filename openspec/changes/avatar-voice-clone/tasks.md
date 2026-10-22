# Tasks: avatar-voice-clone

| # | 任务 | 判据 |
|---|---|---|
| T1 | 先改测试：`heygen.js` 的 5 个新方法按官方契约锁断言（URL/请求体/响应解析） | 旧实现下 RED（方法不存在即 TypeError） |
| T2 | 实现 `createAvatar` / `getAvatarStatus` / `deleteAvatar` / `cloneVoice` / `deleteVoice` | 定向测试全绿 |
| T3 | `KNOWN_METHODS` 登记 + 能力协商测试 | `supports('createAvatar')` 等为 true，且 `callAdapter` 不被闸门拦截 |
| T4 | `tts-voice-catalog.js` 登记 HeyGen 克隆能力 + 样本限制表 | 能力表单测通过 |
| T5 | 新建 `avatar-clone-service.js`（owner 隔离 + registry + 样本落盘 + 删除三态） | 单测覆盖：创建/列表/重命名/删除/远端失败补偿/失效标记 |
| T6 | IPC 三件套（handler + preload + renderer api）+ 暴露面契约登记 | `ipc-exposure-contract.test.js` 通过 |
| T7 | 前端克隆管理入口 + 上传 + 一次性合规提示 + locales 成对 | `CreateView` 相关单测 + `check-locale-sync` 通过 |
| T8 | 流水线三要素来源扩展（克隆 id）+ 通用链路零回归 | `videogen-stages.digital-human.test.js` 91 例不回归 |
| T9 | QM-1 打包 + 启动烟测 | `pnpm run build:win` exit 0 + 隔离 userData 存活 8s |
| T10 | 文档：user-manual §9.3.1 重写 + PRD #3969 不做清单修订 | doc-sync 通过 |
| T11 | **真实 Key 首跑（不在本轮范围，留待执行）** | ① 上传照片 → `avatar_id`；② 轮询训练完成；③ 上传录音 → `voice_id`；④ 用克隆形象+声音跑通一条数字人视频并下载成片 |
