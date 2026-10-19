# AI 影视创作开源项目调研 · 审核记录（CCG 双模型 + 对抗性审核）

> 对应报告：[RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md](./RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md)
> 审核机制：CCG 双模型交叉审查（backend 架构/数据/算法视角 + frontend 工程/交付视角）+ adversarial-review-loop 对抗循环
> 产物原始位置：`.adversarial/ai-film-research-2026-10-19/`（该目录被 `.gitignore:422` 忽略，故本文件为可入库的公开记录）
> 日期：2026-10-19
> **状态：已完成三轮对抗循环** —— v1 提案 → 评审 → 回应 → v2 → **实测版评审（两轮，共 45 条）** → v3 修订

---

## 审核结论摘要

> **v3 更新**：并行评审代理陆续返回**实测证据版**（替换 Lead 代写的初稿）。三轮累计 **55 条意见**，第二轮（frontend 18 条）与第三轮（backend 27 条）为**本仓代码实测取证**，击穿了 v2 中多个「看似合理但与本仓现实不符」的判断。

| 项 | 结果 |
|---|---|
| 评审意见累计 | **55 条**（backend 初版 10 + frontend 初版 9 + frontend 实测版 18 + backend 实测版 27，含交叉重叠） |
| 接受 | 54 |
| 部分接受 | 1（ZJT 署名范围，保守处理） |
| **拒绝** | **0** |
| 维度最低分 | v1: backend 6 / frontend 5 → v2: **feasibility 3**（frontend）／**2**（backend） |
| v3 处置 | 全部落实修订 |

### 三轮评审各自击穿了什么

| 轮次 | 性质 | 击穿的问题 |
|---|---|---|
| v1（Lead 自审） | 逻辑自审 | 缺迁移路径、降级策略、门禁标注、验证 spike、防膨胀约束 |
| v2（frontend 实测） | 本仓代码取证 | **ffmpeg 滤镜白名单硬墙**、落点包语言错、路径不存在、F13 现状描述失实、防膨胀需机械锁 |
| v3（backend 实测） | 本仓代码取证 | **prompt-doctrine.json 已存在**（F1 会造第二套规范）、**adelay 公式错**（4.5s 错位）、**F12 绕过成本闸**、**VLM 适配器不存在**、Pixelle TTS 取舍颠倒 |

### 核心教训

**三轮评审无一被拒绝**，且越往后（实测取证）击穿越深。根因是**调研视角与实施视角的系统性落差**：报告评估的是「这个技术在业界成不成熟」，而落地需要的是「这个技术在本仓既有约束下能不能跑」。滤镜白名单、包语言、既有桩、KIT_FILES、prompt-doctrine、成本闸测试锁……**这些只有读本仓代码才知道**。

**最大的单一根因（b13）**：v3 评审指出本报告**几乎没调研 mulpub 自身** —— 已有 `film-kit/prompt-doctrine.json`（7 blocks + 10 rules + 6 glossary，中英双语，UI 已绑定且有同源锁测试）在 1300 行报告里**仅提及 1 次**。这导致 F1 差点造出第二套并存的提示词规范。

**第三章的竞品分析质量被评审认可**（「建议保留」），但**落地章必须建立在对本仓现状的调研之上** —— 这一点初稿做反了：花大力气调研 16 个外部项目，却没调研自己的仓库。

### 本仓现状关键事实（评审实测，供后续实施直接引用）

