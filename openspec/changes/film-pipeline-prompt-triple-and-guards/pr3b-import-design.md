# PR-3b · F-J 资产导入（写路径）· 方案与写路径安全清单

> 状态：**方案待评审**（本文件只出方案，不含运行时代码）。
> 上游：PR-1（方案）、PR-2（F-A 分镜提示词三分）、PR-3（F-I 方法论接入规划 + F-H 方法论分区补全）均已合并。
> 依据：`tasks.md` 的 PR-3b 段 + `design.md` D19（为什么 F-J 必须单独一批）+ 研究报告 §五 的 F-J 条目。

---

## 零、这一批要解决什么

**现状（已核实）**：影视工程的资产（`film-kit`）是**随包携带**的 min 版，写死在 `apps/desktop/electron/film-kit/`。
用户在产品里**没有任何入口**能把资产换成自己的一份 ⇒ `userData/film-kit` 这个目录**存在但永远为空**
（`container.setup.js:463` 把它设为回退链首级，但没有任何代码往里写）。

**这一批做完之后**：用户可以选一个本地目录，把一份**完整**的影视工程资产包导进来；
之后「自动」标签的规划就基于**用户自己的资产**（方法论、任务模板、分镜库、色盘、参考图），
而不是随包的 min 版。

**为什么必须单独一批**（D19 的原话，保留）：导入是**写路径**，而 PR-3 整批都是**只读**接线。
只读与写路径混在一批里，安全评审的判据会互相干扰 ⇒ 本批**不与 PR-3 的任何内容混批**。

---

## 一、导入面设计（四段式）

```
① 选目录 ──► ② 严格校验（源目录）──► ③ 原子落盘（staging → 换入）──► ④ 失效缓存
   dialog      loadFilmKit(requireAssets:true)   目录级 rename 换入        清 _kit/_shotLibrary/_scriptAdapter
```

| 段 | 做什么 | 用现成的什么 | 失败形态 |
|----|--------|--------------|----------|
| ① 选目录 | `dialog.showOpenDialog({ properties: ['openDirectory'] })` | **先例**：`ipc-handlers/pipeline.js:295`（`dialogApi` 可注入 ⇒ 可测） | 用户取消 ⇒ 静默返回，不报错 |
| ② 严格校验 | 在**源目录**上跑 `loadFilmKit({ kitDir, requireAssets: true })` | **已存在**：`kit-loader.js:307` 的注释明说「**导入校验**」用这个开关 | 校验失败 ⇒ **一律不落盘**（第 ③ 段根本不开始） |
| ③ 原子落盘 | 拷到 `<userData>/film-kit.staging-<ts>` ⇒ 再校验 staging ⇒ 目录级换入 | 原子写先例：`auto-project.js:79-84`（`.tmp + rename`），但那是**单文件**；kit 是**目录** ⇒ 需要**目录级**换入 | 换入失败 ⇒ 回滚（旧 kit 原样） |
| ④ 失效缓存 | 清 service 的 `_kit` / `_shotLibrary` / `_scriptAdapter` | 三个都是**实例字段**（`film-engineering-service.js:41-44`）⇒ 需要一个显式的失效方法 | 缓存没清 ⇒ 用户看到旧资产（**最阴的 bug**） |

### ③ 原子落盘的目录级换入（关键细节）

单文件的 `.tmp + rename` 对**目录**不成立（rename 一个非空目录会失败）。目录级原子换入的做法：

```
<userData>/film-kit              ← 当前生效的 kit（可能不存在）
<userData>/film-kit.staging-<ts> ← ③ 拷进来的候选（在**同父目录**⇒ 同卷 ⇒ rename 原子）
<userData>/film-kit.bak-<ts>     ← 换入时的旧 kit 备份
```

1. 拷白名单文件到 `staging-<ts>`（**不**直接写 `film-kit`）
2. 对 `staging-<ts>` **再跑一次**严格校验（拷贝过程可能截断/损坏 ⇒ 不能只信源目录的校验）
3. 旧 `film-kit` 存在 ⇒ 改名为 `film-kit.bak-<ts>`
4. `staging-<ts>` 改名为 `film-kit` ← **这一 rename 是原子的**（同卷）
5. 第 4 步失败 ⇒ `film-kit.bak-<ts>` 改回 `film-kit`（回滚），删 staging
6. 第 4 步成功 ⇒ 删 `film-kit.bak-<ts>`

⇒ **任何时刻 `film-kit` 要么是旧的、要么是新的，从不出现半份**。

---

## 二、写路径安全清单

