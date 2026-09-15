/**
 * COS/OSS 分片上传引擎 (提取自参考产品)
 */
const crypto = require("crypto"); const fs = require("fs");
const axios = require("axios");
const CHUNK = 8 * 1024 * 1024;
class CosUploader {
  async upload(filePath, token, prog) {
    const sz = fs.statSync(filePath).size;
    const total = Math.ceil(sz / CHUNK);
    const parts = [];
    const base = token.uploadAddr + "/" + token.fileIds[0];
    const init = await axios.post(base + "?uploads", "", { headers: { "x-cos-security-token": token.token } });
    const uid = init.data?.UploadId;
    for (let i = 0; i < total; i++) {
      const buf = Buffer.alloc(Math.min(CHUNK, sz - i * CHUNK));
      const fd = fs.openSync(filePath, "r");
      try {
        fs.readSync(fd, buf, 0, buf.length, i * CHUNK);
      } finally {
        fs.closeSync(fd);
      }
      const r = await axios.put(base + "?partNumber=" + (i+1) + "&uploadId=" + uid, buf, {
        headers: { "x-cos-security-token": token.token } });
      parts.push({ PartNumber: i+1, ETag: r.headers.etag });
      if (prog) prog(Math.round((i+1)/total*100));
    }
    const xml = "<CompleteMultipartUpload>" + parts.map(p =>
      "<Part><PartNumber>" + p.PartNumber + "</PartNumber><ETag>" + p.ETag + "</ETag></Part>"
    ).join("") + "</CompleteMultipartUpload>";
    const md5 = crypto.createHash("md5").update(xml).digest("base64");
    await axios.post(base + "?uploadId=" + uid, xml, {
      headers: { "x-cos-security-token": token.token, "Content-MD5": md5 } });
    return { fileId: token.fileIds[0] };
  }
}
module.exports = { CosUploader, CHUNK };