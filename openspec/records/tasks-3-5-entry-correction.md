---
record: tasks-3-5-entry-correction
task: 纠正 #3519 写进主干的假账——3.5 两枚入口其实都已交付（ResultView 走 PodcastEpisodeEntry）
date: 2026-10-14
---

# 3.5 入口账目更正（tasks-3-5-entry-correction，2026-10-14）

## 错的是什么

上一条对账片（#3519）把 `3.5②` 写成「`ResultView.vue` **尚未挂**该组件」，并把「半落」当成一条实测结论写进了主干。实测真值：`ResultView.vue:65` 挂着 `<PodcastEpisodeEntry :project :segments :video-path />`，`:448` import、`:479` 注册，而该组件第 4 行就是 `{{ t('podcast.episode.entry') }}`——**入口在位，两枚都已交付**。

## 根因（不是运气，是方法）

**判"某个能力入口是否接上"时用了单个组件名当字面量。** 同一能力在两个视图里承载件不同（创建页 `PodcastPublishAction` 是浮层本体，结果页 `PodcastEpisodeEntry` 是入口件），所以按其中一个名字扫必然在另一个上得到 0 命中，而「0 命中」看起来完全像证据。这是 learnings 里「字面路径 grep 找不到 ⇒ 断言没人负责装」的同型错误，且是**第二次犯在同一个对象上**（上一次是钩子安装链路）。

## 改法

1. 判据换成**按能力字面量扫**：`t('podcast.episode.entry')` 这个键在各视图/组件的可达性，而不是某个 `.vue` 文件名；
2. `3.5①` / `3.5②` 都勾成 `[x]`，并在 `②` 的行内**保留"曾被误判为未落"的痕迹与正确出处**（不是悄悄改掉，悄悄改掉会让下一个会话看不出这条账曾经错过）；
3. 旧记录 `tasks-3-4-3-5-audit.md` 追加一段带日期的更正，**原文一字不删**。

## 门禁

- docs-only：只动 `openspec/**` 与三个顶部载体；运行行为零变更
- 行尾对账两口径必须相同；ledger 键＝剥掉 `## ` 前缀的标题文本

## 远程同步

| 远程同步 | PASS | merge SHA e7840a0c2 · 2026-10-14T01:50:56Z · 远端分支已删（ls-remote 0 行）· 同次提交删除 ledger 登记项 |
