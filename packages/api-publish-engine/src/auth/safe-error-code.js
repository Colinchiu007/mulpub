'use strict'

// 语义错误码守卫：只接受形如 ^[A-Z][A-Z0-9_]{2,63}$ 的语义码，否则回落到兜底码，
// 绝不把 SQLSTATE 等内部原文外泄给调用方。原先定义于 publish-api-server.js，
// 因商务辅助方法拆分后被两处共用，提取到此共享 util 以避免循环 require。
function safeErrorCode(error, fallback) {
  const code = error && typeof error.code === "string" ? error.code : "";
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : fallback;
}

module.exports = { safeErrorCode };
