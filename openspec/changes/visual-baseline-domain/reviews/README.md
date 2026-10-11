# QM-6 外部评审原件（替代通道）

- 通道：`opencode run --auto --model opencode/<free>`；标准通道 `codeagent-wrapper --backend codex|claude`
  依赖 CC Switch `127.0.0.1:15721`，2026-10-11 实测 `-Quiet = False`，故记为**偏差**而非「双模型 PASS」。
- 被评审 SHA：`a30e470e56353dbf8aaf3a9681479944a8306cb7`（diff 见 git；本目录只存结论原件）。
  实现评审后又追加了扩域改动，故原件对应的是**评审时点**的 head；扩域本身由前端轴 findings 触发，见 PRD §9。
- `findings-backend.json` = 后端轴 `nemotron-3-ultra-free`；`findings-frontend.json` = 前端轴 `ling-3.1-flash-free`。
- 两份文件**逐字节复制**自评审落盘产物，未经我改写。处置表见 `01-docs/PRD-VISUAL-BASELINE-DOMAIN-2026-10-11.md` §8。
