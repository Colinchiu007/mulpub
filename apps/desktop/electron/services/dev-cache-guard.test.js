import { describe, it, expect, vi } from "vitest";
const fs = require("fs");
const path = require("path");

const {
  installDevCacheGuard,
  isDevServerUrl,
  DEV_URL_FILTERS,
  NO_STORE_VALUE,
} = require("./dev-cache-guard");

// ---------------------------------------------------------------------------
// 事故背景（2026-10-14 / 2026-10-15 真机复核）
//   账号页报 `does not provide an export named 'PLATFORM_CREATOR_HOME_URLS'`。
//   四层取证结论：源码有导出 ✓、磁盘 .vite 产物有导出 ✓、HTTP GET 该 URL 返回 200 且 6 个导出 ✓，
//   但**渲染层 import 同一 URL 只拿到 4 个导出** ✗ ⇒ 是渲染进程 HTTP 磁盘缓存里躺着一份旧副本。
//   成因：Vite 给 deps 产物发的 `Cache-Control: max-age=31536000, immutable`，而 `?v=<hash>`
//   不含 workspace 源码内容 ⇒ 源码变了、URL 没变 ⇒ 缓存命中旧副本且**不做校验**。
//   修复必须两条腿（缺一不可）：
//     ① 启动时清一次 HTTP 缓存 —— 杀掉**已经**被污染的条目；
//     ② 对 dev server origin 强制 `no-store` —— 挡住**再次**污染。
//   只做 ① 挡不住再次污染；只做 ② 清不掉已污染的旧副本（实测就是后者导致"改了代码还是不生效"）。
// ---------------------------------------------------------------------------

function makeSession(overrides = {}) {
  return {
    clearCache: vi.fn(() => Promise.resolve()),
    webRequest: { onHeadersReceived: vi.fn() },
    ...overrides,
  };
}

/** 取出 onHeadersReceived 注册的 listener（并断言确实注册过） */
function captureListener(session) {
  expect(session.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1);
  const call = session.webRequest.onHeadersReceived.mock.calls[0];
  return { filter: call[0], listener: call[1] };
}

