# 基线 vs 现状差异审计（tasks 1.3）

> 旧三栏页（`/film-engineering/classic`，`FilmEngineeringView.vue`）已交付能力清单，
> 对照短剧画布（`/film-engineering`，`FilmCanvasView.vue`）的功能对齐状态。
> 审计基线：v1 合并 commit `15ad0e1681`（PR #2342）+ v2（3.3/5.2/5.3/7.4）。

## 对齐基线表

| # | 经典三栏能力（选择器/通道） | 画布对齐状态 | 说明 |
|---|---|---|---|
| 1 | 分镜库浏览：场景树 + 分镜卡 + 分页加载（`.fe-scene-node`/`.fe-shot-card`/`fe-load-more`） | ⃠ 由经典页承载（有意后置） | 画布定位「一个剧本→成片」正向流水线；既有工程库浏览非画布 MVP 路径 |
| 2 | 复制：单镜 full 模式 + 选中批量（`fe-copy-selected`、`copyText(shotId,'full')`、copyMode 选择器） | ⃠ 由经典页承载 | 复制为运营辅助动作，不进画布核心链 |
| 3 | 导出 JSON / Markdown（`fe-export-json`/`fe-export-markdown`） | ⃠ 由经典页承载 | 同上 |
| 4 | 图片生成入口（`fe-generate`，≤20 镜，`generateSelected`） | ⃠ 由经典页承载 | 画布 `fcv-generate` 走分镜**视频** pipeline（useFilmVideoGen），非图片通道 |
| 5 | 剧本套用 adaptScript（含 LLM 润色开关） | ✅ 画布 `fcv-adapt` + `fcv-script` + `fcv-llm` | v1 已对齐；v2 补 3.3 LLM 降级回显 |
| 6 | LLM 降级回显（llmEnhanced=false） | ✅ v2 新增：`canvas.adapt.llmFallback` warning（非阻断） | 经典页无此提示，属画布增强 |
| 7 | 参考图上传（`uploadReference` IPC） | ✅ 画布 `fcv-upload-character`/`fcv-upload-scene` + 连线注入 `localReferences` | 画布独有交互（连线即注入），经典页仅面板上传 |
| 8 | 视频生成成本闸（confirm/cancel，确认前零调用） | ✅ 画布 `fcv-cost-dialog`（同 `useFilmVideoGen` 通道） | D2 合同一致 |
| 9 | 失败单镜重试（`film-engineering:retry-shot`，prompt 从 run 快照逐字取） | ✅ v2 新增：ShotNode failed 态重试按钮 → `retryShot(index)` | `findShotResultIndex` fail-closed 定位，通道失败回显 `canvas.retry.failed` |
| 10 | 成片打开文件夹 / 另存（`story2videoShowInFolder`/`story2videoSaveAs`） | ✅ v2 新增：done banner `fcv-open-folder`/`fcv-save-as` | 复用 story2video reveal/save 合同，画布此前只有跳转经典 |
| 11 | 合成 production 面板 + 回收下载（`fe-production-*`/recycle） | ⃠ 由经典页承载 | 生产级运维功能，后置（v3 评估） |
| 12 | 提示词方法论 doctrine | ⃠ 由经典页承载 | 静态知识面板，画布以引导文案替代 |
| 13 | 画布持久化（图状态序列化复原） | ✅ 画布独有（6.1） | 经典页无此概念 |

## 结论

- 画布核心链「剧本文本 → 拆分镜 → 参考图连线注入 → 成本闸 → 逐镜出片 → 单镜重试 → 成片取用」v2 起**全量闭环**。
- 未对齐项（1/2/3/4/11/12）均为**有意后置**而非遗漏：画布只承载正向创作流水线，运营/运维辅助功能由 `/film-engineering/classic` 回退入口保留，路由与菜单未删除。
- E2E（7.4）：`test:e2e:film-engineering` 已适配双段结构——画布主流程（拆分镜落节点/生成入口）+ 经典段全量保留；像素基线因新增元素均 v-if 条件渲染，idle 状态基线不受影响。
