const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const yaml = require('js-yaml')

function copyTree(sourcePath, destinationPath) {
  const stat = fs.lstatSync(sourcePath)
  if (stat.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true })
    for (const entry of fs.readdirSync(sourcePath)) {
      copyTree(path.join(sourcePath, entry), path.join(destinationPath, entry))
    }
    return
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.copyFileSync(sourcePath, destinationPath)
}

function stageDockerRunner(dockerfile, repositoryRoot) {
  const runner = dockerfile.split(/FROM\s+\S+\s+AS\s+runner\s*/i)[1]
  assert(runner, 'Dockerfile 必须包含 runner stage')
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-api-runner-'))
  const copies = [...runner.matchAll(/^COPY\s+(?!.*--from=)(?:--chown=\S+\s+)?(\S+)\s+(\S+)\s*$/gm)]
  assert(copies.length > 0, 'runner stage 必须包含本地 COPY 指令')

  for (const [, source, destination] of copies) {
    const sourcePath = path.resolve(repositoryRoot, source)
    assert(fs.existsSync(sourcePath), `Docker COPY 源不存在：${source}`)
    const relativeDestination = destination.replace(/^\.\//, '').replace(/^\/app\/?/, '')
    copyTree(sourcePath, path.join(stagingRoot, relativeDestination))
  }
  return stagingRoot
}

const composePath = path.resolve(__dirname, '../../../deploy/logto/docker-compose.yml')
const compose = yaml.load(fs.readFileSync(composePath, 'utf8'))
const ports = compose?.services?.logto?.ports

assert.strictEqual(compose.services.logto.image, 'svhd/logto:1.41.0', '基础 Compose 必须保留官方镜像作为回滚路径')
assert.strictEqual(compose.services.logto.build, undefined, '基础 Compose 不得隐式构建派生镜像')

assert.deepStrictEqual(ports, [
  '127.0.0.1:3001:3001',
  '127.0.0.1:3002:3002',
])
assert.match(compose.services.postgres.environment.POSTGRES_PASSWORD, /\$\{LOGTO_DB_PASSWORD:\?/)
assert.strictEqual(compose.services.logto.environment.TRUST_PROXY_HEADER, '${LOGTO_TRUST_PROXY_HEADER:-0}')
const deployEnv = fs.readFileSync(path.resolve(__dirname, '../../../deploy/logto/.env.example'), 'utf8')
assert.match(deployEnv, /^LOGTO_TRUST_PROXY_HEADER=0$/m)

const webhookRetryOverlayPath = path.resolve(__dirname, '../../../deploy/logto/docker-compose.webhook-retry.yml')
assert(fs.existsSync(webhookRetryOverlayPath), '必须提供可独立移除的 Webhook POST 重试 Compose 叠加层')
const webhookRetryOverlay = yaml.load(fs.readFileSync(webhookRetryOverlayPath, 'utf8'))
assert.deepStrictEqual(webhookRetryOverlay, {
  services: {
    logto: {
      image: 'multi-publish-logto:1.41.0-webhook-post-retry.1',
      build: {
        context: '.',
        dockerfile: 'Dockerfile.webhook-retry',
      },
    },
  },
}, 'Webhook 重试叠加层只能替换 Logto 镜像，不得修改数据库、端口、网络或运行参数')

const webhookRetryDockerfilePath = path.resolve(__dirname, '../../../deploy/logto/Dockerfile.webhook-retry')
assert(fs.existsSync(webhookRetryDockerfilePath), '必须提供 Logto Webhook POST 重试派生镜像 Dockerfile')
const webhookRetryDockerfile = fs.readFileSync(webhookRetryDockerfilePath, 'utf8')
assert.match(webhookRetryDockerfile,
  /^FROM docker\.m\.daocloud\.io\/svhd\/logto@sha256:7f79547e3d1fe569a3ecae757968a7cfc579687aa8164eec35113c0adc983c5b$/m,
  '派生镜像必须绑定 ECS 已验收的 Logto 1.41.0 manifest digest')
assert.match(webhookRetryDockerfile,
  /^LABEL org\.opencontainers\.image\.base\.digest="sha256:7f79547e3d1fe569a3ecae757968a7cfc579687aa8164eec35113c0adc983c5b"$/m)
assert.match(webhookRetryDockerfile, /^COPY patch-webhook-post-retry\.cjs \/tmp\/patch-webhook-post-retry\.cjs$/m)
assert.match(webhookRetryDockerfile, /^RUN node \/tmp\/patch-webhook-post-retry\.cjs && rm \/tmp\/patch-webhook-post-retry\.cjs$/m)
assert.doesNotMatch(webhookRetryDockerfile, /^(?:ENTRYPOINT|CMD|USER|WORKDIR)\b/m,
  '派生镜像不得覆盖上游启动命令、用户或工作目录')

const dockerignorePath = path.resolve(__dirname, '../../../deploy/logto/.dockerignore')
assert(fs.existsSync(dockerignorePath), 'Logto build context 必须使用白名单式 .dockerignore 隔离生产 Secret')
const dockerignoreRules = fs.readFileSync(dockerignorePath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
assert.deepStrictEqual(dockerignoreRules, [
  '*',
  '!Dockerfile.webhook-retry',
  '!patch-webhook-post-retry.cjs',
], 'Logto 派生镜像构建上下文只能包含 Dockerfile 和补丁脚本')

const apiEnv = fs.readFileSync(path.resolve(__dirname, '../../../deploy/logto/api.env.example'), 'utf8')
for (const variable of [
  'NODE_ENV', 'HOST', 'IDENTITY_AUTH_ENABLED', 'IDENTITY_AUTH_REQUIRED',
  'BUSINESS_DATABASE_AUTO_MIGRATE', 'BUSINESS_DATABASE_MIGRATIONS_DIR', 'LOGTO_ENDPOINT', 'LOGTO_API_RESOURCE',
  'LOGTO_CLIENT_ID', 'LOGTO_CLIENT_SECRET',
  'BUSINESS_DATABASE_URL', 'LOGTO_COMPOSE_NETWORK', 'LOGTO_WEBHOOK_SIGNING_KEY', 'ENTITLEMENT_KEY_ID',
  'ENTITLEMENT_PRIVATE_KEY',
]) {
  assert.match(apiEnv, new RegExp(`^${variable}=`, 'm'))
}
assert.match(apiEnv, /^BUSINESS_DATABASE_AUTO_MIGRATE=false$/m)
assert.match(apiEnv, /^HOST=0\.0\.0\.0$/m)
assert.match(apiEnv, /^API_KEYS_PATH=\/app\/packages\/api-publish-engine\/config\/api-keys\.json$/m)
assert.match(apiEnv, /^LOGTO_COMPOSE_NETWORK=multi-publish-logto_default$/m)
assert.doesNotMatch(apiEnv, /^PUBLISH_API_HOST_PORT=/m)

const apiCompose = yaml.load(fs.readFileSync(path.resolve(__dirname, '../docker-compose.yml'), 'utf8'))
assert.strictEqual(apiCompose.services['publish-api'].build.context, '../..')
assert.strictEqual(apiCompose.services['publish-api'].build.dockerfile, 'packages/api-publish-engine/Dockerfile')
assert.deepStrictEqual(apiCompose.services['publish-api'].networks, ['default', 'logto'])
assert.deepStrictEqual(apiCompose.networks, {
  logto: {
    external: true,
    name: '${LOGTO_COMPOSE_NETWORK:-multi-publish-logto_default}',
  },
}, '业务 API 必须加入 Logto Compose 网络，才能解析 BUSINESS_DATABASE_URL=postgres')
assert.deepStrictEqual(apiCompose.services['publish-api'].ports, [
  '127.0.0.1:3030:3000',
])
const apiVolumes = apiCompose.services['publish-api'].volumes
assert.deepStrictEqual(apiVolumes, [
  {
    type: 'bind',
    source: './config',
    target: '/app/packages/api-publish-engine/config',
    bind: { create_host_path: false },
  },
  {
    type: 'bind',
    source: './data',
    target: '/app/data',
    bind: { create_host_path: false },
  },
], 'Compose 必须拒绝自动创建 root-owned 持久化目录，并挂载到真实读写路径')
const composeHealthcheck = apiCompose.services['publish-api'].healthcheck.test.join(' ')
assert.match(composeHealthcheck, /http:\/\/127\.0\.0\.1:3000\/api\/v1\/ready/)
assert.doesNotMatch(composeHealthcheck, /http:\/\/localhost:3000\/api\/v1\/ready/)
assert.match(composeHealthcheck, /\/api\/v1\/ready/)
assert.doesNotMatch(composeHealthcheck, /\/api\/v1\/health/)
for (const required of [
  'NODE_ENV=production',
  'MULTI_PUBLISH_PLUGINS_DIR=/app/data/plugins',
  'API_KEYS_PATH=/app/packages/api-publish-engine/config/api-keys.json',
  'IDENTITY_AUTH_ENABLED=${IDENTITY_AUTH_ENABLED:?请设置 IDENTITY_AUTH_ENABLED}',
  'BUSINESS_DATABASE_AUTO_MIGRATE=false',
  'BUSINESS_DATABASE_URL=${BUSINESS_DATABASE_URL:?请设置 BUSINESS_DATABASE_URL}',
  'LOGTO_ENDPOINT=${LOGTO_ENDPOINT:?请设置 LOGTO_ENDPOINT}',
  'LOGTO_API_RESOURCE=${LOGTO_API_RESOURCE:?请设置 LOGTO_API_RESOURCE}',
  'LOGTO_CLIENT_ID=${LOGTO_CLIENT_ID:?请设置 LOGTO_CLIENT_ID}',
  'LOGTO_CLIENT_SECRET=${LOGTO_CLIENT_SECRET:?请设置 LOGTO_CLIENT_SECRET}',
]) {
  assert(apiCompose.services['publish-api'].environment.includes(required))
}
const dockerfile = fs.readFileSync(path.resolve(__dirname, '../Dockerfile'), 'utf8')
const packageManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
assert(packageManifest.files.includes('upload/'), 'API 发布包必须包含 upload/ 运行时目录')
// 依赖安装走 pnpm（2026-08-13 的 npm→pnpm 迁移删除了 package-lock.json）。
// 这里断言的是"deps 阶段确实拷入了依赖清单"，清单从 npm 时代的两件换成了 pnpm 的三件；
// 具体安装参数（--frozen-lockfile / --ignore-scripts / deploy --legacy）由
// test/dockerfile-pnpm-build.test.js 单独守。
assert.match(dockerfile, /COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/)
assert.match(dockerfile, /--filter @multi-publish\/api-publish-engine/)
assert.match(dockerfile, /COPY --chown=publishapi:publishapi migrations\/postgresql \.\/migrations\/postgresql/)
assert.match(dockerfile, /COPY --chown=publishapi:publishapi packages\/api-publish-engine\/scripts \.\/packages\/api-publish-engine\/scripts/)
assert.match(dockerfile, /ENV NODE_ENV=production/)
assert.match(dockerfile, /http:\/\/127\.0\.0\.1:\$\{PORT\}\/api\/v1\/ready/)
assert.doesNotMatch(dockerfile, /http:\/\/localhost:\$\{PORT\}\/api\/v1\/ready/)
assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/v1\/ready/)
assert.doesNotMatch(dockerfile, /HEALTHCHECK[\s\S]*\/api\/v1\/health/)

const repositoryRoot = path.resolve(__dirname, '../../..')
const stagingRoot = stageDockerRunner(dockerfile, repositoryRoot)
try {
  const stagedEntry = path.join(stagingRoot, 'packages/api-publish-engine/src/index.js')
  const stagedPackageJson = path.join(stagingRoot, 'packages/api-publish-engine/package.json')
  const nodePath = [path.join(repositoryRoot, 'node_modules'), process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter)
  const dependencyGuard = `
    const Module = require('module')
    const path = require('path')
    const entry = ${JSON.stringify(stagedEntry)}
    const packageJsonPath = ${JSON.stringify(stagedPackageJson)}
    const packageRoot = path.dirname(packageJsonPath)
    const dependencies = new Set(Object.keys(require(packageJsonPath).dependencies || {}))
    const originalLoad = Module._load
    Module._load = function guardedLoad(request, parent, isMain) {
      const parentFilename = parent && parent.filename
      const ownedParent = parentFilename === entry ||
        (parentFilename && parentFilename.startsWith(packageRoot + path.sep))
      const requestRoot = request.startsWith('@')
        ? request.split('/').slice(0, 2).join('/')
        : request.split('/')[0]
      const builtin = request.startsWith('node:') ||
        Module.builtinModules.includes(request) ||
        Module.builtinModules.includes(requestRoot)
      const bare = !request.startsWith('.') && !path.isAbsolute(request)
      if (ownedParent && bare && !builtin && !dependencies.has(requestRoot)) {
        throw new Error('UNDECLARED_RUNTIME_DEPENDENCY:' + requestRoot)
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    require(entry)
  `
  const load = spawnSync(process.execPath, ['-e', dependencyGuard], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: nodePath },
    timeout: 30000,
    windowsHide: true,
  })
  assert.strictEqual(load.status, 0, `Docker runner require 链加载失败：\n${load.stderr || load.stdout}`)
} finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}
assert.match(dockerfile, /COPY --chown=publishapi:publishapi packages\/api-publish-engine\/upload \.\/packages\/api-publish-engine\/upload/)

