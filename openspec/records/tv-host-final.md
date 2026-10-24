# tencent_video 上传主机恢复为竞品实证值

## 背景
竞品代码（`00-vendor-originals/refproduct/main-dist-index.cjs`）原文：
`$http.put("https://finderassistancea.video.qq.com/applyuploaddfs", …)`，且其 `X-Arguments`
（`apptype=251&filetype=&weixinnum=&filekey=&filesize=&taskid=&scene=`）与本项目 `buildXArguments` 逐字一致。
此前"逆向主机过期"的结论**有误**：直连探测未带鉴权头，返回 404/Parse Error 属探测方法无效。

## 变更
- `CDN_HOST_CANDIDATES` 首项改为 `https://finderassistancea.video.qq.com`
- `uploadpartdfs` 真实运行时使用 `https://finderassistanced.video.qq.com`（注入客户端时保持相对路径，测试不受影响）
- 保留 `cdnHost` 运行时解析作为覆盖项（若平台后续下发则优先）

## 验证
- `shipinhao-video` 单测 15 passed
| 项 | 状态 |
| --- | --- |
| 远程同步 | 由门禁推导 |
