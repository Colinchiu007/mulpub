# Tasks: 官方 Key 迁移进 AES-256-GCM 信封体系

> 实现进度以本文件 checkbox 为**唯一来源**（`openspec status --change compute-key-envelope-migration`）。
> 依赖关系：1 →（2 ∥ 3）→ 4 → 5 → 6 → 7 → 8；第 9 组随各步同步。
> 评审处置已折入对应任务（来源见 `review-responses.md`）。

## 1. 前置固化（本 change 的规格层）

- [ ] 1.1 锁定 v1 AAD 材料为 `official|<provider>|<keyRowId>`，并在规格写明"扩展走 `v='official-key/2'` 升级、不得就地改 v1 材料"（评审 i1 → D10）
- [ ] 1.2 锁定格式族标识取值（`v` 独立、`alg` 与算法常量共用），并写成"先校验 `v` 再解"的判据（评审 i4 → D2）
- [ ] 1.3 锁定迁移文件名 `006_official_key_envelopes.sql` 与台账口径；写明 `allowPending:false` 导致"加文件与执行必须同批部署"（评审 i8）
- [ ] 1.4 定案 Open Question 2（官方 Key 面是否要求生产必须 `provider === 'keyring'`；若是，先定义"如何判定生产"），并写明两种取值的后果差异（评审 i7 → D12）
- [ ] 1.5 定案 Open Question 1（环文件托管与轮转流程；官方 Key 与云端凭证是否共用同一个环）（评审未提，主代理自审补）
- [ ] 1.6 定案 Open Question 4 的**优化**（若 `provider_plans` 在本 change 步骤 3 前定型为"同 provider 多套餐"，直接以 v2 起步）——**非前置**

## 2. Node 侧信封模块（交付目标）

- [ ] 2.1 新增 `packages/api-publish-engine/src/cloud-accounts/official-key-envelope.js`：封印/解封/只读 verify；`v` 独立、算法常量与 `envelope-crypto.js` 同源 import；AAD = `official|<provider>|<keyRowId>`；keyId = `official:<provider>`
- [ ] 2.2 单测（正常往返 / 跨 provider 替换必失败 / 跨行替换必失败 / `v` 不匹配拒绝 / KMS 缺失抛错）
- [ ] 2.3 结构锁：两个信封模块的 IV/tag/DK 常量同源（**扫描域收窄到这两个文件**——`keyring-kms.js:38-40` 的既有重复声明不在本次收口，见评审后 R12）
- [ ] 2.4 结构锁：`api_key=encrypt_key(...)` 全仓只允许出现在 `ops-center/backend/services/key_service.py`（判据取自评审 i6 的实测：当前唯一写入点 `:269`）
- [ ] 2.5 KMS 获取复用 `createKmsFromEnv`；锁断言不出现第二处"用哪个 KMS"的判断

## 3. 表结构与迁移文件（可与第 2 组并行）

- [ ] 3.1 `migrations/postgresql/006_official_key_envelopes.sql`：建表 `official_key_envelopes(key_id UNIQUE FK → official_keys.id **ON DELETE CASCADE**, v, alg, iv, ciphertext, tag, encrypted_data_key, created_at)`；文件必须有事务外壳（`MIGRATION_TRANSACTION_ENVELOPE_INVALID` 判据）。**FK 级联为评审 round 3 的 i4 补项**——否则删官方 Key 行会留孤儿信封，且骨架的 SQL 内不得含 BEGIN/COMMIT
- [ ] 3.2 迁移单测：`discoverMigrations` 能识别该文件名（匹配 `MIGRATION_PATTERN`）；对已应用台账做一次 checksum 校验通过
- [ ] 3.3 部署顺序核对：确认"加 006 文件"与"执行 006"同批，避免 identity 仓储因 `allowPending:false` 启动硬失败

## 4. Python 侧信封读取 + 双写双读

- [ ] 4.1 Python 侧信封读取实现（AES-256-GCM + 密钥环 unwrap 同构解析，含密钥 id 前缀）——**前提性任务：评审 i2 已证三条管理面读路径需要明文**
- [ ] 4.2 双写：新增/更新官方 Key 时同时写信封与新表、并保留 `api_key`（`api_key` 为 `NOT NULL`，见 `models.py:122`）
- [ ] 4.3 双读：信封优先、Fernet 兜底；**兜底必须出声**（warn + 计数），计数需可观测
- [ ] 4.4 Python 侧测试：reveal / 掩码未变更比对 / 连通性测试三条路径在信封格式下可用；两格式不一致时以信封为准并记漂移
- [ ] 4.5 **跨语言对拍测试（评审 round 2 的 i4）**：固定 DK/iv/明文，**Node 封印→Python 解封**与**Python 封印→Node 解封**双向逐字节一致；密钥环包裹格式（id 前缀 + iv + tag + 密文）双向解析一致；**必须进 CI**，不得只本地跑
- [ ] 4.6 对拍的反向断言：把 Python 侧 AAD 材料改一位 ⇒ 对拍必须变红（证明不是同义反复）
- [ ] 4.7 明文处置按 D7 修正版落地：常规路径明文不出模块；`reveal=True` 为**显式例外**（仅 admin + 写审计 + 不记明文 + 不被缓存留存）；掩码比对用后清零
- [ ] 4.8 **（评审 round 3 的 i1）KMS 选择语义的声明式真源**：把「环境状态 → 期望 provider」做成随 change 入库的判定表（含空白/缺失/双缺边界）；JS 与 Python 两侧**各自对该表**断言；防漂移锁扫描域扩为「两个 JS 信封模块 + Python 选择实现」
- [ ] 4.9 **（评审 round 3 的 i5）密钥环字节解析做成纯函数**：输入输出皆字节、不读环境变量；对拍注入字节样本 ⇒ 在无密钥环的 CI 中也可跑
- [ ] 4.10 **（评审 round 3 的 i6）回调式明文入口** `withKey(keyRowId, cb)`：明文只在回调作用域内有效，不得序列化/外泄/缓存；两个真实调用点（服务端代调、`model_preset_service` 连通测试）必须经它完成

