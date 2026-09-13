# lint-gate-error-zero 规格（目标 capability：ci）

## ADDED Requirements

### Requirement: ESLint error 级 CI 门禁

quality-gate.yml 的 static-gates job SHALL 包含一个 ESLint 门禁步骤（Gate 11），对 `apps/desktop` 的 `electron/` 与 `src/` 执行 `eslint --quiet`，任何 error 级告警 SHALL 使门禁失败。该门禁 SHALL 与本地 `pnpm run lint` 同口径；warning 级告警 SHALL NOT 阻断（观察期经 `pnpm run lint:warnings` 查看，后续以 per-rule 基线棘轮单独治理）。

#### Scenario: error 级告警阻断合并
- WHEN PR 引入任一 ESLint error（如未导入标识符、空 catch 块、rethrow 未挂 cause）
- THEN Gate 11 以非零退出码失败，PR 不可合并

#### Scenario: warning 级不阻断
- WHEN PR 仅新增 warning 级告警（如 no-var、no-unused-vars）
- THEN Gate 11 通过，warning 由后续基线棘轮治理

#### Scenario: 生成物不参与 lint
- WHEN eslint 扫描 `electron/`
- THEN esbuild 生成物（`electron/preload/**/*.bundle.js`）被 eslint.config.mjs 全局 ignores 排除，不产生任何告警

### Requirement: ESLint 门禁接入前 error 清零

门禁接入 SHALL 以「存量 error 清零」为前置条件（2026-09-14 基线：17 个 error，含 4 个 no-undef 真实功能缺陷）。修复 SHALL 保持行为语义：no-undef 修复 = 补齐真实依赖的导入/解构；preserve-caught-error = rethrow 补 `{ cause }`；no-useless-assignment = 移除无用初值（数据流不变）；no-empty = 空 catch 补注释；有意使用控制字符正则的清洗逻辑 SHALL 以带说明的行内豁免处理。

#### Scenario: no-undef 均为真实缺陷时按缺陷修复
- WHEN no-undef 指向未导入但业务依赖的标识符（如 notifyInfo、EC、PLATFORM_ACCOUNT_INFO_SELECTORS）
- THEN 修复方式是补齐导入/解构（而非删除调用），并为原缺陷行为补回归测试

#### Scenario: 回归测试覆盖
- WHEN 任一 no-undef 真 bug 被修复
- THEN 存在对应回归测试（notify 兜底封包 / extractAccountInfo 选择器注入 / AutoPipelineView resume-cancel 通知 / StageProgress 活动阶段索引），且全部通过
