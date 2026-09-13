# 设计：analyze CLI

- 输入分派：https:// → createUrlIngest（tmpDir=outDir，媒体保留）；本地路径 → createLocalFileIngest（不复制源文件）。
- 分析：createFfprobeAnalyze（maxDurationSec 默认 1800，sceneThreshold 0.3）。
- 产物：report.json（JSON.stringify(CloneReport)）+ summary.txt（源/媒体/时长/分辨率/画幅/镜头/场景方法/校验/ASR 状态/耗时/产物路径）。
- 退出码与错误输出对齐 engine 错误码；无参/本地文件不存在 → 用法错误 exit 2。
- 默认 outDir = cwd/video-clone-output，--out 覆盖。
