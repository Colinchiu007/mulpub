# 任务清单：补正头条号登录期观测的覆盖面

> 分支：`login-observe-coverage` ｜ Worktree：`<worktree>/mp-login-observe-coverage`
> 变更 ID：`login-observe-domain-coverage`

## 1. 取证（先取证据，再动手）

- [x] 1.1 从 `https://mp.toutiao.com/` 抓登录页 HTML，列出静态引用的全部资源域
- [x] 1.2 与上一刀的监测域清单（10 条）逐条比对 ⇒ 定位缺 2 条
- [x] 1.3 对缺的两条做首包/体积实测（验证码入口 77,476 B，冷 2.65~2.96s / 命中边缘 0.13s）
- [x] 1.4 取第二轮 DNS 解析形态，确认这些域的解析结果与本机链路形态
- [x] 1.5 确认漏点的机制：① 域不在清单 ⇒ 进不了 webRequest 过滤面；② 路径形态不匹配锚点

## 2. TDD（红灯先行）

- [x] 2.1 用例「真实登录页的验证码入口（rc-verifycenter 形态）被判为验证码组件」——含 rc1/rc2 两个冗余节点
- [x] 2.2 用例「验证码组件新形态不得泛化」——三条泛化反例
- [x] 2.3 用例「头条监测域必须覆盖真实登录页用到的风控与验证码域」——含过滤面与 `isMonitoredHost` 双向断言
- [x] 2.4 跑出红灯：**2 failed / 63 passed**（修正一条弱负例后）
- [x] 2.5 实现：监测域 +`yhgfb-cn-static.com` +`bytetos.com`；新增 `CAPTCHA_SDK_DIR_MARKER` / `CAPTCHA_SDK_SEGMENT` 与组合判定分支
- [x] 2.6 跑绿灯：**101 passed**（2 个文件）

## 3. 变异反证（证「新判据不是碰巧绿」）

- [x] 3.1 M1 监测域去掉 `yhgfb-cn-static.com` ⇒ CAUGHT
- [x] 3.2 M2 监测域去掉 `bytetos.com` ⇒ CAUGHT
- [x] 3.3 M3 组合锚点去掉 `/captcha/` 段 ⇒ CAUGHT
- [x] 3.4 M4 组合锚点去掉 `/sec_sdk_build/` 段 ⇒ **首轮 ESCAPED** ⇒ 见 §4
- [x] 3.5 M5 监测域匹配恒 false ⇒ CAUGHT
- [x] 3.6 M6 真实验证码入口锚点整体失效 ⇒ CAUGHT
- [x] 3.7 还原后源文件 md5 与跑前逐一相等

## 4. 变异反证暴露的测试缺口（M4）

- [x] 4.1 定位：原负例 `…/other-captcha/@latest/captcha.js` 的路径里**没有真正的 `/captcha/` 段**
      （末尾是 `captcha.js`）⇒「去掉 `sec_sdk_build` 条件」它也不变 ⇒ 钉不住
- [x] 4.2 补强负例：`…/obj/some/other/dir/captcha/index.js`（真含 `/captcha/` 段、不在版本目录下）
- [x] 4.3 补强后 M4 ⇒ **CAUGHT**，M1~M6 全 CAUGHT
- [x] 4.4 在用例里留注释说明这条负例为何必须含真正的 `/captcha/` 段（防后人再改弱）

## 5. 回归与门禁

- [x] 5.1 本刀相关 9 个测试文件：**273 passed / 0 failed**
- [x] 5.2 `node .github/scripts/check-max-lines.js` ⇒ 无新增超大文件
- [x] 5.3 `node scripts/check-doc-abs-paths.js --base=origin/main` ⇒ PASS
- [x] 5.4 `node scripts/check-no-brand-residue.js` ⇒ PASS
- [x] 5.5 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ 判定与预期一致

## 6. 文档

- [x] 6.1 PRD §5.5 监测域与验证码形态补正
- [x] 6.2 PRD 新增 §5.6「观测面覆盖补正」：动因（两处同时漏）/ 判据（组合锚点三行对照表）/ 不做什么
- [x] 6.3 排障手册 §1.1 复测读数（把「谁的锅」再拆细一层）
- [x] 6.4 排障手册 §3.2 标注清单已于 2026-10-22 补正（10 → 12 条），域清单仍不进仓内文档
- [x] 6.5 排障手册 §五 改为「应用侧已做的三件事」
- [x] 6.6 openspec change：proposal / design / tasks / `specs/desktop-logging/spec.md` 增量
- [x] 6.7 执行记录 `openspec/records/login-observe-coverage.md`
- [x] 6.8 `CHANGELOG.md` 前置本刀条目

## 7. QM-6 外部双家族评审

- [ ] 7.1 critic=claude / proposer=opencode（`scripts/deep-review.sh`）
- [ ] 7.2 逐条裁决（`adjudication.json`）
- [ ] 7.3 高危域填 externalReview 三格（performedBy / evidenceRef / reviewedAt）
- [ ] 7.4 评审记录落 `self_play_resolved`

## 8. PR 与合并

- [ ] 8.1 提交（pre-commit 判 mode 与 tier）
- [ ] 8.2 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ rc=0
- [ ] 8.3 开 PR；`node scripts/check-main-red.js --pr <n>` 不得 rc=2/3/4
- [ ] 8.4 `gh pr checks` 零 pending/fail；mergeable=MERGEABLE
- [ ] 8.5 squash 合并 + 删分支
- [ ] 8.6 合并后回读主干 push（读数写 PR 评论，不写回仓库文件）
