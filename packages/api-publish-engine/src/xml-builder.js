/**
 * 视频号 XML 内容构建器 (提取自参考产品 FinderXmlBuilder)
 */
class FinderXmlBuilder {
  buildContent(content) {
    const parts = ["<finder>", "  <version>1</version>"];
    const segs = this._parse(content);
    parts.push("  <valuecount>" + segs.length + "</valuecount>");
    const ats = [];
    segs.forEach((s, i) => {
      if (s.t === "topic") {
        parts.push("  <value" + i + " raw=\"" + JSON.stringify(s.r) + "\"><![CDATA[" + s.text + "]]></value" + i + ">");
      } else {
        parts.push("  <value" + i + "><![CDATA[" + s.text + "]]></value" + i + ">");
        if (s.t === "mention") ats.push(i);
      }
    });
    if (ats.length) parts.push("  <style><at>" + ats.join(",") + "</at></style>");
    parts.push("</finder>");
    return parts.join(String.fromCharCode(10));
  }
  _parse(html) {
    const segs = [];
    const re = /(#[^#]+#|@[\u4e00-\u9fa5\w]+)/g;
    let idx = 0, m;
    while ((m = re.exec(html)) !== null) {
      if (m.index > idx) segs.push({ t: "text", text: html.slice(idx, m.index) });
      if (m[1] && m[1].startsWith("#")) segs.push({ t: "topic", text: m[0], r: { name: m[1].slice(1,-1) } });
      else if (m[1]) segs.push({ t: "mention", text: m[0] });
      idx = m.index + m[0].length;
    }
    if (idx < html.length) segs.push({ t: "text", text: html.slice(idx) });
    return segs;
  }
  _esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;"); }
}
module.exports = { FinderXmlBuilder };