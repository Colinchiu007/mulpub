/**
 * 接线锁：`packages/api-publish-engine/Dockerfile` 必须用 pnpm 安装依赖。
 *
 * 为什么需要这条锁（2026-10-23 在阿里云 ECS 上实测）：
 * 2026-08-13 提交 9eabe7765（`build(monorepo): npm → pnpm 迁移`）删除了仓库根的
 * `package-lock.json`，但 Dockerfile 的 deps 阶段仍写着 `npm ci`。`npm ci` 在缺少
 * lockfile 时**必定失败**：
 *
 *     npm error The `npm ci` command can only install with an existing package-lock.json
 *     ERROR: failed to solve: process "/bin/sh -c npm ci ..." did not complete successfully
 *
 * 关键点：这个断点**不会**被任何单元测试或 CI 暴露 —— 主 CI 不构建这个镜像。
 * 它只在「有人真要发布 API」的那一刻炸，而那时通常已经在救火。
 * 从 07-28 最后一次成功构建到 10-23 发现，中间隔了近 3 个月。
 *
 * ⚠️ 锁的边界：
 *   - 它只断言**文件内容形状**，不真的执行 `docker build`（CI 没有 docker daemon，
 *     且构建要几分钟 + 联网）。真正验证构建的是发布流程本身。
 *   - 它读的是仓库里被跟踪的 Dockerfile，不解析 Docker 语法树；改成多阶段别名或
 *     `# syntax` 变体不影响判据。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '../../..')
const DOCKERFILE = path.join(REPO_ROOT, 'packages/api-publish-engine/Dockerfile')

function readDockerfile () {
  return fs.readFileSync(DOCKERFILE, 'utf8')
}

/** 去掉注释行，避免注释里提到 `npm ci`（解释历史）被误判成指令。 */
function instructionLines (text) {
  return String(text)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

test('Dockerfile 不得使用 npm ci（仓库已无 package-lock.json）', () => {
  const body = instructionLines(readDockerfile())
  assert.equal(
    /\bnpm\s+ci\b/.test(body),
    false,
    'Dockerfile 又用回 npm ci 了 —— 2026-08-13 起仓库没有 package-lock.json，构建必定失败',
  )
})

test('Dockerfile 必须用 pnpm 且带 --frozen-lockfile', () => {
  const body = instructionLines(readDockerfile())
  assert.match(body, /pnpm\s+install\s+--frozen-lockfile/, '必须用 pnpm install --frozen-lockfile（只按锁文件装，不重新解析）')
})

test('deps 阶段必须拷入 pnpm 的 workspace 清单', () => {
  const body = instructionLines(readDockerfile())
  assert.match(body, /COPY[^\n]*pnpm-lock\.yaml/, '缺 pnpm-lock.yaml 就无法 frozen install')
  assert.match(body, /COPY[^\n]*pnpm-workspace\.yaml/, '缺 pnpm-workspace.yaml 会丢 nodeLinker=hoisted 与 allowBuilds')
})

test('必须 --ignore-scripts（否则 ffmpeg-ffprobe-static 会在构建时下载二进制）', () => {
  const body = instructionLines(readDockerfile())
  assert.match(body, /--ignore-scripts/, 'API 是纯 JS，postinstall 只会在受限网络下拉大文件并卡死构建')
})

test('pnpm deploy 必须带 --legacy（pnpm v10+ 的硬要求）', () => {
  const body = instructionLines(readDockerfile())
  const deployLine = body.split('\n').find((line) => /pnpm\s+--filter\s+\S+\s+deploy/.test(line))
  assert.ok(deployLine, '没找到 pnpm deploy 行')
  assert.match(
    deployLine,
    /--legacy/,
    'pnpm v10+ 未启用 inject-workspace-packages 时必须 --legacy，否则 ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE',
  )
})

test('前提：仓库根有 pnpm-lock.yaml 且没有 package-lock.json', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'pnpm-lock.yaml')), true, 'pnpm-lock.yaml 不见了')
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'package-lock.json')),
    false,
    'package-lock.json 又出现了 —— 若真要走回 npm，必须同步把 Dockerfile 改回 npm ci 并说明原因',
  )
})

test('运行时必须是非 root（与部署侧 chown 1001 的约定一致）', () => {
  const body = instructionLines(readDockerfile())
  assert.match(body, /--uid\s+1001/, '容器用户 uid 必须是 1001：部署侧按这个数字 chown 支付私钥')
  assert.match(body, /^USER\s+publishapi/m, '必须以非 root 用户运行')
})
