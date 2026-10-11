---
record: podcast-episode-publish
task: 刀 3 前两片——成片降级判定 + 混音抽取实测 + 出期编排收口（依赖全注入，零真实出站）
date: 2026-10-11
sync_reason: 待 PR 合并后按产物取证（state=MERGED + mergeCommit.oid、远端分支 0 行、git log 恰好 1 行、squash 后比树为空）并就地回填
sync_backfill_owner: podcast-episode-publish 分支作者（本会话）
---

# 刀 3 前两片（成片 → 一期：判定与收口）

## 这一片在做什么，以及为什么这样切

刀 2 结束时，一键发布只能推「已经是公网直链」的单集；成片（本工具最主要的产出）进不了播客链。刀 3 要补「成片 → 一期」这一段。这一段跨 5 个真实副作用（起 ffmpeg、起 ffprobe、一次 OSS PUT、`episodes.json` 一次读改写、`feed.xml` 一次重建 + 一次 PUT），任何一处接错都会留下**不可逆的外发**或**公网与本地长期不一致**。所以先立「判定与收口」层：把拒绝点、相位闭集、取消窗口、三处一致校验和 partial 分层全部写成可测的纯逻辑，把真实宿主与网络留在注入边界之后。这样第 3 片接真物时，需要新写的只有「转发」，判据一行都不用改——这也是刀 2 事后评审点名的 over-claim 形态的解药：**先把不可逆动作的判据说清楚，再去接那个动作**。

## 关键判断（为什么这么修，不是改了什么）

1. **降级判定只认 `degraded === true`，不认 `source`**：静音占位旁白的 `source` 里也可能写着模型名，用字符串判会同时犯两类错——把占位当可用音轨放行（用户把静音发上公网），以及把真旁白误杀。判据必须与结果页的降级徽标同源，否则「界面说这是占位、发布说可以发」是同一屏上的两句话。
2. **取消窗口精确停在 `uploadAudio` 之前**：之前零出站零计费，回滚＝删临时文件；之后取消会造出「对象存储有这一期、公网 feed 没有」的半态，比不取消更糟。所以 `cancellableAt(phase)` 是编排层的判据而不是界面猜的，界面据此决定按钮可点与给出理由。
3. **三处一致校验收口在挂期之前**：`fs.stat` == ffprobe == `putObject` 返回的字节。任一处不符就不挂这一期——公网 feed 引用一个尺寸错的文件，订阅端会长期表现为「下载卡在 99%」，而本地一切看起来都成功，这是最难归因的一类故障。
4. **partial 与 failed 分层不压平**：feed 上传失败时这一期在本地已经登记成功。压成 failed 会诱导用户删掉这一期重来（而这一期本地是对的），所以编排层如实回 `state:'partial'` 并带一句「这一期已登记到本地频道，公网 feed 尚未更新」。这与刀 2 的 `writeFeedSync` 失败态是同一套两级事实（本次动作结果 vs 重启后真源）。
5. **缺任一注入实现即抛，绝不默认发真实出站**：编排器要求 `extractEpisodeAudio` / `uploadImpl` / `episodeSink` / `feedSink` 四个都齐。少一个就默认去拿真实宿主，等于把测试环境变成出站环境——本仓的零出站纪律靠这一条在具体调用点兑现，而不是靠约定。

## 远程同步

| 远程同步 | PENDING | 待 PR 合并后回填 `PASS` + merge SHA（取证：`gh pr view <n> --json state,mergeCommit`、`git log origin/main --grep="(#<n>)$" --format=%H|%cI`、`git ls-remote --heads origin podcast-episode-publish` 0 行、squash 后比树为空），并在同一次提交删除 frontmatter 两个 sync_* 字段与 ledger 登记项 |
