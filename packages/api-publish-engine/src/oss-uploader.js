
/**
 * 阿里云 OSS 分片上传引擎 (提取自参考产品)
 */
const crypto = require("crypto"); const fs = require("fs");
const axios = require("axios");
const CHUNK = 8 * 1024 * 1024;
class OssUploader {
  constructor() { this.ua = "aliyun-sdk-js/6.8.0"; }
  _sign(method, headers, resource, ak) {
    const els = [method, "", "video/mp4", headers["x-oss-date"],
      "x-oss-date:" + headers["x-oss-date"],
      "x-oss-security-token:" + headers["x-oss-security-token"],
      "x-oss-user-agent:" + this.ua, resource];
    return crypto.createHmac("sha1", ak)
      .update(els.join("\n")).digest("base64");
  }
  async upload(filePath, uv, onProgress) {
    const { endpoint, upload_token: ut, upload_file: uf } = uv;
    const sz = fs.statSync(filePath).size;
    const total = Math.ceil(sz / CHUNK);
    const base = "https://" + endpoint + "/" + uf.object_key;
    const parts = []; const d = new Date().toUTCString();
    let h = { "x-oss-date": d, "x-oss-security-token": ut.access_token, "x-oss-user-agent": this.ua };
    h["Authorization"] = "OSS " + ut.access_id + ":" + this._sign("POST", h, "/" + uf.object_key + "?uploads", ut.access_key);
    const init = await axios.post(base + "?uploads", "", { headers: h });
    const uid = init.data?.UploadId;
    if (!uid) throw new Error("Failed to get upload ID");
    for (let i = 0; i < total; i++) {
      const buf = Buffer.alloc(Math.min(CHUNK, sz - i * CHUNK));
      const fd = fs.openSync(filePath, "r");
      try {
        fs.readSync(fd, buf, 0, buf.length, i * CHUNK);
      } finally {
        fs.closeSync(fd);
      }
      const pn = i + 1; const dt = new Date().toUTCString();
      const res = "/" + uf.object_key + "?partNumber=" + pn + "&uploadId=" + uid;
      let h2 = { "x-oss-date": dt, "x-oss-security-token": ut.access_token, "x-oss-user-agent": this.ua };
      h2["Authorization"] = "OSS " + ut.access_id + ":" + this._sign("PUT", h2, res, ut.access_key);
      const r = await axios.put(base + "?partNumber=" + pn + "&uploadId=" + uid, buf, { headers: h2 });
      parts.push({ PartNumber: pn, ETag: r.headers.etag });
      if (onProgress) onProgress(Math.round((i+1)/total*100));
    }
    const xml = "<CompleteMultipartUpload>" + parts.map(p =>
      "<Part><PartNumber>" + p.PartNumber + "</PartNumber><ETag>" + p.ETag + "</ETag></Part>"
    ).join("") + "</CompleteMultipartUpload>";
    const md5 = crypto.createHash("md5").update(xml).digest("base64");
    const de = new Date().toUTCString();
    const re = "/" + uf.object_key + "?uploadId=" + uid;
    let h3 = { "x-oss-date": de, "x-oss-security-token": ut.access_token, "x-oss-user-agent": this.ua, "Content-MD5": md5 };
    h3["Authorization"] = "OSS " + ut.access_id + ":" + this._sign("POST", h3, re, ut.access_key);
    await axios.post(base + "?uploadId=" + uid, xml, { headers: h3 });
    return { objectKey: uf.object_key };
  }
}
module.exports = { OssUploader, CHUNK };