const runbook = fs.readFileSync(path.resolve(__dirname, '../../../01-docs/RUNBOOK-LOGTO-PRODUCTION.md'), 'utf8')
assert.match(runbook, /install -d -m 0750 -o 1001 -g 1001[\s\S]*packages\/api-publish-engine\/config[\s\S]*packages\/api-publish-engine\/data\/plugins/)
assert.match(runbook, /publish-api --port 3000/)
assert.match(runbook, /production-smoke\.js --logto https:\/\/id\.example\.com --api http:\/\/127\.0\.0\.1:3000/)
assert.match(runbook, /docker compose -f packages\/api-publish-engine\/docker-compose\.yml[\s\S]*production-smoke\.js --logto https:\/\/id\.example\.com --api http:\/\/127\.0\.0\.1:3030/)
assert.match(runbook, /docker-compose\.yml -f deploy\/logto\/docker-compose\.webhook-retry\.yml[\s\S]*build --no-cache logto/)
assert.match(runbook, /docker compose -f deploy\/logto\/docker-compose\.yml[\s\S]*up -d --no-deps --force-recreate logto/,
  'Runbook 必须保留不加载叠加层即可回到官方镜像的命令')

const deployReadme = fs.readFileSync(path.resolve(__dirname, '../../../deploy/logto/README.md'), 'utf8')
assert.match(deployReadme, /docker-compose\.yml -f docker-compose\.webhook-retry\.yml[\s\S]*build --no-cache logto/)
assert.match(deployReadme, /docker compose -f docker-compose\.yml --env-file \.env up -d --no-deps --force-recreate logto/)