| # | 约束 | 为什么 | 判据形态 |
|---|------|--------|----------|
| S1 | **只拷白名单文件**（不递归拷贝未知文件） | 用户的目录里可能有 `.git`、大视频、私密文件 ⇒ 不能整个目录搬进 `userData` | 拷完断言：staging 里的文件集合 **⊆** 白名单；白名单外的文件**不在** staging 里 |
| S2 | **不跟随符号链接** | 链接可以把「看起来在 kit 内」的内容指向 kit 外 ⇒ 越权读取/越权落盘 | 拷贝前 `lstat().isSymbolicLink()` ⇒ **拒绝**（含目录内的链接） |
| S3 | **半份 kit 不留** | 用户重开应用时读到半份 ⇒ 影视工程整体不可用 | 任意一步失败 ⇒ staging 目录**不存在**、旧 kit **逐字未变** |
| S4 | **失败回滚** | 换入中途失败不能让用户既没旧的又没新的 | 注入换入失败 ⇒ 旧 kit 仍在原处、内容逐字相同 |
| S5 | **只写 `userData/film-kit`（及其同父的 staging/.bak）** | 其它路径一律不写 | 断言：导入过程中**没有**对 staging/.bak 之外的路径发生写入 |
| S6 | **大小上限**（单文件 ≤ N、总计 ≤ M） | 用户可能选到一个 10GB 的目录 ⇒ 拷爆磁盘/内存 | 超限 ⇒ 拒绝并报错（**先检查再拷**，不拷一半才报错） |
| S7 | **不写 kit 之外的用户数据** | 同 S5 | 同 S5 |
| S8 | **严格模式失败 ⇒ 一律不落盘** | 「校验过了再落盘」是导入的**唯一**安全前提 | 校验失败 ⇒ `userData/film-kit` **不存在**（且原来存在的话也**不变**） |

### 白名单从哪来（**单一真源**）

`apps/desktop/electron/film-kit/SCHEMA.md` 的「**文件清单**」表就是白名单的真源：

| 类别 | 文件 | 必填 |
|------|------|------|
| 核心 4 件 | `film-manifest.json` / `shot-library.json` / `reference-registry.json` / `prompt-doctrine.json` | ✅ |
| v7 增强 4 件 | `shot-grammar.json` / `compliance-checklist.json` / `palette.json` / `prompts/tasks/**` | 严格模式下 ✅ |
| 可选 2 类 | `prompt-doctrine.zh.md` / `images/**`（含 `images-manifest.json`） | ❌（但**要拷**） |

⇒ 导入代码里维护一份**机器可读**白名单，并加一条**测试**断言它与 `SCHEMA.md` 的文件清单表**逐条对应**
⇒ 两份不会各自漂移（这正是 PR-3 全程在治的病：同一事实被复述在多处就会漂）。

**已核实的事实**（决定了白名单的两处细节）：

- `images/**`（11 个文件：10 个 512px webp + `images-manifest.json`）**目前没有任何代码消费**
  （全仓非注释命中为 0，只有 `kit-loader.js:15` 的文件头注释提到它）
  ⇒ **要拷**（它是 kit 契约的一部分、随包交付），但**不校验内容**（没人读它，校验它等于自造门禁）。
- `shot-library.json` / `reference-registry.json` 里的媒体路径（如 `260503_164739_….mp4`、
  `BTvvdqad639gj/7366f2ea-….jpg`）指向 **kit 之外**的媒体产物目录
  ⇒ **不在白名单内**（那是外部产物，不是 kit 资产）⇒ 导入**不**碰它们。

---

## 三、验收判据草案（TDD-RED，`kit-import.test.js`）

| # | 判据 | 对应安全条款 |
|---|------|--------------|
| ① | 严格模式校验失败 ⇒ **不落盘**（`userData/film-kit` 不存在） | S8 |
| ② | 成功 ⇒ `userData/film-kit` 齐备（白名单文件全在）+ **service 缓存已失效**（下次 `_ensureKit()` 读盘拿新资产） | — |
| ③ | 源目录含**符号链接** ⇒ 拒绝（不落盘） | S2 |
| ④ | 换入中途失败 ⇒ **无半份 kit**（staging 已清理、旧 kit 逐字未变） | S3 / S4 |
| ⑤ | 源目录含**白名单外**的文件 ⇒ **不**被拷进 staging | S1 |
| ⑥ | 源目录含**超限**文件 ⇒ 拒绝（且**未开始拷**） | S6 |
| ⑦ | 导入过程中**没有**写到 staging/.bak 之外的路径 | S5 |
| ⑧ | 换入失败后旧 kit 仍在原处、内容**逐字相同** | S4 |