| 事实 | 证据 |
|---|---|
| 打包 ffmpeg 滤镜仅 11 个，**无 loudnorm/adelay/tpad** | `apps/desktop/scripts/stage-media-tools.js:10-22` |
| 仓内已明文禁止引入 loudnorm | `podcast-episode-tts-adapters.js:89-90`；规范见 `REUSE-CATALOG-2026-10-13.md:536` |
| 成本闸由测试锁死，任何恢复路径须重过闸 | `video-gen.js:279-286` + `film-video-checkpoint-integration.test.js:140-172` |
| **无 VLM 适配器**（KNOWN_METHODS 无视觉方法） | `adapters/_base/base.js:37-50` |
| 批内并发 = **2**（非全并行） | `production-runner.js:14`；`auto-runner.js:156` |
| 已有提示词方法论资产 | `film-kit/prompt-doctrine.json`（7 blocks/10 rules/6 glossary） |
| kit 资产需登记才生效 | `kit-loader.js:20` `KIT_FILES`（4 个硬编码） |
| Scene 已有 `parentId`（树校验+无环） | `kit-loader.js:72-83` |
| `shared-utils` 纯 JS（113 js / 0 ts） | 实测 |
| `audio-aligner` 纯 Python（8 py / 无 package.json） | 实测 |
| `python-backend` 根为 `src/multi_publish/`（无 `app/`） | 实测 |
| `story2video-engine/src` 18 个 .ts 平铺（无 `prompt/` 子目录） | 实测 |
| 本仓 `CreateView.vue` **308,964B**（比报告批评的对象大 2.5 倍） | 实测 |

---

## 一、方案（v2 修订后）

### 目标形态

```
mulpub 影视工程 = 《Hell Grind》工程方法（已有）
                + LuxReal 分镜 Prompt 规则（F1，直接拿）
                + Jellyfish 数据地基（Shot 模型 + 枚举 + 就绪度闸门，直接拿）
                + audio-aligner 三件套（F10/F12/F13，直接拿）
                + 剪映草稿导出（F23，需 spike 验证 + 署名 ZJT）
                + 工程控制机制（F7/F17/F18/F19/F20，重写不抄）
```

### 五批次

| 批次 | 定位 | 项 |
|---|---|---|
| 一 | 数据资产层 | F1-F6 |
| 二 | schema 增强 | F7（locked）、F8（三分 prompt）、F9（视角变体） |
| 三 | 算法与工程机制 | F10-F16 |
| 四 | 智能化增强 | F17-F22 |
| 五 | 专项（需前置验证） | F23（剪映，需 spike）、F24（末帧传递）、F25（场次并发）、F26（外链+SSRF）、F27（Series Bible） |

---

## 二、防膨胀硬约束（v2 新增）

1. **prompt 文本一律外置**为 `.md`/`.json`（套用已有 `film-kit/prompt-doctrine.json` 模式），禁止内联进代码。
2. **新增文件单文件 ≤500 行**，超出必须拆分。
3. **外置 prompt 同样走 kit-loader 的 fail-closed 校验**。

> 依据：报告批评了 novelvids 的 124KB Vue 文件、ai-art-engine 的 338KB NodeGraphEditor、moyin 的 4066 行 tsx。不约束自己就会重蹈覆辙。

---

## 三、门禁清单（v2 新增，逐项标注）

每个 F 标注三列，把泛泛的验收标准变成逐项可执行的门禁：

| 列 | 含义 | 触发的门禁 |
|---|---|---|
| `主进程?` | 是否改 Electron 主进程 | ✅ 则必须 QM-1 打包验证 |
| `文案?` | 是否新增用户可见文案 | ✅ 则必须 i18n zh/en 成对（CI Gate 7） |
| `IPC?` | 是否新增 IPC 通道 | ✅ 则必须 `withSenderCheck` + 入参校验 + PUBLIC_CHANNELS 登记 |

---

## 四、v1 → v2 修订清单（19 条全落实）

