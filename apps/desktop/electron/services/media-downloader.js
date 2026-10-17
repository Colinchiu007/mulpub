// @ts-check
/**
 * MediaDownloader ? ????????
 *
 * ? MediaTrace ipc.ts ??????????
 * - Readable.fromWeb() + Transform ? + pipeline()
 * - ??????
 * - Content-Type ? ?????
 * - Content-Disposition ?????
 * - ???????
 * - AbortSignal ??
 *
 * ????: apps/desktop/electron/services/media-downloader.js
 */

const fs = require("fs");
const { MIME_TO_EXT: IMAGE_MIME_TO_EXT, LEGACY_MIME_ALIASES: IMAGE_LEGACY_ALIASES } = require('@multi-publish/shared-utils/src/image-mime')
const IMAGE_LEGACY_ALIAS_MIME = Object.keys(IMAGE_LEGACY_ALIASES)[0] // 'image/jpg'
const path = require("path");
const { pipeline: streamPipeline } = require("stream");
const { promisify } = require("util");
const log = require("./logger");

const pipelineAsync = promisify(streamPipeline);

/**
 * SSRF 防护：校验外部 URL（协议白名单 + 内网 IP 黑名单）
 * 与 url-collector.js / publish-poller.js 保持一致的校验规则
 */
function _validateExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { ok: false, reason: "URL 格式不正确" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: "仅支持 http/https 协议" };
  }
  const hostname = parsed.hostname.toLowerCase();
  const isInternal =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith("169.254.") ||
    hostname.endsWith(".local");
  if (isInternal) {
    return { ok: false, reason: "不允许访问内网地址" };
  }
  return { ok: true };
}

// ??? Content-Type ? ????? ??????????????????????????

const CONTENT_TYPE_MAP = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/x-msvideo": ".avi",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
  "video/ogg": ".ogv",
  // R7：图片三族引自单一真源；「image/jpg」历史兼容条目亦来自真源 LEGACY_MIME_ALIASES 的规范 mime
  //   （别名登记见 image-mime.js —— 兼容例外是真源显式概念，不是散落的隐藏例外）。
  ...IMAGE_MIME_TO_EXT,
  [IMAGE_LEGACY_ALIAS_MIME]: '.jpg',
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".weba",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
};

/**
 * ?? Content-Type ???????
 * @param {string} contentType - HTTP Content-Type ?
 * @returns {string} ??????????????? .bin
 */
function getExtensionFromContentType(contentType) {
  if (!contentType || typeof contentType !== "string") return ".bin";
  const key = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_MAP[key] || ".bin";
}

// ??? Content-Disposition ?? ???????????????????????????

/**
 * ? Content-Disposition ???????
 * ??????? RFC 5987 (filename*)
 * @param {string} disposition - Content-Disposition ??
 * @returns {string|null} ????????? null
 */
function getFileNameFromDisposition(disposition) {
  if (!disposition || typeof disposition !== "string") return null;

  // RFC 5987: filename*=UTF-8''%E6%96%87%E4%BB%B6.mp4
  const rfc5987Match = disposition.match(/filename\*\s*=\s*(?:UTF-8|ISO-8859-1)''([^;\s]+)/i);
  if (rfc5987Match) {
    try {
      return decodeURIComponent(rfc5987Match[1]);
    } catch {
      // fall through to filename=
    }
  }

  // Standard: filename="value" or filename=value
  const stdMatch = disposition.match(/filename\s*=\s*"([^"]*)"(?:\s*;|$)/i) ||
                   disposition.match(/filename\s*=\s*([^;\s]+)/i);
  if (stdMatch) {
    return stdMatch[1];
  }

  return null;
}

// ??? ??????? ?????????????????????????????????????

/**
 * ???????????????????? (1), (2)... ??
 * @param {string} filePath - ??????
 * @returns {string} ??????
 */
function ensureUniqueFilePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  let counter = 1;
  let newPath;
  do {
    newPath = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  } while (fs.existsSync(newPath));

  return newPath;
}

// ??? ????? ?????????????????????????????????????????

/**
 * ????????
 *
 * @param {string} url - ?? URL
 * @param {string} destDir - ??????????
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - ????
 * @param {function} [options.onProgress] - ???? (received, total)
 * @param {string} [options.filename] - ??????????????
 * @param {object} [options.headers] - ??????
 * @param {string} [options.defaultExt] - ??????????????
 * @returns {Promise<{filePath: string, size: number, contentType: string}>}
 */
async function downloadMedia(url, destDir, options = {}) {
  const { signal, onProgress, filename, headers, defaultExt } = options;

  // ????
  if (!fs.existsSync(destDir)) {
    throw new Error(`Destination directory does not exist: ${destDir}`);
  }

  // ??????
  if (signal && signal.aborted) {
    throw new Error("Download aborted");
  }

  const axios = require("axios");

  // 安全修复：SSRF 防护 — 校验 URL 协议白名单 + 内网 IP 黑名单
  const ssrfCheck = _validateExternalUrl(url);
  if (!ssrfCheck.ok) {
    throw new Error("SSRF blocked: " + ssrfCheck.reason);
  }

  const resp = await axios.get(url, {
    responseType: "stream",
    headers: headers || {},
    signal,
  });

  const contentType = resp.headers["content-type"] || "";
  const contentDisposition = resp.headers["content-disposition"] || "";
  const totalSize = parseInt(resp.headers["content-length"] || "0", 10) || 0;

  // 确定文件名
  let finalFilename = filename;
  if (!finalFilename) {
    finalFilename = getFileNameFromDisposition(contentDisposition);
  }
  if (!finalFilename) {
    // 从 URL 路径提取
    const urlPath = new URL(url).pathname;
    const urlBase = path.basename(urlPath);
    if (urlBase && urlBase.includes(".")) {
      finalFilename = urlBase;
    } else {
      const ext = getExtensionFromContentType(contentType);
      finalFilename = `download${ext === ".bin" && defaultExt ? defaultExt : ext}`;
    }
  }

  // 安全防护：剥离目录部分，防止路径穿越（../ 注入）
  finalFilename = path.basename(finalFilename);
  // 解码可能的 URL 编码后再次剥离（防止 %2E%2E%2F 绕过）
  try { finalFilename = path.basename(decodeURIComponent(finalFilename)) } catch { /* 无效编码保持原值 */ }
  if (!finalFilename || finalFilename === '.' || finalFilename === '..') {
    const ext = getExtensionFromContentType(contentType);
    finalFilename = `download${ext === ".bin" && defaultExt ? defaultExt : ext}`;
  }

  const filePath = ensureUniqueFilePath(path.join(destDir, finalFilename));
  let receivedBytes = 0;

  // ?????
  const { Transform } = require("stream");
  const progressTransform = new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk.length;
      if (onProgress && totalSize > 0) {
        onProgress(receivedBytes, totalSize);
      }
      callback(null, chunk);
    },
  });

  const writer = fs.createWriteStream(filePath);

  try {
    if (signal) {
      // ??????
      const cleanup = () => {
        resp.data.destroy();
        writer.destroy();
        // ?????????
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore */ }
      };
      signal.addEventListener("abort", cleanup, { once: true });
    }

    await pipelineAsync(resp.data, progressTransform, writer);

    // ???? 100%
    if (onProgress && totalSize > 0) {
      onProgress(totalSize, totalSize);
    }

    const stats = fs.statSync(filePath);
    log.info("MediaDownloader", `Downloaded: ${finalFilename} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    return {
      filePath,
      size: stats.size,
      contentType,
    };
  } catch (err) {
    // ?????????
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
    throw err;
  }
}

module.exports = {
  getExtensionFromContentType,
  getFileNameFromDisposition,
  ensureUniqueFilePath,
  downloadMedia,
};