> 判据 ⑤⑥⑦ 是本轮**新补**的（`tasks.md` 原列 4 条：校验失败不落盘 / 成功齐备+缓存失效 / 符号链接拒绝 / 中途失败无半份）。
> 补的理由：S1/S6/S5 是**写路径**里最容易被"想当然"漏掉的三条 —— 漏了 S1 会把用户的整个目录搬进 userData，
> 漏了 S6 会拷爆磁盘，漏了 S5 会写到 kit 之外。

---

## 四、落点与改动量（预估，实施后按实测回填）

| 层 | 文件 | 性质 |
|----|------|------|
| 主进程服务（新建） | `apps/desktop/electron/services/film-engineering/kit-import.js` | 导入的核心（白名单拷贝 + 校验 + 换入 + 回滚），**纯函数化**：fs/dialog/时钟全部可注入 ⇒ 可测 |
| 主进程服务（改） | `film-engineering-service.js` | 加一个**缓存失效**方法（清 `_kit`/`_shotLibrary`/`_scriptAdapter`） |
| 主进程 IPC（改） | `ipc-handlers/film-engineering-auto.js` 或**新建**同级模块 | 注册 `film-engineering:import-kit`（`withSenderCheck` + 入参校验） |
| preload（改） | `preload/access-control.js` + `preload/film-engineering.js` | 通道白名单加 `filmEngineering.importKit`；API 构造加同名方法 |
| 渲染端（改） | `src/api/electron-bridge.js` + `src/views/film-auto/FilmAutoPanel.vue` | 桥接 + 一个「导入资产」入口（对话框 + 结果提示） |
| i18n（改） | `locales/film-engineering/{zh,en}.js` | 新增文案 **zh/en 成对** |
| 测试（新建） | `services/film-engineering/kit-import.test.js` | 上表 8 条判据 |
| 文档（改） | `SCHEMA.md`（导入契约）/ `PRD-FILM-PIPELINE-V2`（§9.c）/ 本文件 / `tasks.md` / 执行记录 | 同步 |

---

## 五、明确不做（不假装有）

- ❌ **不做增量/合并**：整体替换，不做逐文件合并（合并语义要定义「同名谁赢」，那是另一批）
- ❌ **不做导入历史/多版本**：只保留当前一份（失败时的 `.bak` 是**回滚用**，成功后即删）
- ❌ **不做导出**
- ❌ **不做压缩包/网络下载/扫盘发现**：来源只有「用户选的本机目录」
- ❌ **不做 kit 之外的写入**（不写媒体产物目录、不写 userData 其它位置）
- ❌ **不把 `images/` 变成消费方**（本批只「拷它」，不「用它」）

---

## 六、需要评审拍板的三个点

1. **`.bak` 的去留**：成功换入后**立即删**（不留历史）还是保留最近一份（占磁盘但可人工回退）？
   —— 倾向：**立即删**（`tasks.md` 的 3b.1 写的是「原子落盘」，不留历史；磁盘占用与人工回退需求都要问用户）
2. **大小上限的具体数值**：**已实测**，不拍脑袋。

   实测（`app/electron/film-kit`，36 个文件）：

   | 维度 | 实测值 | 提议上限 | 依据 |
   |------|--------|----------|------|
   | 总体积 | **2.848 MB** | **256 MB** | 随包的是 **min 版**（SCHEMA.md 自述），完整库只会更大 ⇒ 给 90× 余量；同时 256 MB 拷进 userData 不会「拷爆磁盘」 |
   | 最大单文件 | **2.530 MB**（`shot-library.json`） | **32 MB** | 给 12.6× 余量（完整版分镜库可能几十 MB），但挡住「一个 500MB 的 json」这种离谱输入 |

   ⇒ 上限**在拷贝前检查**（S6）：超限直接拒绝，**不拷一半才报错**。
   ⇒ 这两个数进判据（`kit-import.test.js` 要有「超限 ⇒ 拒绝且未开始拷」的用例）。

3. **UI 入口的位置**：放在「自动」标签的计划区旁边，还是「项目案例」标签的顶部？
   —— 倾向：放在**项目案例**顶部（那里是「查看资产」的地方，导入是同一件事的另一半）

---

## 七、本批的许可与来源结论

- 本批**不引入任何第三方代码/资产**：只读写用户自己提供的目录 + 复用仓内已有的 `kit-loader` /
  `kit-asset-validators` / `film-engineering-service`。
- 资产导入**不搬运**研究项目的任何文件（研究项目给的是**方法论与资产形态**，不是二进制资产）。
- 许可结论：仓内既有代码沿用原仓许可；`SCHEMA.md` 与 `film-kit/**` 是**本仓自有资产**。
