'use strict';

/**
 * check-ops-session-hygiene.js 的行为契约测试（node:test）。
 *
 * 门禁本身也是代码：必须证明它「违规会红、合规会绿」，否则只是一段永远通过的 echo。
 * 用临时目录搭最小 fixture，避免依赖真实仓库内容（除最后一例：真实仓库必须 0 违规）。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { analyze, FILE_RULES } = require('./check-ops-session-hygiene.js');

/** 与门禁规则同口径的「合规最小实现」，逐文件写全 must 结构。 */
const COMPLIANT = {
  'ops-center/backend/routers/auth.py': [
    'async def login(response: Response, body: LoginBody):',
    '    response.set_cookie(',
    '        key=settings.session_cookie_name,',
    '        httponly=True,',
    '        samesite=settings.session_cookie_samesite,',
    '    )',
    '    return {"username": row.username, "expires_in": 28800}',
    '',
    'async def logout(response: Response):',
    '    response.delete_cookie(key=settings.session_cookie_name, path="/")',
    '',
  ].join('\n'),
  'ops-center/backend/middleware/auth.py': [
    'SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})',
    'async def get_current_user(request: Request = None):',
    '    if not request.headers.get(settings.csrf_header):',
    '        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="csrf")',
    '',
  ].join('\n'),
  'ops-center/backend/main.py': [
    'async def security_headers(request, call_next):',
    '    response.headers.setdefault("Content-Security-Policy", csp)',
    '    response.headers.setdefault("X-Content-Type-Options", "nosniff")',
    '    response.headers.setdefault("Referrer-Policy", "no-referrer")',
    '',
  ].join('\n'),
  'ops-center/backend/config.py': [
    'session_cookie_name: str = "ops_session"',
    'content_security_policy: str = "default-src \'self\'"',
    'def is_session_cookie_secure(self) -> bool:',
    '    return True',
    '',
  ].join('\n'),
  'ops-center/frontend/src/api/http.js': [
    "export const CSRF_HEADER = 'X-Ops-Session'",
    '  const api = axios.create({',
    '    baseURL: \'/api/v1\',',
    '    withCredentials: true,',
    '      if (err.response?.status === 401) {',
    '',
  ].join('\n'),
  'ops-center/frontend/src/router/index.js': [
    'router.beforeEach(async (to, from, next) => {',
    '  if (!authStore.initialized) {',
    '    await authStore.restore()',
    '  }',
    '})',
    '',
  ].join('\n'),
  'ops-center/frontend/src/views/EnvView.vue': [
    '<script setup>',
    "import { createApiClient } from '../api/http'",
    'const api = createApiClient()',
    '</script>',
    '',
  ].join('\n'),
  'ops-center/deploy/nginx-ops.conf': [
    "add_header Content-Security-Policy \"default-src 'self'; frame-ancestors 'none'\" always;",
    '',
  ].join('\n'),
};

function makeFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-hygiene-'));
  const files = { ...COMPLIANT, ...overrides };
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue; // 显式删除该文件
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('合规实现 → 0 违规', () => {
  const root = makeFixture();
  try {
    const { violations } = analyze(root);
    assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
  } finally {
    cleanup(root);
  }
});

test('view 把 token 写回 localStorage → 命中凭据存储规则', () => {
  const root = makeFixture({
    'ops-center/frontend/src/views/EnvView.vue': [
      '<script setup>',
      "const api = createApiClient()",
      "localStorage.setItem('ops_token', JSON.stringify({ token }))",
      '</script>',
      '',
    ].join('\n'),
  });
  try {
    const { violations } = analyze(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].name, 'frontend-must-not-store-session-credentials');
    assert.match(violations[0].detail, /views\/EnvView\.vue:3/);
    assert.match(violations[0].why || violations[0].detail, /localStorage/);
  } finally {
    cleanup(root);
  }
});

test('view 自建 axios 实例 / 自装请求拦截器 → 命中统一客户端规则', () => {
  const root = makeFixture({
    'ops-center/frontend/src/views/EnvView.vue': [
      '<script setup>',
      "import axios from 'axios'",
      "const api = axios.create({ baseURL: '/api/v1' })",
      'api.interceptors.request.use((c) => {',
      "  c.headers.Authorization = 'Bearer ' + localStorage.getItem('t')",
      '  return c',
      '})',
      '</script>',
      '',
    ].join('\n'),
  });
  try {
    const { violations } = analyze(root);
    const names = new Set(violations.map((v) => v.name));
    assert.ok(names.has('views-must-use-shared-api-client'), 'axios.create + 拦截器 应各命中一次');
    assert.ok(names.has('frontend-must-not-store-session-credentials'), '手工拼 Authorization 应命中');
    assert.ok(violations.length >= 3, `预期至少 3 项违规，实际 ${violations.length}`);
  } finally {
    cleanup(root);
  }
});

test('登录响应体回传 token → mustNot 命中（签发面退化即红）', () => {
  const root = makeFixture({
    'ops-center/backend/routers/auth.py': COMPLIANT['ops-center/backend/routers/auth.py']
      .replace('return {"username"', 'return {"token": token, "username"'),
  });
  try {
    const { violations } = analyze(root);
    assert.ok(violations.some((v) => v.kind === 'mustnot-present' && /routers\/auth\.py/.test(v.detail)));
  } finally {
    cleanup(root);
  }
});

test('删除 nginx 模板（静态层 CSP 缺失）→ missing-file 而非静默通过', () => {
  const root = makeFixture({ 'ops-center/deploy/nginx-ops.conf': null });
  try {
    const { violations } = analyze(root);
    assert.ok(violations.some((v) => v.kind === 'missing-file' && /nginx-ops\.conf/.test(v.detail)));
  } finally {
    cleanup(root);
  }
});

test('规则清单不为空且每条文件断言都有 note（可运维性自检）', () => {
  assert.ok(FILE_RULES.length >= 5);
  for (const rule of FILE_RULES) {
    assert.ok(rule.note && rule.note.length > 8, `${rule.file} 缺少可操作说明`);
    assert.ok(Array.isArray(rule.must) && rule.must.length > 0, `${rule.file} 缺少 must 断言`);
  }
});

test('真实仓库必须 0 违规（门禁与现状同口径）', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const { violations, scannedFiles } = analyze(repoRoot);
  assert.ok(scannedFiles > 50, `扫描文件数异常：${scannedFiles}`);
  assert.deepEqual(violations.map((v) => v.detail), [], JSON.stringify(violations, null, 2));
});
