# -*- coding: utf-8 -*-
"""creator_sign — 博主监控多平台请求签名服务（PRD-CREATOR-MULTI-PLATFORM-2026-10-12 §3/§6）。

薄封装原则：本包只做「端点 + 参数校验 + 调算法库」，**不实现签名算法本身**：
  - 小红书：pip 依赖 `xhshow`（MIT，https://github.com/Cloxl/xhshow）；
  - 抖音：`abogus.py`（本包内自包含移植，Apache-2.0 算法，来源
    https://github.com/Evil0ctal/Douyin_TikTok_Download_API src/dtk/signing/native/abogus.py）。

为什么放 python-backend 而不是 Node：算法随平台升级频繁变动，Python 生态的
纯算法实现更新最快（MediaCrawler/Evil0ctal/xhshow 三家都是 Python 优先）；
Node 侧只做「组 URL/Cookie → 取签名 → 发请求」，算法升级不跨语言。
"""
