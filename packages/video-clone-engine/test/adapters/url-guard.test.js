'use strict';

/**
 * P1-11（体检报告问题11）：链接下载 SSRF / 域名白名单守卫。
 * 覆盖：协议白名单、内网/回环/链路本地/元数据/ULA 字面量拦截、平台域名白名单（含后缀伪装）、
 *       公网域名 → 内网 IP 的 DNS 重绑定拦截、解析失败 fail-closed、
 *       VIDEOCLONE_ALLOW_ANY_HOST 显式放开的边界、以及"拦截必须发生在下载之前"。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PLATFORM_HOSTS, matchPlatformHost, isIpLiteral, isPrivateAddress, assertSafeIngestUrl,
} = require('../../src/adapters/url-guard');
const { createUrlIngest, urlGuard } = require('../../src/adapters/ingest-url');
const { PLATFORMS } = require('../../src/constants');

const PUB = async () => [{ address: '142.250.190.78' }];
const toPrivate = (ip) => async () => [{ address: ip }];

async function expectCode(code, url, options = {}) {
  let err;
  try { await assertSafeIngestUrl(url, options); } catch (e) { err = e; }
  assert.ok(err, `期望被拦截但放行了: ${url}`);
  assert.equal(err.code, code, `${url} 错误码应为 ${code}，实际 ${err.code}（${err.message}）`);
  assert.equal(err.name, 'VideoCloneError');
  assert.equal(err.phase, 'ingest');
}

test('isPrivateAddress 覆盖回环/私网/链路本地/元数据/ULA/内网域名后缀', () => {
  for (const h of [
    'localhost', 'api.localhost', '127.0.0.1', '127.5.5.5', '0.0.0.0',
    '10.1.2.3', '192.168.0.7', '172.16.0.1', '172.31.255.255', '169.254.169.254',
    '::1', '[::1]', 'fc00::1', 'fd12:3456::7', 'fe80::1',
    'metadata.google.internal', 'svc.internal', 'nas.local', 'router.lan',
    '::ffff:169.254.169.254', '[::ffff:10.0.0.1]',
  ]) assert.equal(isPrivateAddress(h), true, `${h} 应判为内网`);
  for (const h of [
    'douyin.com', '142.250.190.78', '172.15.0.1', '172.32.0.1', '11.0.0.1',
    '192.169.1.1', '100.64.0.1', '', 'example.com',
  ]) assert.equal(isPrivateAddress(h), false, `${h} 不应误判为内网`);
});

test('isIpLiteral 区分 IP 字面量与域名', () => {
  assert.equal(isIpLiteral('127.0.0.1'), true);
  assert.equal(isIpLiteral('[::1]'), true);
  assert.equal(isIpLiteral('::1'), true);
  assert.equal(isIpLiteral('douyin.com'), false);
});

test('matchPlatformHost 精确/子域命中，且不被后缀伪装骗过', () => {
  assert.equal(matchPlatformHost('douyin.com'), 'douyin');
  assert.equal(matchPlatformHost('www.douyin.com'), 'douyin');
  assert.equal(matchPlatformHost('v.douyin.com'), 'douyin');
  assert.equal(matchPlatformHost('B23.TV'), 'bilibili');
  assert.equal(matchPlatformHost('channels.weixin.qq.com'), 'shipinhao');
  assert.equal(matchPlatformHost('youtu.be'), 'youtube');
  // 攻击面：evil-douyin.com / douyin.com.attacker.io 都不得命中
  assert.equal(matchPlatformHost('evil-douyin.com'), null);
  assert.equal(matchPlatformHost('douyin.com.attacker.io'), null);
  assert.equal(matchPlatformHost('notxhslink.com'), null);
  assert.equal(matchPlatformHost(''), null);
});

test('PLATFORM_HOSTS 与 PLATFORMS 枚举一一对应（唯一事实来源，防漏配）', () => {
  assert.deepEqual(Object.keys(PLATFORM_HOSTS).sort(), [...PLATFORMS].sort());
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    assert.ok(hosts.length > 0, `${platform} 白名单为空`);
    for (const d of hosts) {
      assert.equal(matchPlatformHost(d), platform, `${d} 应归属 ${platform}`);
    }
  }
});

test('urlGuard 从 ingest-url 入口可达（调用方无需 require 内部路径）', () => {
  assert.equal(typeof urlGuard.assertSafeIngestUrl, 'function');
});

test('非 https 协议 / 非法 URL → SOURCE_UNSUPPORTED（file、http、javascript 一律拒绝）', async () => {
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'http://douyin.com/video/1', { resolveAddr: PUB });
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'file:///etc/passwd', { resolveAddr: PUB });
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'ftp://10.0.0.1/x', { resolveAddr: PUB });
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'not-a-url', { resolveAddr: PUB });
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', '', { resolveAddr: PUB });
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', null, { resolveAddr: PUB });
});

test('内网/元数据字面量 → LINK_BLOCKED（独立错误码，不得冒充「视频私密」）', async () => {
  const urls = [
    'https://127.0.0.1:8788/admin',
    'https://localhost:8788/',
    'https://0.0.0.0/',
    'https://10.1.2.3/internal',
    'https://192.168.1.1/',
    'https://172.16.5.5/',
    'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'https://[::1]/',
    'https://[fc00::1]/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://db.internal/',
  ];
  for (const url of urls) await expectCode('VIDEOCLONE_LINK_BLOCKED', url, { resolveAddr: PUB });
});

test('非白名单域名 → SOURCE_UNSUPPORTED（公网可解析也不放行）', async () => {
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'https://evil.example.com/x.mp4', { resolveAddr: PUB });
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'https://attacker.io', { resolveAddr: PUB });
});

test('白名单域名 DNS 重绑定到内网 → LINK_BLOCKED（多解析结果任一内网即拒）', async () => {
  await expectCode('VIDEOCLONE_LINK_BLOCKED', 'https://www.douyin.com/video/123', { resolveAddr: toPrivate('169.254.169.254') });
  await expectCode('VIDEOCLONE_LINK_BLOCKED', 'https://b23.tv/abc', { resolveAddr: toPrivate('10.0.0.8') });
  await expectCode('VIDEOCLONE_LINK_BLOCKED', 'https://youtube.com/watch?v=1', {
    resolveAddr: async () => [{ address: '142.250.190.78' }, { address: '127.0.0.1' }],
  });
});

test('DNS 解析失败 → fail-closed LINK_UNAVAILABLE（绝不回退成放行）', async () => {
  const boom = async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); };
  await expectCode('VIDEOCLONE_LINK_UNAVAILABLE', 'https://www.douyin.com/video/123', { resolveAddr: boom });
  await expectCode('VIDEOCLONE_LINK_UNAVAILABLE', 'https://youtu.be/abc', { resolveAddr: async () => [] });
});

test('放行路径：白名单 + 公网解析 → 返回 { url, host, platform }', async () => {
  const r = await assertSafeIngestUrl('https://www.douyin.com/video/123?x=1', { resolveAddr: PUB });
  assert.equal(r.platform, 'douyin');
  assert.equal(r.host, 'www.douyin.com');
  assert.match(r.url, /^https:\/\/www\.douyin\.com\/video\/123/);
});

test('allowAnyHost 显式放开白名单（env VIDEOCLONE_ALLOW_ANY_HOST），但内网拦截不放松', async () => {
  const r = await assertSafeIngestUrl('https://mirror.example.org/video.mp4', { allowAnyHost: true, resolveAddr: PUB });
  assert.equal(r.platform, null);
  await expectCode('VIDEOCLONE_LINK_BLOCKED', 'https://169.254.169.254/', { allowAnyHost: true, resolveAddr: PUB });
  await expectCode('VIDEOCLONE_LINK_BLOCKED', 'https://mirror.example.org/', { allowAnyHost: true, resolveAddr: toPrivate('192.168.1.9') });
  // env 生效（不指定 options.allowAnyHost 时读环境变量）
  process.env.VIDEOCLONE_ALLOW_ANY_HOST = 'true';
  try {
    const viaEnv = await assertSafeIngestUrl('https://mirror.example.org/v.mp4', { resolveAddr: PUB });
    assert.equal(viaEnv.host, 'mirror.example.org');
  } finally {
    delete process.env.VIDEOCLONE_ALLOW_ANY_HOST;
  }
  await expectCode('VIDEOCLONE_SOURCE_UNSUPPORTED', 'https://mirror.example.org/v.mp4', { resolveAddr: PUB });
});

test('resolveDns=false 与 IP 字面量场景不触发 DNS', async () => {
  let called = 0;
  const spy = async () => { called++; return [{ address: '142.250.190.78' }]; };
  await assertSafeIngestUrl('https://www.douyin.com/video/1', { resolveAddr: spy, resolveDns: false });
  assert.equal(called, 0);
  // 公网 IP 字面量（allowAnyHost）本身跳过 DNS（无域名可解析）
  await assertSafeIngestUrl('https://8.8.8.8/video.mp4', { resolveAddr: spy, allowAnyHost: true });
  assert.equal(called, 0);
});

test('VIDEOCLONE_LINK_BLOCKED 已完成目录登记（phase/retryable/userMessageKey 契约）', () => {
  const { ERROR_CATALOG } = require('../../src/errors');
  const meta = ERROR_CATALOG.VIDEOCLONE_LINK_BLOCKED;
  assert.ok(meta, '新增错误码必须进 ERROR_CATALOG，否则渲染端拿到未知码无文案可显');
  assert.equal(meta.phase, 'ingest');
  assert.equal(meta.retryable, false);
  assert.equal(meta.userMessageKey, 'videoClone.error.linkBlocked');
});

test('createUrlIngest：拦截必须发生在建临时目录/调下载器之前', async () => {
  let mkdtempCalls = 0;
  let downloadCalls = 0;
  const ingest = createUrlIngest({
    downloadRunner: async () => { downloadCalls++; },
    fsImpl: { promises: { mkdtemp: async () => { mkdtempCalls++; return 'tmp'; }, stat: async () => ({ size: 1 }) } },
    resolveAddr: PUB,
  });
  const ctx = { request: { source: { url: 'https://169.254.169.254/latest/meta-data/' } }, artifacts: {}, report: { meta: {} } };
  let err;
  try { await ingest.run(ctx); } catch (e) { err = e; }
  assert.equal(err.code, 'VIDEOCLONE_LINK_BLOCKED');
  assert.equal(mkdtempCalls, 0, '被拦截时不得创建临时目录');
  assert.equal(downloadCalls, 0, '被拦截时不得调用 yt-dlp');
  assert.equal(ctx.artifacts.media, undefined);
});

test('createUrlIngest：白名单公网链接正常下载（守卫不改变成功路径行为）', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const tmp = path.join(os.tmpdir(), 'vc-guard-' + Date.now());
  const ingest = createUrlIngest({
    downloadRunner: async () => {},
    fsImpl: { promises: { mkdtemp: async () => tmp, stat: async () => ({ size: 1024 }) } },
    resolveAddr: PUB,
  });
  const ctx = { request: { source: { url: 'https://www.douyin.com/video/999' } }, artifacts: {}, report: { meta: {} } };
  await ingest.run(ctx);
  assert.equal(ctx.artifacts.media.platform, 'douyin');
  assert.equal(ctx.artifacts.media.source, 'url');
});
