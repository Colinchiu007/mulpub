# lint-gate-error-zero

## Tasks

- [x] 1. no-undef 真 bug 修复 ×4：AutoPipelineView.vue（补解构 notifyInfo）、notify.js（EC→ERROR）、account-manager.js（补导入 PLATFORM_ACCOUNT_INFO_SELECTORS）、StageProgress.vue（data 键去掉 `_` 保留前缀并同步引用）
- [x] 2. preserve-caught-error ×4：account-manager.js / full-auto-pipeline.js / pattern-extraction-service.js / llm-tag-generator.js 的 rethrow 补 `{ cause: e }`
- [x] 3. no-useless-assignment ×4：knowledge-library-service.js / logger.js / rpa-view-platforms.js / video-clone/asset-generator.js 去掉无用初值
- [x] 4. no-empty ×3：services/asset-generator.js 两处空 catch 补注释；生成物 index.bundle.js 一处随 ignores 排除
- [x] 5. no-control-regex ×1：compliance-filter.js 有意匹配控制字符的清洗正则带说明豁免
- [x] 6. lint 配置：eslint.config.mjs ignores 排除 `electron/preload/**/*.bundle.js`；lint/lint:fix 去掉 `--no-ignore`；新增 `lint:warnings`
- [x] 7. 回归测试 ×4 组：notify-handler.test.js（新）、account-manager-extract-info.test.js（新）、AutoPipelineView.test.js（新）、StageProgress.test.js（追加）——34 用例全绿
- [x] 8. CI：quality-gate.yml static-gates 新增 Gate 11 - ESLint (error-level gate)；本地跑通 workflow-contract.test.js（19 pass）
- [x] 9. 全量验证：`eslint --quiet` 0 error、`tsc --noEmit` 0 error、check-debt-budget / check-locale-sync --cjk / check-frontend-consistency / check-hardcoded-secrets 全 PASS
- [x] 10. 文档：CHANGELOG 头部条目 + .quality-gates.md 本次执行记录
- [x] 11. PR + CI + 合并 + 归档
