# Rebuttal v1 — 计划方逐条回应

| id | 决定 | 理由/证据 | 落点 |
|----|------|-----------|------|
| P1 | **接受（并冻结决策）** | 评审正确：Phase 1.3 产物必须决策完备。冻结：registry 注册 Remotion 工厂时**组合注入 FFmpegAdapter 工厂**，`RemotionAdapter.render` 内判 `_needs_remotion`，不可用时调 `ffmpeg_adapter.compose()`（注意：现状 remotion-else 走的是 `_compose` 而非 `_render_via_ffmpeg`，故 FFmpegAdapter 须暴露 `render()`/`compose()` 两个内核，降级调后者），RenderResult 照常返回、外壳 ⑦ final_review 位置不变（REM-2 基线锁死该链路）。 | T4 卡 + 架构 §11 附录回写 |
| P2 | **接受** | 复核属实：渲染路径子进程全部经 `self.run_command`（video_compose L610/635/684/855/1777/2396/2468/2521），基类零改动即可捕获。改 VideoCompose 私有覆写，`base_tool.py` 移出 T0 改动清单。 | T0 卡改动文件 |
| P3 | **接受** | compose 与 `_render` 共享 `_compose` 内核（L381/L31 委派路径），既有测试不逐字段断言 cmd，必须补基线。矩阵新增 COMP-1，T0 采集、T3 等价断言。 | §3.1 / T0 / T3 |
| P4 | **接受** | 不复犯前例点名的低估：T0 拆 T0a（接缝+harness，2h）/ T0b（10+1 场景真实环境基线，4h），P0 总量 25h→28h，Buffer 如实重报 ≈42h。 | §1 / T0 |
| P5 | **接受（取方案 a）** | L1 矛盾成立。冻结：**T5 包含 get_info 数据源切换**（`preflight_all()` + `capabilities.notes` 组装），并以"输出逐字段对基线等价"为硬验收——这是架构 §5.4 承诺的单一来源在 get_info 侧的唯一落点，砍掉它等于让 C10 纪律留死角。 | T5 卡 |
| P6 | **接受** | 除外子句收成可执行白名单：`providers/video/`（engines/ 外）禁止出现 `render_runtime` 与引擎名字面量的比较；atelier 短路只允许 `composition_mode/renderer_family` 判定；断言写成 `test_render_engine_capabilities.py` 中的 ast/grep 用例，不留人工裁量。 | T5/T6 验收 |
| P7 | **接受** | facade 空壳审计洞成立：T6 安全用例穿透到 `hyperframes_compose.py` 的真实子进程链（L260 `npm view`、L975 `_run`），验收改写为"含被转调下游工具"。 | T6 卡 |
| P8 | **接受** | 写死：单 worktree 分支**单 PR**；"每片合入"= 片级 commit 过全量 pytest 后进入分支历史、可独立 revert；main 只见最终态，中间态不上 main。 | §1/§4 |

## 净结果
- 8 条全接受（L3 拒绝 0/3）；P1/P2/P5 从"开放问题"升格为计划内冻结决策，Q1-Q3 关闭，Q4 以拆分+重报关闭；总估时如实上调（25h→28h），符合"修订不等于只改措辞"。
