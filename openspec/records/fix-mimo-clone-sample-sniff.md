# 执行记录：fix(story2video) 克隆样本魔数嗅探——改名容器在克隆入口拦截（fix-mimo-clone-sample-sniff）

- **分支**：`fix-mimo-clone-sample-sniff` ｜ **PR**：#4037 ｜ **日期**：2026-10-19 ｜ **复杂度**：S（bug 修复，2 文件 + 3 文档）
- **判定**：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false files=7`（混合 PR：运行时代码 `apps/desktop/electron/services/tts-voice-clone-service{,.test}.js` + CHANGELOG/learnings/PRD/records）→ 完整质量节拍，未走 docs-only 快速通道。

## 触发与类型

- 触发：Bug 反思循环（QM-5 完整 5 步），起因是用户报障「视频创作任务 mvf29iv8_cgll 失败」。
- 变更类型：🐛 Bug 修复（无 UI/架构/DB 面；QM-1 打包豁免——未触碰 `apps/desktop/electron/` 的 require 链/glob 面，属既有文件内增函数与调用点；QM-4 视觉豁免——无前端文件）。

## 事故与根因（调查证据链）

- 任务 `mvf29iv8_cgll`：`story2video-compose`，14 场景，2026-10-19 17:37–17:59。split/scene_context/optimize/select_video_scenes 成功；`generate_assets` 失败：图片 14/14 ✅（agnes-image）、TTS 0/14 ❌——13×`Param Incorrect` + 1×`Too many requests`（429）。
- 证据源：`shared-user-data\run-state\owners\6c90f6c6…\mvf29iv8_cgll.json`（快照 status=failed, currentStage=4）+ `shared-user-data\logs\app-2026-10-19.log`（行 18214–19196）。
- 二进制裁定：克隆样本 `…\f61c3d96-…\sample-01.mp3` 文件头 `00 00 00 18 66 74 79 70 6D 70 34 32`＝`ftypmp42`（MP4/AAC 容器）；ffprobe：`format_name=mov,mp4,m4a,3gp,3g2,mj2`、`codec_name=aac`、duration=29.83s。**扩展名说 mp3，内容不是 mp3。**
- 根因：`_prepareOneSample`（68b890039，2026-08-04）contentType 仅由 `path.extname` 决定；合成时 `asset-generator` 将样本转 `data:audio/mpeg;base64,…` 注入 `audio.voice`，MiMo 服务端按真实容器解码 → 声明 MIME 与容器不符 → `Param Incorrect`，14 场景确定性复现。`Param Incorrect` 的第二种成因（第一种见归档 change `2026-08-23-fix-mimo-tts-param-incorrect`，预置音色默认值），两者独立。

## 修复方案与取舍

- **黑名单式魔数嗅探** `sniffSampleContainerMismatch`：仅拦可可靠识别的容器互串——`.mp3` 内容为 ftyp/RIFF-WAVE/OggS/fLaC；`.wav`/`.m4a` 内容为 ID3 或 MPEG 帧同步等。命中 → `VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED`（复用既有 zh/en 文案），在克隆入口前置拒绝，不触达远端。
- **否证记录（P6 偏向行动 + 事后复盘）**：白名单式强校验第一版当场误伤 13 个既有用例（夹具是 `"audio"`/`"RIFF-test-audio"` 占位字节）。改黑名单：拦截面=已确认故障形态枚举，兜底面=既有 ffprobe 时长探测 fail-closed，零误伤且精确覆盖事故形态。
- 未做：ffmpeg 转码自愈（把假容器转成真 mp3）——超出 bug 修复边界，属新功能立项（涉及转码失败路径、时长阈值、用户提示语），按「最小爆炸半径」原则未纳入。

## QM-5 五步

1. **根因溯源**：68b890039（2026-08-04 feat: automate image carousel and add user tts voices）——首版即扩展名-only。
2. **逃逸链**：单元层夹具全占位字节（格式逻辑不可测）→ 集成层克隆对账两侧同以扩展名为准（同源盲区）→ 真实 provider 层本地克隆成功≠样本可用（错误延迟到合成爆发）→ 审查层 8-23 修复同码未反推其他成因。
3. **系统性漏洞**：音频类测试夹具字节与真实格式零相关（learnings 落条 `validate-audio-container-by-magic-bytes-not-extension`）。
4. **回归保护**：`tts-voice-clone-service.test.js` +2 例（50/50）——「改名容器」三形态拒绝（ftypmp42 假 MP3 / ID3 假 M4A / RIFF 假 M4A，断言不调 adapter、不写 registry）与「真实容器」三形态放行（ID3 头 MP3 / 870B 双静音帧裸 MP3 / RIFF-WAVE）。
5. **预防**：CHANGELOG 未发布段、learnings 新条、PRD §Mimo「数据校验」行补嗅探合同（两处重复段均已更新）。

## 验证与门禁证据

- 定向回归：`tts-voice-clone-service.test.js` 50/50；邻近域 `tts-voice-clone-integrity`(8) + `asset-generator-provider`/`mimo-tts`(122) + `tts-voice-catalog`/`tts-voice-service`(33) 全绿。
- CCG：`verify-quality`（域内仅既有行宽提示，exit 0）、`verify-change --mode staged`（✓ 通过）。
- 会话隔离：`pre-code-edit-guard` 拦截共享根 → `session-init.sh fix-mimo-clone-sample-sniff` 建 worktree → `verify-worktree-deps` OK。
- CI：PR #4037 全量门禁（混合 PR，docs-only=false），合并判据按「PR 自动合并」六条机械核查（见下）。

## 远程同步

| 项目 | 状态 |
|------|------|
| 远程同步 | 由门禁推导 |
