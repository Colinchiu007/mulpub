---
record: dockerfile-pnpm-build
task: 修复 API 镜像构建（npm ci → pnpm），恢复自 2026-08-13 起中断的发布链路
date: 2026-10-23
---

# API 镜像构建断了三个月

## 1. 怎么发现的

2026-10-23 给生产上微信支付，需要在阿里云 ECS 上重建业务 API 镜像。`docker build` 在 deps 阶段直接失败：

```
1.918 npm error The `npm ci` command can only install with an existing package-lock.json
ERROR: failed to solve: process "/bin/sh -c npm ci --omit=dev --workspace @multi-publish/api-publish-engine ..." did not complete successfully: exit code: 1
```

## 2. 根因

| 时间 | 事件 |
|---|---|
| 2026-07-28 | 最后一次成功构建并部署 API 镜像（`e19a36b`） |
| 2026-08-13 | 提交 `9eabe7765` `build(monorepo): npm → pnpm 迁移`，**删除 `package-lock.json`** |
| 2026-08-13 ~ 10-23 | 没人重建过 API 镜像，断点无感 |
| 2026-10-23 | 支付上线要新镜像，`npm ci` 当场失败 |

**逃逸分析**：主 CI 不构建这个镜像（`build.yml` 只打 Electron 桌面端），所以单元测试、lint、门禁全绿也发现不了。这个断点只在「真要发布」的那一刻暴露 —— 而那通常已经在救火。

## 3. 改法

`packages/api-publish-engine/Dockerfile` 的 deps 阶段：

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api-publish-engine/package.json ./packages/api-publish-engine/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @multi-publish/api-publish-engine deploy --legacy --prod --ignore-scripts /prod/api
```

三个参数都不是可选的，每个都由实测逼出来：

| 参数 | 不写会怎样（实测） |
|---|---|
| `--frozen-lockfile` | 不加它 pnpm 会去 registry 重新解析 500+ 包；国内机房单请求 13~15 秒，构建无法完成 |
| `--ignore-scripts` | `ffmpeg-ffprobe-static` 的 postinstall 去 GitHub Releases 拉几十 MB，受限网络直接卡死在 deps 阶段（原 Dockerfile 本来就有这个参数，移植时漏了） |
| `deploy --legacy` | pnpm v10+ 报 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`：未启用 `inject-workspace-packages` 时必须显式 --legacy |

## 4. 判据

`packages/api-publish-engine/test/dockerfile-pnpm-build.test.js`，**7 例**：

1. 不得出现 `npm ci`（注释行不参与判定，注释里解释历史不算违规）
2. 必须有 `pnpm install --frozen-lockfile`
3. 必须拷入 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`
4. 必须 `--ignore-scripts`
5. `pnpm deploy` 行必须带 `--legacy`
6. 前提：仓库根有 `pnpm-lock.yaml`、没有 `package-lock.json`
7. 运行时非 root 且 uid=1001（部署侧按这个数字 chown 支付私钥）

### 变异反证

| 变异 | 结果 |
|---|---|
| 把 `pnpm install --frozen-lockfile` 改回 `npm ci` | 5 pass / **2 fail**（第 1、2 例红） |

文件逐字节还原 True。

## 5. 锁的边界（不假装覆盖全部）

- 只断言**文件内容形状**，不执行 `docker build`：CI 无 docker daemon，且构建要几分钟 + 联网。真正验证构建的是发布流程。
- 不解析 Docker 语法树；改多阶段别名、`# syntax` 变体不影响判据。

## 6. 已知遗留

**镜像体积从 167MB 涨到 552MB**。原因：`pnpm deploy --legacy` 在 `nodeLinker: hoisted` 下会把根工作区的依赖一起带进 `/prod/api/node_modules`（实测 839MB / 504 包，含 `app-builder-bin` 207MB、`@remotion` 66MB）。

功能不受影响（镜像能启动、`/api/v1/ready` 200、支付预检 5/5 PASS），但每次发布多传约 400MB。收窄方案（`node-linker=isolated` 或独立 `pnpm install` 目录）需要单独验证，不在本次范围内。

## 7. 上线验证（2026-10-23 实机）

用这个 Dockerfile 在 ECS 上构建出 `multi-publish-business-api-publish-api:54dec05-pnpm1` 并完成生产切换：

- `/api/v1/ready` → **200**
- 容器 → **healthy**
- `payment-preflight` → **5/5 PASS**
- `POST /api/v1/webhooks/payment` → 401 `PAYMENT_WEBHOOK_BODY_EMPTY`（provider 已构造）
- 真实调用微信下单接口 → 返回 `weixin://wxpay/bizpayurl?pr=...`（微信认可签名）

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）

## 8. 连带修好的既有契约测试

`test/logto-deploy-contract.test.js` 里有两条断言锁着 **npm 时代**的 Dockerfile 形状：

| 原断言 | 问题 | 改为 |
|---|---|---|
| `/COPY package\.json package-lock\.json/` | `package-lock.json` 2026-08-13 已删除，这条只有靠 Dockerfile 里那行残留才成立 | `/COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/` |
| `/--workspace @multi-publish\/api-publish-engine/` | pnpm 用 `--filter`，没有 `--workspace` | `/--filter @multi-publish\/api-publish-engine/` |

两条都保留了原意（"deps 阶段确实拷入依赖清单""确实针对本工作区安装"），只是把清单从 npm 的两件换成 pnpm 的三件。

**这一条也是 CI 抓到的**：本地只跑新增的 7 例是绿的，`QG Unit Tests` 跑到契约测试才红 —— 说明"只跑自己新写的测试"不足以证明没破坏别处。

另有一处 Dockerfile 回退：runner 阶段原本想把 `package.json` 也从 `pnpm deploy` 产物（`--from=deps`）拷，但契约测试的 staging 只处理**本地** `COPY`（正则排除 `--from=`），导致 require 链找不到 package.json。改回从仓库拷 —— 与原 Dockerfile 行为一致，运行时不需要 deploy 改写后的清单。