// ---- 容器日志轮转（container-log-rotation R1） ----
function assertLogRotation (svc, name) {
  assert.ok(svc, name + ' 服务缺失')
  assert.ok(svc.logging, name + ' 必须声明 logging 配置')
  assert.ok(svc.logging.options, name + ' 必须声明 logging.options')
  assert.strictEqual(svc.logging.driver, 'json-file', name + ' logging.driver 应为 json-file')
  // 按语义断言：Docker 接受 max-size=50M/50MB、max-file=5（数字）等写法
  assert.strictEqual(String(svc.logging.options['max-size']).toLowerCase(), '50m', name + ' 应限制单文件 50m')
  assert.strictEqual(String(svc.logging.options['max-file']), '5', name + ' 应最多保留 5 个文件')
}
assertLogRotation(compose.services.postgres, 'logto/postgres')
assertLogRotation(compose.services.logto, 'logto')
assertLogRotation(apiCompose.services['publish-api'], 'publish-api')
const monitoringCompose = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../deploy/logto/docker-compose.monitoring.yml'), 'utf8'))
for (const name of ['blackbox', 'prometheus', 'alertmanager']) {
  assertLogRotation(monitoringCompose.services[name], 'monitoring/' + name)
}
console.log('  ✅ 容器日志轮转（json-file / max-size=50m / max-file=5）合同完整')

console.log('  ✅ Logto Compose 与业务 API 生产配置合同完整且不包含默认密钥')
