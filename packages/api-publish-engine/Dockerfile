# syntax = docker/dockerfile:1.4
#
# ⚠️ 依赖安装必须走 pnpm。
# 2026-08-13 提交 9eabe7765（`build(monorepo): npm → pnpm 迁移`）删除了 package-lock.json，
# 而旧版这里写的是 `npm ci` —— `npm ci` 在缺少 lockfile 时**必定失败**：
#   npm error The `npm ci` command can only install with an existing package-lock.json
# 因为 2026-07-28 之后没人重建过 API 镜像，这个断点隐藏了近 3 个月，直到 2026-10-23
# 支付上线需要新镜像时才在阿里云 ECS 上实测暴露（`docker build` 在 deps 阶段 exit 1）。
# 回归锁：test/dockerfile-pnpm-build.test.js
FROM node:22-alpine AS base
RUN npm i -g pnpm@11.13.1

FROM base AS deps
WORKDIR /app
# pnpm workspace 三件套 —— 缺 pnpm-workspace.yaml 会导致 nodeLinker / allowBuilds 丢失。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api-publish-engine/package.json ./packages/api-publish-engine/package.json
# --frozen-lockfile：只按锁文件装，不联网重新解析（在国内机房，重新解析 500+ 包会慢到不可用）
# --ignore-scripts  ：API 是纯 JS，不需要任何 postinstall；放行会让 ffmpeg-ffprobe-static
#                     去 GitHub Releases 拉几十 MB 二进制，在受限网络下直接卡死构建
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
# pnpm v10+ 默认只允许从 inject-workspace-packages=true 的工作区 deploy，
# 本项目未启用注入，因此必须显式 --legacy，否则报
#   ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE
RUN pnpm --filter @multi-publish/api-publish-engine deploy --legacy --prod --ignore-scripts /prod/api

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 publishapi && \
    adduser --system --uid 1001 publishapi
COPY --from=deps --chown=publishapi:publishapi /prod/api/node_modules ./node_modules
COPY --chown=publishapi:publishapi packages/api-publish-engine/src ./packages/api-publish-engine/src
COPY --chown=publishapi:publishapi packages/api-publish-engine/upload ./packages/api-publish-engine/upload
COPY --chown=publishapi:publishapi packages/api-publish-engine/bin ./packages/api-publish-engine/bin
COPY --chown=publishapi:publishapi packages/api-publish-engine/scripts ./packages/api-publish-engine/scripts
COPY --chown=publishapi:publishapi packages/api-publish-engine/package.json ./packages/api-publish-engine/package.json
COPY --chown=publishapi:publishapi migrations/postgresql ./migrations/postgresql
WORKDIR /app/packages/api-publish-engine
USER publishapi
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV DRY_RUN=false
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/api/v1/ready || exit 1
ENTRYPOINT ["node", "bin/publish-api"]