describe("dev-cache-guard", () => {
  describe("isDevServerUrl：只认本机回环 dev server", () => {
    it("接受 127.0.0.1 / localhost / [::1]（含端口与路径）", () => {
      expect(isDevServerUrl("http://127.0.0.1:5231/@vite/client")).toBe(true);
      expect(isDevServerUrl("http://127.0.0.1:5231/")).toBe(true);
      expect(isDevServerUrl("http://localhost:5231/src/main.js")).toBe(true);
      expect(isDevServerUrl("http://[::1]:5231/@fs/x.js")).toBe(true);
      expect(isDevServerUrl("https://127.0.0.1:5231/x.js")).toBe(true);
    });

    it("拒绝第三方与伪装域名（不得让 no-store 溢出到平台页面）", () => {
      expect(isDevServerUrl("https://mp.weixin.qq.com/cgi-bin/home")).toBe(false);
      expect(isDevServerUrl("https://creator.xiaohongshu.com/")).toBe(false);
      // 关键：不能靠「包含 127.0.0.1」这种子串判据
      expect(isDevServerUrl("https://evil.test/127.0.0.1:5231/x.js")).toBe(false);
      expect(isDevServerUrl("https://localhost.evil.test/x.js")).toBe(false);
      expect(isDevServerUrl("file:///D:/app/dist/index.html")).toBe(false);
      expect(isDevServerUrl("")).toBe(false);
      expect(isDevServerUrl(undefined)).toBe(false);
    });
  });

  describe("打包状态优先（不看任何开发环境变量）", () => {
    it("app.isPackaged === true → 完全不接管（不清缓存、不注册监听）", () => {
      const session = makeSession();
      const result = installDevCacheGuard({ app: { isPackaged: true }, session, log: { notify: vi.fn() } });
      expect(result.installed).toBe(false);
      expect(result.reason).toBe("packaged");
      expect(session.clearCache).not.toHaveBeenCalled();
      expect(session.webRequest.onHeadersReceived).not.toHaveBeenCalled();
    });

    it("残留开发信号不得让已打包应用进入本接管（结构锁：源码不读 NODE_ENV / ELECTRON_IS_DEV）", () => {
      const source = fs.readFileSync(path.join(__dirname, "dev-cache-guard.js"), "utf8");
      expect(source).not.toMatch(/NODE_ENV/);
      expect(source).not.toMatch(/ELECTRON_IS_DEV/);
      // 判据必须显式锚定 isPackaged === false
      expect(source).toMatch(/isPackaged\s*!==\s*false/);
    });

    it("app 缺失或 isPackaged 非 false → 同样不接管（fail-closed）", () => {
      const session = makeSession();
      expect(installDevCacheGuard({ app: null, session }).installed).toBe(false);
      expect(installDevCacheGuard({ app: {}, session }).installed).toBe(false);
      expect(installDevCacheGuard({ app: { isPackaged: "false" }, session }).installed).toBe(false);
      expect(session.clearCache).not.toHaveBeenCalled();
      expect(session.webRequest.onHeadersReceived).not.toHaveBeenCalled();
    });
  });

  describe("dev 模式：清缓存 + 对回环 origin 强制 no-store", () => {
    it("调用 clearCache 并注册 onHeadersReceived，filter 只覆盖回环 origin", () => {
      const session = makeSession();
      const result = installDevCacheGuard({ app: { isPackaged: false }, session, log: { notify: vi.fn() } });
      expect(result.installed).toBe(true);
      expect(session.clearCache).toHaveBeenCalledTimes(1);
      const { filter } = captureListener(session);
      expect(filter).toEqual({ urls: DEV_URL_FILTERS });
      expect(DEV_URL_FILTERS.every((url) => /127\.0\.0\.1|localhost|\[::1\]/.test(url))).toBe(true);
    });

    it("幂等：同一 session 重复安装只注册一次监听、只清一次缓存", () => {
      const session = makeSession();
      const app = { isPackaged: false };
      installDevCacheGuard({ app, session, log: { notify: vi.fn() } });
      const second = installDevCacheGuard({ app, session, log: { notify: vi.fn() } });
      expect(second.installed).toBe(false);
      expect(second.reason).toBe("already-installed");
      expect(session.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1);
      expect(session.clearCache).toHaveBeenCalledTimes(1);
    });

    it("clearCache 失败不抛、不阻断启动（旁路观测只 warn）", async () => {
      const log = { notify: vi.fn() };
      const session = makeSession({ clearCache: vi.fn(() => Promise.reject(new Error("boom"))) });
      expect(() => installDevCacheGuard({ app: { isPackaged: false }, session, log })).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      expect(log.notify).toHaveBeenCalled();
    });

    it("session 不可用（无 clearCache/webRequest）→ 不接管且不抛", () => {
      expect(() => installDevCacheGuard({ app: { isPackaged: false }, session: {}, log: { notify: vi.fn() } })).not.toThrow();
      expect(installDevCacheGuard({ app: { isPackaged: false }, session: {}, log: { notify: vi.fn() } }).installed).toBe(false);
      expect(installDevCacheGuard({ app: { isPackaged: false }, session: null }).installed).toBe(false);
    });
  });

  describe("响应头改写：把 immutable 抹成 no-store", () => {
    function runHandler(headers, url = "http://127.0.0.1:5231/@fs/x.js") {
      const session = makeSession();
      installDevCacheGuard({ app: { isPackaged: false }, session, log: { notify: vi.fn() } });
      const { listener } = captureListener(session);
      const callback = vi.fn();
      listener({ url, responseHeaders: headers }, callback);
      return callback;
    }

    it("Cache-Control 被改写为 no-store，并删除 ETag / Last-Modified", () => {
      const callback = runHandler({
        "Cache-Control": ["max-age=31536000, immutable"],
        ETag: ['"deadbeef"'],
        "Last-Modified": ["Wed, 14 Oct 2026 13:00:00 GMT"],
        "Content-Type": ["text/javascript"],
      });
      expect(callback).toHaveBeenCalledTimes(1);
      const { responseHeaders } = callback.mock.calls[0][0];
      expect(responseHeaders["Cache-Control"]).toEqual([NO_STORE_VALUE]);
      expect(responseHeaders.ETag).toBeUndefined();
      expect(responseHeaders["Last-Modified"]).toBeUndefined();
      expect(responseHeaders["Content-Type"]).toEqual(["text/javascript"]);
    });

    it("大小写不敏感（Chromium 可能回小写键名）", () => {
      const callback = runHandler({ "cache-control": ["immutable"], etag: ['"x"'] });
      const { responseHeaders } = callback.mock.calls[0][0];
      expect(responseHeaders["Cache-Control"]).toEqual([NO_STORE_VALUE]);
      expect(Object.keys(responseHeaders).some((k) => k.toLowerCase() === "etag")).toBe(false);
    });

    it("非回环 URL 不改写（第三方响应原样透传）", () => {
      const original = { "Cache-Control": ["max-age=60"], ETag: ['"keep"'] };
      const callback = runHandler(original, "https://mp.weixin.qq.com/cgi-bin/home");
      const { responseHeaders } = callback.mock.calls[0][0];
      expect(responseHeaders["Cache-Control"]).toEqual(["max-age=60"]);
      expect(responseHeaders.ETag).toEqual(['"keep"']);
    });

    it("responseHeaders 缺失/畸形时不抛，且 callback 恰好调用一次", () => {
      const c1 = runHandler(undefined);
      expect(c1).toHaveBeenCalledTimes(1);
      const c2 = runHandler({ "Cache-Control": "not-an-array" });
      expect(c2).toHaveBeenCalledTimes(1);
      expect(c2.mock.calls[0][0].responseHeaders["Cache-Control"]).toEqual([NO_STORE_VALUE]);
    });

    it("缺 Cache-Control 时也补上 no-store（不能只在已有该头时才改写）", () => {
      const callback = runHandler({ "Content-Type": ["text/javascript"] });
      const { responseHeaders } = callback.mock.calls[0][0];
      expect(responseHeaders["Cache-Control"]).toEqual([NO_STORE_VALUE]);
    });
  });

  // -------------------------------------------------------------------------
  // 以下三组锁来自 CCG 深度审查（claude critic，2026-10-15，基线 origin/main 565 行）
  //   i2：[::1] 等 URL pattern 若被 Chromium 拒绝会**同步抛错**，使 dev 启动直接崩
  //       （单测此前用假 listener，从不真正解析 filter，测不到这条路径）
  //   i5：filter 覆盖回环**所有端口** ⇒ 连带改写本机其他服务（后端 18357 / prompt 21157）
  //       的缓存语义，影响面超出必要范围
  //   i1：守卫装在硬编码的 defaultSession；若将来窗口改用 partition，修复**静默失效**
  // -------------------------------------------------------------------------
  describe("i2：注册失败不得让 dev 启动崩溃（fail-open 而非 fail-crash）", () => {
    it("onHeadersReceived 抛错 → 不抛、返回降级 reason，且『清缓存』那条腿仍生效", () => {
      const log = { notify: vi.fn() };
      const session = makeSession({
        webRequest: {
          onHeadersReceived: vi.fn(() => {
            throw new Error("Invalid url pattern");
          }),
        },
      });
      let result;
      expect(() => {
        result = installDevCacheGuard({ app: { isPackaged: false }, session, log });
      }).not.toThrow();
      expect(result.installed).toBe(true);
      expect(result.reason).toBe("headers-rewrite-unavailable");
      // 崩溃之外的另一条腿必须还在：否则「改了不生效」会以另一种形式回来
      expect(session.clearCache).toHaveBeenCalledTimes(1);
      expect(log.notify).toHaveBeenCalled();
    });

    it("注册失败后重试不被幂等挡住（允许换 filter 再试）", () => {
      let first = true;
      const session = makeSession({
        webRequest: {
          onHeadersReceived: vi.fn(() => {
            if (first) {
              first = false;
              throw new Error("bad pattern");
            }
          }),
        },
      });
      const app = { isPackaged: false };
      const r1 = installDevCacheGuard({ app, session, log: { notify: vi.fn() } });
      expect(r1.reason).toBe("headers-rewrite-unavailable");
      const r2 = installDevCacheGuard({ app, session, log: { notify: vi.fn() } });
      expect(r2.installed).toBe(true);
      expect(r2.reason).toBeUndefined();
    });
  });

  describe("i5：filter 缩窄到 dev server origin（不得改写本机其他服务）", () => {
    it("传 devServerUrl 时 filter 精确到该 origin 端口，不用 * 端口通配", () => {
      const session = makeSession();
      installDevCacheGuard({
        app: { isPackaged: false },
        session,
        log: { notify: vi.fn() },
        devServerUrl: "http://127.0.0.1:5231/",
      });
      const { filter } = captureListener(session);
      expect(filter.urls).toEqual(["http://127.0.0.1:5231/*"]);
      // 关键：不能留下 `:*` 通配，否则后端 18357 / prompt 21157 也被一并改写
      expect(filter.urls.some((u) => u.includes(":*"))).toBe(false);
    });

    it("不传 devServerUrl 时回落到回环通配集（向后兼容）", () => {
      const session = makeSession();
      installDevCacheGuard({ app: { isPackaged: false }, session, log: { notify: vi.fn() } });
      const { filter } = captureListener(session);
      expect(filter.urls).toEqual(DEV_URL_FILTERS);
    });

    it("devServerUrl 非回环时不缩窄（不把第三方 origin 当 dev server）", () => {
      const session = makeSession();
      installDevCacheGuard({
        app: { isPackaged: false },
        session,
        log: { notify: vi.fn() },
        devServerUrl: "https://evil.test/",
      });
      const { filter } = captureListener(session);
      expect(filter.urls).toEqual(DEV_URL_FILTERS);
    });
  });

  describe("i1：用窗口实际 session，且安装结果必须留痕（防静默 no-op）", () => {
    it("window.js 传的是 mainWindow.webContents.session，而不是硬编码 defaultSession", () => {
      const source = fs.readFileSync(path.join(__dirname, "..", "window.js"), "utf8");
      const at = source.search(/installDevCacheGuard\s*\(/);
      expect(at).toBeGreaterThan(-1);
      const callText = source.slice(at, source.indexOf("\n", source.indexOf(")", at) + 1));
      expect(callText).toContain("webContents.session");
      expect(callText).not.toContain("defaultSession");
    });

    it("调用点消费返回值并记日志（守卫生效与否必须可观测）", () => {
      const source = fs.readFileSync(path.join(__dirname, "..", "window.js"), "utf8");
      const at = source.search(/installDevCacheGuard\s*\(/);
      const around = source.slice(at, at + 500);
      expect(around).toMatch(/installed/);
      expect(around).toMatch(/log\.notify/);
    });
  });

  // -------------------------------------------------------------------------
  // 第二轮 CCG 深度审查（同一引擎重跑产生的更深观察，2026-10-15）
  //   leg① 与 loadURL 之间**没有串行**：install 同步返回、window.js 立即 loadURL，
  //   而 clearCache() 是异步的。若旧磁盘条目在 clear 完成前被查到且仍 fresh
  //   （immutable / ETag 未变），Chromium **不发网络请求** ⇒ leg② 的
  //   onHeadersReceived 根本不会触发 ⇒ 首屏仍命中旧副本，症状原样复现。
  //   第一轮把这条写成「已知边界」，第二轮指出它其实是**核心修复的时序漏洞**。
  // -------------------------------------------------------------------------
  describe("leg①/leg② 串行：清缓存必须可被 await，loadURL 不得抢跑", () => {
    it("返回 cacheCleared（thenable），并在 clearCache 落定后才 resolve", async () => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const session = makeSession({ clearCache: vi.fn(() => gate) });
      const result = installDevCacheGuard({ app: { isPackaged: false }, session, log: { notify: vi.fn() } });
      expect(result.installed).toBe(true);
      expect(result.cacheCleared).toBeDefined();
      expect(typeof result.cacheCleared.then).toBe("function");

      let settled = false;
      result.cacheCleared.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false); // clearCache 未落定 ⇒ 不得提前 resolve
      release();
      await result.cacheCleared;
      expect(settled).toBe(true);
    });

    it("clearCache 抛错/拒绝时 cacheCleared 也必须落定（fail-open，不悬挂）", async () => {
      const rejecting = makeSession({ clearCache: vi.fn(() => Promise.reject(new Error("boom"))) });
      const r1 = installDevCacheGuard({ app: { isPackaged: false }, session: rejecting, log: { notify: vi.fn() } });
      await expect(r1.cacheCleared).resolves.toBeUndefined();

      const throwing = makeSession({
        clearCache: vi.fn(() => {
          throw new Error("sync boom");
        }),
      });
      const r2 = installDevCacheGuard({ app: { isPackaged: false }, session: throwing, log: { notify: vi.fn() } });
      await expect(r2.cacheCleared).resolves.toBeUndefined();
    });

    it("window.js 的 loadURL 走在 cacheCleared 之后，且有超时兜底（不得永久白屏）", () => {
      const source = fs.readFileSync(path.join(__dirname, "..", "window.js"), "utf8");
      const at = source.search(/installDevCacheGuard\s*\(/);
      const around = source.slice(at, at + 1400);
      expect(around).toMatch(/cacheCleared/);
      expect(around).toMatch(/loadURL/);
      // 清缓存若悬挂，必须有兜底让它继续加载；否则用户看到的是永不出现的窗口
      expect(around).toMatch(/setTimeout|timeout|race/i);
    });
  });

  // -------------------------------------------------------------------------
  // 第三轮 CCG 深度审查（DUAL：proposer=opencode / critic=claude，基线 594 行）
  //   i2：DEV_URL_FILTERS 缺「仅回环」结构锁——原断言是与导出常量**自比较**，
  //       常量里混进 `https://*/*` 时全部测试仍绿，于是 no-store 会溢出到第三方响应
  //   i8：回环判据只认 127.0.0.1，忽略 127.0.0.0/8 其余地址（filter 路径由
  //       devServerUrl 精确覆盖，但 handler 内的 isDevServerUrl 判定会漏网）
  // -------------------------------------------------------------------------
  describe("i2：DEV_URL_FILTERS 必须逐条仅回环", () => {
    /** 允许的回环 host 形态（端口通配剥离后） */
    const ALLOWED_FILTER_HOST = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])$/;

    it("每一条 filter 的 host 都属于回环集合（混入第三方域名必须红）", () => {
      expect(Array.isArray(DEV_URL_FILTERS)).toBe(true);
      expect(DEV_URL_FILTERS.length).toBeGreaterThan(0);
      for (const f of DEV_URL_FILTERS) {
        const m = /^https?:\/\/([^/]+)\//.exec(f);
        expect(m, `filter 形态不合法: ${f}`).not.toBeNull();
        const host = m[1].replace(/:\*$/, "");
        expect(ALLOWED_FILTER_HOST.test(host), `非回环 host 混入 filter: ${f}`).toBe(true);
      }
    });

    it("structure lock 自身有效：第三方域名形态会被判非回环", () => {
      // 反向验证判据不是恒真（否则这条锁等于没跑）
      expect(ALLOWED_FILTER_HOST.test("evil.test")).toBe(false);
      expect(ALLOWED_FILTER_HOST.test("localhost.evil.test")).toBe(false);
      expect(ALLOWED_FILTER_HOST.test("*")).toBe(false);
      expect(ALLOWED_FILTER_HOST.test("127.0.0.1")).toBe(true);
    });
  });

  describe("i8：回环判据覆盖 127.0.0.0/8 全段", () => {
    it("127.x.y.z 都算回环（127.0.0.2 等不得漏网）", () => {
      expect(isDevServerUrl("http://127.0.0.2:5231/x.js")).toBe(true);
      expect(isDevServerUrl("http://127.0.1.5:5231/")).toBe(true);
      expect(isDevServerUrl("https://127.255.255.254:5231/@vite/client")).toBe(true);
    });

    it("相邻形态不得误判（前缀判据不能宽到吞掉伪装域名）", () => {
      expect(isDevServerUrl("http://1270.0.0.1/x.js")).toBe(false); // 少一个点
      expect(isDevServerUrl("https://127.0.0.1.evil.test/x.js")).toBe(false);
      expect(isDevServerUrl("https://127.evil.test/")).toBe(false);
      expect(isDevServerUrl("https://evil.test/127.0.0.1/x.js")).toBe(false);
    });
  });

  describe("接线锁：window.js 必须在 loadURL 之前安装守卫", () => {
    // i3/i5（CCG 深度审查）：原实现用 `indexOf('installDevCacheGuard({')` + 切片到首个
    // 『} else {』，判据依赖源码排版。这里改为「正则只认调用名（不绑 `{` 与空白）+
    // 括号计数取块」，并用 `loadURL\s*\(` 而非整条参数文本——参数一重构就不该误红。
    const CALL_RE = /installDevCacheGuard\s*\(/;
    const LOAD_RE = /loadURL\s*\(/;
    /** 从 startMarker 起用花括号计数取到配对闭合，返回块文本（含首尾）。 */
    function extractBraceBlock(source, startMarker) {
      const start = source.indexOf(startMarker);
      if (start < 0) return null;
      let depth = 0;
      let seen = false;
      for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (c === "{") {
          depth += 1;
          seen = true;
        } else if (c === "}") {
          depth -= 1;
          if (seen && depth === 0) return source.slice(start, i + 1);
        }
      }
      return null;
    }

    it("installDevCacheGuard 调用点早于 dev server 的 loadURL", () => {
      const source = fs.readFileSync(path.join(__dirname, "..", "window.js"), "utf8");
      // 判据必须是「调用点」而非「字符串首次出现」——`installDevCacheGuard` 在文件里
      // 出现两次（顶部 require + 调用点）。用 indexOf 取首次出现会命中 require 行，
      // 于是把守卫挪到 loadURL 之后也照样绿 = 锁根本没在跑（2026-10-15 实测）。
      // 故先剔除 require 行，只留真实调用点再比位置；正则容忍多行格式化。
      const withoutRequire = source
        .split("\n")
        .filter((line) => !line.includes("require("))
        .join("\n");
      const installAt = withoutRequire.search(CALL_RE);
      const loadAt = withoutRequire.search(LOAD_RE);
      expect(installAt).toBeGreaterThan(-1);
      expect(loadAt).toBeGreaterThan(-1);
      expect(installAt).toBeLessThan(loadAt);
    });

    it("守卫确实被装进 dev 分支而不是生产分支（不得装到 loadFile 旁）", () => {
      const source = fs.readFileSync(path.join(__dirname, "..", "window.js"), "utf8");
      // 用括号计数取出 `if (isDev) { … }` 整块——不再切片到首个 `} else {`，
      // 那会让「上方存在更早 else 块」时判据错位。
      const devBlock = extractBraceBlock(source, "if (isDev) {");
      expect(devBlock).not.toBeNull();
      expect(devBlock.search(CALL_RE)).toBeGreaterThan(-1);
      expect(devBlock.search(LOAD_RE)).toBeGreaterThan(-1);
      expect(devBlock.search(CALL_RE)).toBeLessThan(devBlock.search(LOAD_RE));
    });
  });
});
