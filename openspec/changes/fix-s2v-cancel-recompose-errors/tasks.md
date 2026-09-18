## 1. 渲染端 recompose 失败透传

- [x] 1.1 `ResultView.recomposeProject()` catch 改为透传真实错误走通知归一化，兼容 Error 对象与纯字符串（测试：`ResultView.test.js` 新增「重新合成失败透传真实错误并归一化为具体提示」+「未映射错误回退 operation_failed」）

## 2. 素材缺失错误友好化

- [x] 2.1 `_scenesForCompose` map 回调补 `index` 参数，video/video1/video2 缺失抛「第 N 个场景的视频素材不存在、不可读或超出限制」（测试：`story2video-project-service.test.js` 更新 `_scenesForCompose` 错误文案断言 + 新增 video 选中态缺失回归断言）
- [x] 2.2 显式选中 `video` 分支预校验 `videoPath` 可读性，避免缺失视频落到 compose 二义性 media path 错误被误归为图片缺失（审查 C1 修复）

## 3. 通知归一化新增 SCENE_VIDEO_MISSING

- [x] 3.1 `story2video-notifications.js` 新增 `SCENE_VIDEO_MISSING` key + pattern + resolve 映射，扩展 `SCENE_IMAGE_MISSING`/`SCENE_AUDIO_MISSING` pattern 覆盖 compose 英文错误；优化 pattern 去冗余并补 `video path.*unreadable` 子模式（审查 S1/S2）（测试：`story2video-notifications.test.js` 新增「再次合成时素材缺失错误归一化为具体提示」）
- [x] 3.2 locales zh/en 成对新增 `scene_video_missing` 文案（CI check-locale-sync 通过）

## 4. 按钮去重

- [x] 4.1 `ResultView.vue` 删除 `recompose-final-button`，仅保留 `recompose-button` 并加 `recomposeHint` 提示（测试：`ResultView.test.js` 更新按钮合并断言）
- [x] 4.2 locales zh/en 移除 `recomposeFinal`/`recomposingFinal`/`recomposeFinalHint`，新增 `recomposeHint`

## 5. 验证与文档

- [x] 5.1 跑相关测试套件（story2video-notifications 56 / story2video-project-service 119 / ResultView 111 / IPC 49 / preload+license 395 / CreateViewHistory 37 / CreateView 283）全部通过
- [x] 5.2 CI check-locale-sync --keys / --cjk 通过
- [x] 5.3 更新 openspec change（proposal/design/specs/tasks 全量，validate 通过）
- [x] 5.4 更新 `.quality-gates.md`
- [x] 5.5 双模型审查（claude + opencode）：claude 0 Critical / 2 Warning / 3 Info；opencode 1 Critical（C1 视频缺失误归图片缺失，已修复）/ 4 Suggestion（S1-S4 已处理）
- [ ] 5.6 提交、推送、创建 PR、CI 通过后合并
