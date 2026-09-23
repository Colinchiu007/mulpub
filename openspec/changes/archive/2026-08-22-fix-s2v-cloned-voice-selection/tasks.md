# 任务：克隆音色被替换为官方音色

## 1. 规格与实现

- [x] 1.1 minimax-tts `cloneVoice` 检查 `base_resp`，业务错误 fail closed（minimax-tts.js）
- [x] 1.2 `tryReCloneVoice` 移除默认官方音色回退，失败透传原始错误（story2video-stages.js）
- [x] 1.3 回归测试：2038 幻影克隆拒绝 + tryReCloneVoice 不再调用 `retryFn('default')`

## 2. 验证与交付

- [x] 2.1 聚焦测试（minimax-tts / story2video-stages / tts-voice 周边）通过
- [x] 2.2 全量桌面 Vitest（8400 passed）与 QM-1 构建验证通过
- [x] 2.3 openspec validate --strict 通过；双模型审查（opencode + Claude）已调用，wrapper 均不可用，降级记录于 review.md
- [x] 2.4 推送 codex/fix-s2v-cloned-voice-selection → PR #1094 → CI 通过后合并（d2b1b31d）
- [x] 2.5 远程同步核验（origin/main=d2b1b31d）+ CCG 归档
