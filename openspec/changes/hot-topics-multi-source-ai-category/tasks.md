# 任务清单：hot-topics-multi-source-ai-category

> 勾选判据一律取**产物**（文件 / 命令输出 / 测试结果），不取「做过了」的叙述。

## 1. 调研（开源项目 + 端点实测）

- [x] 1.1 抖音 / 小红书：开源项目清单 + 端点实测 + 复用结论 → `01-docs/research/hot-topics-sources-douyin-xhs.md`
- [x] 1.2 今日头条 / 头条号 / 凤凰网：开源项目清单 + 端点实测 + 复用结论 → `01-docs/research/hot-topics-sources-toutiao-ifeng.md`
- [x] 1.3 分类标准与准确性分析（现状 / 根因 / 可借鉴做法 / 优化方案 / 评测方案）→ `01-docs/research/hot-topics-classification-accuracy.md`
- [x] 1.4 头条号「不接入」结论取证（502 + 邀请权限门槛 + GitHub 0 命中 + 同源性无法证实）

## 2. 数据源落地（TDD：先测试后实现）

- [x] 2.1 抖音：`parseDouyin` 支持三端点同构（`word_list` + `trending_list`、顶层 `word_list`、`position`、`sentence_id`）
- [x] 2.2 抖音：`CHANNEL_CONFIGS.douyin` 补全查询参数 + `fallbacks` 顺序降级链（不使用独立渠道 id）
- [x] 2.3 小红书：`parseXiaohongshu` + `parseCnNumber`（`947.5w` → 9475000）
- [x] 2.4 小红书：渠道配置含六项固定头（`shield` 抽为集中常量 + 注释说明轮换风险）
- [x] 2.5 凤凰网：`parseIfeng`（`link.url`）+ `parseIfengInline`（花括号配对取 `allData`）
- [x] 2.6 今日头条：`parseToutiao` 字段修正（`InterestCategory[0]` 优先、`Category` 回退、`ClusterIdStr` 拼 URL）
- [x] 2.7 scorer：新增渠道权重 `xiaohongshu=1.0` / `ifeng=0.95`
- [x] 2.8 渲染层：`HotTopics.vue` `CHANNEL_KEYS` + locales zh/en 渠道文案（成对）
- [x] 2.9 合同：空列表视为失败 + fallback 顺序降级 + 406 专项告警
- [x] 2.10 测试：`hot-topics-new-sources.test.js`（18 例）覆盖解析器 + 渠道配置 + 三条新合同

## 3. AI 分类落地

- [x] 3.1 `classifier.js` `CATEGORY_KEYS` 新增 `ai`（紧随 `tech`）+ AI 词表（strong/weak）
- [x] 3.2 主进程 `content-categories.js` 内置 11 类
- [x] 3.3 渲染层 `features/content/content-categories.js` 内置 11 类
- [x] 3.4 `HotTopics.vue` `CATEGORY_KEYS` 同步
- [x] 3.5 `ops-center` `CATALOG` 新增 `ai` 并修正 `tech` 描述
- [x] 3.6 locales：`content-categories/{zh,en}` + `hot-topics/{zh,en}` 的 `ai` 文案（成对）
- [x] 3.7 `CATEGORY_BOOSTS.ai` + `onlyCategory` 分类器筛选（修「补拉静默无反应」）
- [x] 3.8 跨端一致性测试（渲染层内置 key 与分类器 `CATEGORY_KEYS` `toEqual`）

## 4. 归类准确性优化

- [x] 4.1 `RAW_CATEGORY_WEAK_MAP` 宽泛桶（B站「知识」、微博/B站「科学科普」、「汽车」等）
- [x] 4.2 `DOMAIN_LEVEL_RAW` 域级泛称（科技/互联网/科学科普/知识/资讯/热点）不参与裁决
- [x] 4.3 strong/weak 词表重构 + `STRONG_MULT` + `MIN_SCORE`
- [x] 4.4 `_matchesLatin` 拉丁词边界（修 `AI` 命中 `Air`/`said`）
- [x] 4.5 `normalizeForMatch` 全角 ASCII 归一（`ＡＩ` → `AI`）
- [x] 4.6 `general` 语义收窄（有真实分类则剔除 `general`）
- [x] 4.7 `_collectBoostChannel` 分类归属修正（先分类器，general 才兜底 `boostCategory`）
- [x] 4.8 词表修补：`上市` 降级为 weak + 新增 `新股`/`上市公司`/`CPI`/`物价`/`折叠屏`/`谈恋爱`
- [x] 4.9 测试：`classifier.test.js`（32 例，含 6 条根因反例）+ `hot-topics-boost-classify.test.js`（6 例）
- [x] 4.10 既有契约测试同步更新（`科技` 域级泛称、`汽车` 归综合、`科学科普` 归综合、AI 独立成类）

## 5. 文档

- [x] 5.1 研究报告 `01-docs/RESEARCH-HOT-TOPICS-MULTI-SOURCE-2026-10-12.md`
- [x] 5.2 PRD + 实施方案 `01-docs/PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md`
- [x] 5.3 openspec change 五件套（proposal / design / tasks / spec delta / .openspec.yaml）
- [x] 5.4 `CHANGELOG.md` 顶部条目（显式 CRLF 只拼头部，整文件零裸 LF）
- [x] 5.5 `01-docs/PRD.md` 追加指针段（`git diff --numstat` = 32/0，纯追加）

## 6. 质量节拍与验证

- [x] 6.1 定向测试全绿（8 个相关测试文件 → 197 例；全量 380 文件 7276 例 + 1 skipped）
- [x] 6.2 `ops-center/backend` pytest（`tests/test_content_categories_api.py` → 7 passed）
- [x] 6.3 `node .github/scripts/check-locale-sync.js`（pair-base / keys / cjk 三项）+ `node scripts/check-no-brand-residue.js`
- [x] 6.4 eslint（18 个改动文件，exit 0）
- [x] 6.5 QM-1 打包验证（`electron-builder --win --dir` rc=0）+ asar 清单 + require 链 + 启动冒烟（经 interactive 会话，零禁用标记）
- [x] 6.6 `.quality-gates.md` 记录 + `scripts/gate-record-debt-ledger.json` 登记 + 记录文件 `sync_*` 三字段（`check-gate-record-debt.js` rc=0）

## 7. 记忆沉淀

- [x] 7.1 外部记忆：`01-docs/learnings.md` 新章节 4 篇（置顶、CRLF 保真）
- [x] 7.2 外部记忆：gstack `learnings.jsonl` 追加 3 条（149 → 152 行，逐行 JSON 合法）
- [x] 7.3 EverOS：`add`（accumulated）→ `flush`（**extracted**）+ **读回验证**（episode/atomic_fact 落盘产物 grep 哨兵词 6/7 命中）
- [x] 7.4 内置记忆：DSH 会话档（harness 自动落盘，无写 API，不伪造文件）

## 8. 交付

- [ ] 8.1 提交 + 推送远端分支
- [ ] 8.2 创建 PR（正文含改动清单 / 验证证据 / 未完成项）
- [ ] 8.3 CI 全绿后 squash 自动合并 + 删除远端分支
- [ ] 8.4 回填 `.quality-gates.md` 远程同步状态 + 销账（与登记项同一次提交删除）
- [ ] 8.5 worktree 按 R1-R5 清理（`scripts/safe-worktree-remove.ps1 -WhatIf` 干跑通过后再实跑）
