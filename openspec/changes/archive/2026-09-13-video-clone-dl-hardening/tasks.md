# 实施清单

## 阶段 1：OpenSpec 提案
- [x] proposal / design / tasks / spec

## 阶段 2：实现
- [x] analyze-ffprobe.js：maxDurationSec（默认 1800）+ 探测后校验 → FILE_TOO_LONG
- [x] scripts/video-clone-dl-probe.js（npm run dl:probe）
- [x] package.json test script 追加 dl-probe

## 阶段 3：测试
- [x] analyze 时长上限 3 用例（超限/自定义/不拦截）
- [x] dl-probe.test.js（VC_DL_TEST_URL 门控，默认 skip）
- [x] engine 全量 103（102 pass + 1 skip）

## 阶段 4：文档与交付
- [ ] PRD v1.9 §23 / CHANGELOG / .quality-gates / CCG task
- [ ] commit → push → PR → 合并