## 5. 存量迁移 CLI

- [ ] 5.1 CLI 骨架：`--dry-run` / `--only` / `--batch` / `--continue-on-error`（默认为 **fail-fast**，评审 i3）
- [ ] 5.2 启动前 KMS 自检（`wrap` + `unwrap` 随机 DK 往返）——不过即整批拒绝启动
- [ ] 5.3 单行原子迁移（解密 → 封印 → 写入 → 回读校验明文一致 → commit）
- [ ] 5.4 幂等与续跑测试：重复运行零写入；停机后续跑只处理缺信封行
- [ ] 5.5 失败语义测试：单行失败停机 + 该行无半成品；停机后所有行仍可读（双读）
- [ ] 5.6 CI KMS 注入：确认在 `MP_CLOUD_KMS_LOCAL_KEY` 下迁移逻辑可被测试（评审 i7）
- [ ] 5.7 **（评审 round 3 的 i3）默认拒绝 `local` provider**：迁移 CLI 在 `provider === 'local'` 时默认拒绝封印官方 Key，仅 `--allow-local`（CI/开发）放行
- [ ] 5.8 **（评审 round 3 的 i2）续跑判据与幂等判据对齐**：续跑查询 = 「无信封 **OR** 信封解不开」；新增 `--repair` 重新封印坏行
- [ ] 5.9 **（评审 round 3 的 i7）迁移报告登记密钥环身份**：输出所用密钥环的密钥 id 列表，供与部署文档预期清单比对后放行

## 6. 一致性巡检

- [ ] 6.1 巡检脚本四项判据（覆盖 / 可解 / 一致 / 绑定），逐项可独立失败并点名行 id
- [ ] 6.2 巡检复用**生产同一模块**解封（不得另写第二份解密代码）——**依赖第 2 组先交付**（评审 i5）
- [ ] 6.3 漂移行报告与"读取旧格式"计数并列展示
- [ ] 6.4 变异反证：① 摘掉 AAD 的 `keyRowId` ⇒ 跨行替换变红；② 巡检改用第二份解密实现 ⇒ 结构锁变红
- [ ] 6.5 **（评审 round 3 的 i4）孤儿信封判据**：信封表中不得存在没有对应官方 Key 行的记录（判据 1 只查了一个方向）
- [ ] 6.6 写路径 KMS 故障语义测试：`key_service` 在 KMS 不可用时拒绝写入并返回明确错误，且不产生"只写旧格式副本"或"先存明文"的降级

## 7. KMS 收口（**依赖 1.4；OQ2 定案前不作必走上线步骤**）

- [ ] 7.1 按 1.4 的定案落地：追加"生产必须 keyring"断言，或把 D12 的表写成运行手册条目
- [ ] 7.2 断言（若采纳）必须**只对生产生效**，且不得误伤 CI / 预发
- [ ] 7.3 **（评审 round 2 的 i5）** OQ2 未定案时，本组保持"未决定、不阻塞上线"，并在记录中如实标注，不得让它成为计划里的隐性门

## 8. 收尾：删除旧格式列（**独立 PR + 显式授权 + 不可逆**）

- [ ] 8.1 前置核对：巡检四项全绿、"读取旧格式"计数在观察窗口内连续为 0、`official_keys` 与密钥环已备份
- [ ] 8.2 取得运营方显式授权（本 change **不自动执行**）
- [ ] 8.3 独立 PR：删 `api_key` 列与 Fernet 读写路径；在 PR 描述声明不可逆与恢复方式
- [ ] 8.4 删列后测试：读取路径不存在 Fernet 分支；对无信封行报错而非尝试解旧格式

## 9. 文档与交付（随各步同步）

- [ ] 9.1 更新部署文档：主密钥/环文件托管与轮转、**环文件访问控制清单（评审 round 2 的 i6：权限最小化、仅迁移与 KMS 进程可读）**、KMS 注入表（D12）、过渡窗口、8 步部署顺序、回滚步骤（含"步骤 8 后回滚=数据恢复"）
- [ ] 9.2 更新 `ops-center/docs/PRD.md` 与 `01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md` §4.4-1 的"剩余待办"，指向本 change
- [ ] 9.3 `.quality-gates.md` 执行记录 + `openspec/records/<分支>.md`（含 QM-1 打包、QM-6 通道实况与偏差声明）
- [ ] 9.4 归档三同步：`openspec archive` + CCG task 归档 + 质量节拍复盘/learnings

## 10. 明确不做（Non-Goals，防止顺手扩大）

- [ ] 10.1 不把模型供应商加进 `SUPPORTED_PLATFORMS`（D1③ 已否决）
- [ ] 10.2 不改 `official_keys` 对外 API 契约（仍只返回掩码）
- [ ] 10.3 不改桌面端（客户端始终拿不到官方 Key）
- [ ] 10.4 不做官方算力供给链路本身（套餐池/调度/扣费/供给资格）——属另一 change
- [ ] 10.5 不顺手收口 `keyring-kms.js` 的常量重复声明（R12，仅登记遗留）
