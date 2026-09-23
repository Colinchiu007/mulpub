#!/usr/bin/env node
'use strict';

/**
 * ops-center 管理后台会话卫生门禁（P1-15 防复发）。
 *
 * 背景：体检报告问题 15 —— 登录接口把 HS256 JWT 放进响应体，前端存 localStorage 并手工拼
 * `Authorization: Bearer`。任何一处 XSS 都能把管理员凭据完整外带（会话接管）。
 * 修复后：凭据只存在于后端下发的 HttpOnly Cookie，写操作叠加自定义头 X-Ops-Session，
 * 并且三处（后端中间件 / nginx 模板 / vite dev 插件）都下发 CSP。
 *
 * 本门禁把「修复后的口径」变成静态不变量，防止后续迭代又把 token 写回前端存储、
 * 或在某个 view 里绕过统一客户端自建 axios 实例（历史上正是这种「7 份重复样板」导致
 * 一处加固改不全）。
 *
 * 校验分两类：
 *  1) 目录级禁用模式（frontend/src、frontend/src/views）；
 *  2) 关键文件必须/禁止出现的结构（后端签发点、CSP 下发点、统一客户端、nginx 模板）。
 *
 * 用法：node .github/scripts/check-ops-session-hygiene.js [--verbose]
 * 退出码：0 通过；1 违规（含关键文件缺失）。
 */

const fs = require('fs');
const path = require('path');

const SOURCE_EXTENSIONS = new Set(['.js', '.vue']);

/** 目录级禁用模式：命中即违规。 */
const SCOPE_RULES = [
  {
    name: 'frontend-must-not-store-session-credentials',
    root: 'ops-center/frontend/src',
    forbid: [
      { re: /ops_token/, why: '会话凭据不得进 localStorage（P1-15：XSS 可直接外带 token）' },
      { re: /isTokenExpired/, why: '前端不再持有 token，过期判定只由后端做（本地预判会造成半登录态）' },
      { re: /headers\.Authorization\s*=/, why: '禁止手工拼 Authorization 头；Cookie 会话由浏览器自动携带' },
      { re: /defaults\.headers\.common\[/, why: '禁止全局注入 Authorization 默认头（凭据泄露面扩大且难以回收）' },
    ],
  },
  {
    name: 'views-must-use-shared-api-client',
    root: 'ops-center/frontend/src/views',
    forbid: [
      {
        re: /axios\.create\(/,
        why: 'view 必须用 api/http.js 的 createApiClient()（统一 withCredentials + CSRF 头 + 401 处理），不得自建实例',
      },
      { re: /interceptors\.request\.use\(/, why: '请求拦截器只允许在 api/http.js 集中定义' },
    ],
  },
];

/** 关键文件结构断言：任一缺失说明加固被删/绕过。 */
const FILE_RULES = [
  {
    file: 'ops-center/backend/routers/auth.py',
    must: [/response\.set_cookie\(/, /httponly\s*=\s*True/, /samesite\s*=\s*settings\.session_cookie_samesite/, /def logout/, /delete_cookie\(/],
    mustNot: [/"token"\s*:/],
    note: '登录必须签发 HttpOnly 会话 Cookie 并提供登出，且响应体不得回传 token',
  },
  {
    file: 'ops-center/backend/middleware/auth.py',
    must: [/csrf_header/, /HTTP_403_FORBIDDEN/, /SAFE_METHODS/],
    note: 'Cookie 会话的写操作必须有 CSRF 自定义头关卡，幂等方法免检',
  },
  {
    file: 'ops-center/backend/main.py',
    must: [/async def security_headers/, /Content-Security-Policy/, /X-Content-Type-Options/, /Referrer-Policy/],
    note: '后端必须下发 CSP / nosniff / no-referrer',
  },
  {
    file: 'ops-center/backend/config.py',
    must: [/session_cookie_name/, /is_session_cookie_secure/, /content_security_policy/],
    note: '会话 Cookie 与 CSP 必须可配置，且 Secure 默认按 ENVIRONMENT 判定',
  },
  {
    file: 'ops-center/frontend/src/api/http.js',
    must: [/export const CSRF_HEADER = 'X-Ops-Session'/, /withCredentials:\s*true/, /status === 401/],
    note: '统一客户端必须开 withCredentials 并注入 CSRF 头，401 才清态',
  },
  {
    file: 'ops-center/frontend/src/router/index.js',
    must: [/await authStore\.restore\(\)/],
    note: '路由守卫必须异步向后端探测会话（前端无法本地判活）',
  },
  {
    file: 'ops-center/deploy/nginx-ops.conf',
    must: [/add_header Content-Security-Policy/, /frame-ancestors 'none'/],
    note: '静态资源层的 CSP 只能由 nginx 下发（frame-ancestors 在 meta 通道无效）',
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function analyze(root) {
  const violations = [];
  let scannedFiles = 0;

  for (const rule of SCOPE_RULES) {
    const dir = path.join(root, rule.root);
    if (!fs.existsSync(dir)) {
      violations.push({ kind: 'missing-dir', name: rule.name, detail: `目录不存在：${rule.root}` });
      continue;
    }
    for (const file of walk(dir)) {
      scannedFiles += 1;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const banned of rule.forbid) {
          if (banned.re.test(line)) {
            violations.push({
              kind: 'forbidden-pattern',
              name: rule.name,
              detail: `${path.relative(root, file).replace(/\\/g, '/')}:${idx + 1} ${banned.why}`,
              snippet: line.trim().slice(0, 160),
            });
          }
        }
      });
    }
  }

  for (const rule of FILE_RULES) {
    const file = path.join(root, rule.file);
    if (!fs.existsSync(file)) {
      violations.push({ kind: 'missing-file', name: 'required-file', detail: `${rule.file} 不存在：${rule.note}` });
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const re of rule.must || []) {
      if (!re.test(text)) {
        violations.push({ kind: 'must-missing', name: 'required-structure', detail: `${rule.file} 缺少 ${re} —— ${rule.note}` });
      }
    }
    for (const re of rule.mustNot || []) {
      if (re.test(text)) {
        violations.push({ kind: 'mustnot-present', name: 'forbidden-structure', detail: `${rule.file} 出现了 ${re} —— ${rule.note}` });
      }
    }
  }

  return { violations, scannedFiles };
}

function main(argv) {
  const root = path.resolve(__dirname, '..', '..');
  const { violations, scannedFiles } = analyze(root);
  const verbose = argv.includes('--verbose');

  for (const v of violations) {
    console.log(`[FAIL] ${v.kind} :: ${v.name} :: ${v.detail}${v.snippet ? ` :: ${v.snippet}` : ''}`);
  }
  if (verbose) {
    console.log(`扫描文件数: ${scannedFiles}（scope 规则 ${SCOPE_RULES.length} 条 / 文件断言 ${FILE_RULES.length} 条）`);
  }
  if (violations.length) {
    console.log(`ops-center 会话卫生检查未通过：${violations.length} 项违规`);
    return 1;
  }
  console.log(`ops-center 会话卫生检查通过（扫描 ${scannedFiles} 个文件，${SCOPE_RULES.length + FILE_RULES.length} 组规则）`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { analyze, walk, SCOPE_RULES, FILE_RULES };
