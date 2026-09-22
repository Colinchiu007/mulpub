'use strict';

/**
 * P1-11（体检报告问题11）：链接下载 SSRF / 域名白名单守卫。
 *
 * 背景：ingest-url 过去把用户提交的任意 https URL 直传 yt-dlp。yt-dlp 会真实建连并跟随
 * 重定向，于是 `https://169.254.169.254/...`、`https://localhost:8788/` 这类地址变成了
 * 内网探测/云元数据读取通道（桌面端与自建网关同机部署时危害更大）。
 *
 * 与 Python 侧 `multi_publish/aggregation/video_service.py` 对齐：
 *   detect_platform 域名白名单 + _is_private_address 内网拦截；
 * 并补强 Python 侧没有的部分：对白名单域名做 DNS 解析结果校验（防"公网域名 → 内网 IP"重绑定）。
 *
 * 残余风险（须知）：yt-dlp 内部跟随的 30x 重定向不经过本守卫，最终约束依赖
 * "目标域名在白名单内"这一前提；如需覆盖任意重定向，必须在下载器侧加代理/ACL。
 */

const dns = require('node:dns');
const net = require('node:net');
const { PLATFORMS } = require('../constants');
const { VideoCloneError } = require('../errors');

/** 平台域名白名单（与 PLATFORMS 枚举一一对应，唯一事实来源） */
const PLATFORM_HOSTS = Object.freeze({
  douyin: ['douyin.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  kuaishou: ['kuaishou.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
  shipinhao: ['weixin.qq.com', 'channels.weixin.qq.com'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com'],
});

/** 域名 → 平台（精确或子域命中） */
function matchPlatformHost (host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  for (const p of PLATFORMS) {
    if ((PLATFORM_HOSTS[p] || []).some((d) => h === d || h.endsWith('.' + d))) return p;
  }
  return null;
}

function isIpLiteral (host) {
  return net.isIP(String(host).replace(/^\[|\]$/g, '')) !== 0;
}

/** 内网 / 回环 / 链路本地 / 元数据 / ULA 地址判定（IPv4 + IPv6） */
function isPrivateAddress (host) {
  let h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return true;
  // 云厂商元数据服务与常见内网域名后缀
  if (h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.lan')) return true;
  if (h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  if (h.startsWith('172.')) {
    const second = Number(h.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (h.startsWith('0.0.0.0')) return true;
  // IPv6：fc00::/7 ULA、fe80::/10 link-local、IPv4-mapped
  const v6 = h.replace(/\./g, ':');
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (v6 !== h) return isPrivateAddress(v6);
  return false;
}

/** 默认解析器：dns.promises.lookup 的 all 模式 */
async function defaultResolveAddr (host) {
  return dns.promises.lookup(host, { all: true, verbatim: true });
}

/**
 * 校验下载链接。返回 { url, host, platform }；不合法直接抛 VideoCloneError。
 * @param {string} url
 * @param {object} [options]
 * @param {(host:string)=>Promise<Array<{address:string}>>} [options.resolveAddr] 注入 DNS（测试用）
 * @param {boolean} [options.resolveDns=true] 是否校验解析结果
 * @param {string} [options.allowAnyHost] 显式放开白名单（默认取 env VIDEOCLONE_ALLOW_ANY_HOST）
 */
async function assertSafeIngestUrl (url, options = {}) {
  const { resolveAddr = defaultResolveAddr, resolveDns = true } = options;
  const allowAnyHost = options.allowAnyHost != null
    ? options.allowAnyHost
    : String(process.env.VIDEOCLONE_ALLOW_ANY_HOST || '').toLowerCase() === 'true';

  let parsed;
  try { parsed = new URL(String(url)); } catch (e) {
    throw new VideoCloneError('VIDEOCLONE_SOURCE_UNSUPPORTED', { phase: 'ingest', params: { url } });
  }
  if (parsed.protocol !== 'https:') {
    throw new VideoCloneError('VIDEOCLONE_SOURCE_UNSUPPORTED', { phase: 'ingest', params: { url } });
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new VideoCloneError('VIDEOCLONE_SOURCE_UNSUPPORTED', { phase: 'ingest', params: { url } });
  }
  if (isPrivateAddress(host)) {
    throw new VideoCloneError('VIDEOCLONE_LINK_BLOCKED', { phase: 'ingest', params: { host } });
  }
  const platform = matchPlatformHost(host);
  if (!platform && !allowAnyHost) {
    throw new VideoCloneError('VIDEOCLONE_SOURCE_UNSUPPORTED', { phase: 'ingest', params: { url, host } });
  }
  if (resolveDns && !isIpLiteral(host)) {
    let records;
    try {
      records = await resolveAddr(host);
    } catch (err) {
      // 解析失败按不可用处理（fail-closed），不回退成"放行"
      throw new VideoCloneError('VIDEOCLONE_LINK_UNAVAILABLE', { phase: 'ingest', params: { host }, cause: err });
    }
    if (!records || records.length === 0) {
      // 解析成功但无地址记录（无 A/AAAA）视同不可用：不得因"没有内网地址"而放行
      throw new VideoCloneError('VIDEOCLONE_LINK_UNAVAILABLE', { phase: 'ingest', params: { host } });
    }
    for (const r of records) {
      if (isPrivateAddress(r.address)) {
        throw new VideoCloneError('VIDEOCLONE_LINK_BLOCKED', { phase: 'ingest', params: { host, address: r.address } });
      }
    }
  }
  return { url: parsed.toString(), host, platform };
}

module.exports = {
  PLATFORM_HOSTS,
  matchPlatformHost,
  isIpLiteral,
  isPrivateAddress,
  assertSafeIngestUrl,
  defaultResolveAddr,
};
