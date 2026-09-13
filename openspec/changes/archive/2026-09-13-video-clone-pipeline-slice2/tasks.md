# 实施清单（进度唯一来源）

## 阶段 1：OpenSpec 提案
- [x] proposal / design / tasks / spec delta

## 阶段 2：runners 基础层
- [x] runners.js（二进制解析 / spawn / ffprobe 元数据 / scene 检测 / timesToShots / classifyDownloadError / yt-dlp）
- [x] errors.js 新增 VIDEOCLONE_FILE_NOT_FOUND

## 阶段 3：adapters
- [x] ingest-local.js（存在/大小/扩展名/时长/探测 + 错误映射）
- [x] ingest-url.js（下载 + 平台提示 + 错误分类 + 大小上限）
- [x] analyze-ffprobe.js（补探元数据 / 场景检测降级 / ASR 契约 / 7 层骨架 / aspect 派生）
- [x] plan-script.js（层级/模式写入 / 改写契约 / inspiration 模式 / 防御归一化）
- [x] index.js（createDefaultIngest / createSlice2Pipeline）

## 阶段 4：测试
- [x] ingest-local.test.js（7 用例）
- [x] ingest-url.test.js（4 用例）
- [x] analyze-ffprobe.test.js（7 用例）
- [x] plan-script.test.js（6 用例）
- [x] slice2-integration.test.js（2 真实 ffprobe/ffmpeg 集成 + skip 守卫）
- [x] `node --test` 67 用例全绿（含真实 smoke）

## 阶段 5：文档
- [ ] PRD v1.2 §16 切片 2 详细规格 + 错误码表补 FILE_NOT_FOUND
- [ ] CHANGELOG / .quality-gates.md / CCG task
- [ ] commit → push → PR → 合并（远程状态核实）
