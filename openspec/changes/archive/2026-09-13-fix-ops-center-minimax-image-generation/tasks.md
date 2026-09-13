## 1. 规格与实现

- [x] 1.1 MiniMax 端点/payload/响应解析/业务失败 fail closed（prompt_eval_generation_service.py）
- [x] 1.2 回归测试：端点与 payload 断言、base64 落盘、URL 下载、业务失败、n>9、flux 不变（test_prompt_eval_services.py）

## 2. 验证与交付

- [x] 2.1 pytest tests/test_prompt_eval_services.py + prompt-eval 全量套件通过
- [ ] 2.2 openspec validate + 双模型审查（antigravity/claude 降级则记录）
- [ ] 2.3 推送 codex/ 分支 → PR → 合并回 main → 重启 ops-center 后端
- [ ] 2.4 真实调用验证：生成图片落盘 + 评估（消耗用户额度，先确认意图）
- [ ] 2.5 三同步归档（openspec archive + CCG task 归档 + learnings）