| 来源 | 修订 |
|---|---|
| b1 | F8 明确在 `kit-loader.js` 的 `loadFilmKit` 内做一次性归一化 + 回归测试 |
| b2 | F18/F19 口径统一为「按其结构自行撰写，禁止逐句复制原表达」 |
| b3 | F5 改为**扩展现有 `publish-capabilities.json`**，不新建独立目录 |
| b4 | F8b（adelay+amix）**降格为知识库条目**（现有链路用 concat 直拷，无 xfade） |
| b5/f3 | F23 工作量上调为「大」+ 前置 spike + 草稿格式版本号校验 |
| b6 | F17 拆出「核实并接入 VLM 适配器」前置任务；QC 插入点明确为下载后、写 manifest 前 |
| b7 | F24/F25 拆两步（先末帧传递，再场间并发），顺序不可颠倒 |
| b8 | F20 保守署名 + 标注「非法律意见」 |
| b9 | F 编号收敛为线性，增加「状态」列 |
| b10 | 每个 F 增加「现有实现基础」列（新建 vs 扩展已有文件） |
| f1 | F26 定义 DoH 失败降级：回退系统 DNS 但保留私网段硬校验 |
| f2 | 每个 F 增加 `主进程?`/`文案?`/`IPC?` 三列 |
| f4 | 防膨胀三条硬约束 |
| f5 | F15 改为分级提示（阻断级 vs 警告级），非硬性阻断 |
| f6 | F2 定义「公式结果 → 模型档位」就近取整 + 档位拒绝重试 |
| f7 | F26 与「支持外链参考图」合并，若暂不需要则暂缓（避免死代码） |
| f8 | 修正 python-backend 落点为 `src/multi_publish/<模块>/` |
| f9 | 报告增加文档导航章节 |

---

## 五、评审中确认的关键事实（附证据）

| 事实 | 证据 | 影响 |
|---|---|---|
| mulpub 合成用 concat demuxer 直拷，**无 xfade** | `film-render.js:308` `['-f','concat','-safe','0','-c','copy']`，`:12` 注明无转场/调色/字幕 | F8b 降格 |
| mulpub 已有数据驱动能力注册表 | `shared-utils/src/publish-capabilities.json`（15 平台，CJS/ESM 双版本）+ `api-publish-engine/.../capabilities/*` + openspec 规范 | F3b→F5 改为扩展 |
| waoowaoo 的 loudnorm/能力目录**不依赖 Temporal** | `video-merge-audio.ts` 顶部 import 仅 `./ffmpeg-command`；`image-video.catalog.json` 为纯 JSON | 可独立抽取 |
| mulpub 参考图当前为本地上传，**无 SSRF 面** | `film-engineering:upload-reference` 走本地文件 | F26 需与外链功能合并 |
| python-backend 真实布局为 `src/multi_publish/<模块>/` | 实测含 video_creation/prompts/services/core | 落点路径修正 |
| mulpub 视频档位硬编码 5/8/10 秒 | `video-gen.js:41` `FILM_DURATIONS=[5,8,10]` | F2 需定义取整规则 |
| 参考图注入仅 3 家 provider 支持 | `video-reference-inputs.js:30-34` `VIDEO_REFERENCE_PARAM_BY_PROVIDER`（minimax/agnes-video/agnes-multimodal） | F24 末帧传递是硬前置 |

---

## 六、遗留待决（不假装已闭合）

| 项 | 状态 |
|---|---|
| ZJT 署名是否覆盖「重写实现」 | **未定论**，采取保守策略（F20 无论是否构成二次开发均声明来源），标注「非法律意见」 |
| VLM 适配器是否存在 | **待核实**，F17 前必须确认，否则降级 |
| 剪映草稿格式兼容性 | **待 spike**，F23 前必须实测 |
| F26（外链参考图）是否真需支持 | **待产品决策**，若不需要则整项暂缓 |

---

## 七、产物配对（adversarial-review-loop 要求）

| 阶段 | 文件 |
|---|---|
| 提案 v1 | `.adversarial/ai-film-research-2026-10-19/proposal-v1.md` |
| 评审（backend） | `.adversarial/ai-film-research-2026-10-19/critique-v1-backend.md` |
| 评审（frontend） | `.adversarial/ai-film-research-2026-10-19/critique-v1-frontend.md` |
| 回应 | `.adversarial/ai-film-research-2026-10-19/rebuttal-v1.md` |
| 提案 v2 | `.adversarial/ai-film-research-2026-10-19/proposal-v2.md` |
| **公开记录** | **本文件** |

> 注：`.adversarial/` 被 `.gitignore:422` 忽略（项目既有约定，审核过程产物不入库），故上述产物仅在本地留存；本文件为可入库的审核结论公开记录。
