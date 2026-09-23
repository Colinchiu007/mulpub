import { describe, it, expect, vi } from "vitest";

// Mock PlatformConfig
class MockPlatformConfig {
  constructor() {}
  getPlatform(p) {
    if (p === 'wechat_mp') return { type: 'article', publish_url: 'https://mp.weixin.qq.com' };
    if (p === 'unknown') return null;
    return { type: 'video', publish_url: 'https://example.com' };
  }
  listPlatforms() { return [{ id: 'wechat_mp', name: '???' }, { id: 'douyin', name: '??' }]; }
}

vi.mock("@multi-publish/shared-utils/src/platform-config", () => ({
  default: MockPlatformConfig,
}));

const { publishViaApiMock } = vi.hoisted(() => ({ publishViaApiMock: vi.fn() }));
vi.mock("./media-tool-paths", () => ({
  findFfprobe: vi.fn(() => "ffprobe"),
}));

const { PublisherRouter, ROUTE_TABLE } = require("../services/publisher-router");
// P0-3 回归：直接测 resolvePlatformArticle/buildPublishArticle 的平台特有字段透传（不经过 route）
const routerSrc = require("../services/publisher-router");

describe("主链路回归：B站队列路由到 ApiPublisher（Tier-A upos）", () => {
  const store = { getAccount: vi.fn(() => null), getDefaultAccount: vi.fn(() => null) }
  const accountManager = {
    loadSavedCredentials: vi.fn(() => ({
      platform: "bilibili",
      cookies: [{ name: "bili_jct", value: "abcdef0123456789abcdef01", domain: ".bilibili.com" }],
      localStorage: {},
    })),
  }
  it("ROUTE_TABLE.bilibili 使用 api 模式（非 rpa_vm）", () => {
    expect(ROUTE_TABLE.bilibili.mode).toBe("api")
  })
  it("createPublisher(bilibili) 创建 ApiPublisher", () => {
    const r = new PublisherRouter()
    const p = r.createPublisher("bilibili", { store, accountManager })
    expect(p.constructor.name).toBe("ApiPublisher")
  })
})

describe("ApiPublisher（baijiahao api 模式）", () => {
  const store = {
    getAccount: vi.fn(() => null),
    getDefaultAccount: vi.fn(() => null),
  }
  const accountManager = {
    loadSavedCredentials: vi.fn(() => ({
      platform: "baijiahao",
      cookies: [
        { name: "BAIDUID", value: "ABC", domain: ".baijiahao.baidu.com" },
        { name: "BDUSS", value: "XYZ", domain: ".baijiahao.baidu.com" },
      ],
      localStorage: {},
    })),
  }
  const baseArticle = {
    accountId: "d39af89b",
    title: "E2E 视频",
    content: "内容",
    video_path: "D:/01.mp4",
    tags: ["a"],
  }
  const baseTask = { id: "task-1", platform: "baijiahao", article: baseArticle }

  it("ROUTE_TABLE.baijiahao 使用 api 模式", () => {
    expect(ROUTE_TABLE.baijiahao.mode).toBe("api")
  })

  it("createPublisher(baijiahao) 创建 ApiPublisher", () => {
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", { store, accountManager })
    expect(p.constructor.name).toBe("ApiPublisher")
  })

  it("publish 成功：ffprobe 探测 → publishViaApi → 返回 postId", async () => {
    publishViaApiMock.mockResolvedValue({ success: true, publishId: "ARTICLE_9", url: "https://baijiahao.baidu.com/pcui/article/ARTICLE_9" })
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => ({ width: 1920, height: 1080, duration: 122 }),
      publishViaApi: publishViaApiMock,
    })
    const result = await p.publish(baseTask)
    expect(result.success).toBe(true)
    expect(result.postId).toBe("ARTICLE_9")
    expect(publishViaApiMock).toHaveBeenCalledWith(
      "baijiahao",
      expect.objectContaining({
        title: "E2E 视频",
        draft: false,
        video: expect.objectContaining({ path: "D:/01.mp4", width: 1920, height: 1080 }),
      }),
      expect.stringContaining("BAIDUID=ABC"),
      expect.objectContaining({ timeout: 300000, draft: false }),
    )
  })

  it("draft 任务透传 draft 标志到 taskData 与 publishViaApi opts", async () => {
    publishViaApiMock.mockResolvedValue({ success: true, publishId: "DRAFT_9", url: "" })
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => ({ width: 1920, height: 1080, duration: 1 }),
      publishViaApi: publishViaApiMock,
    })
    await p.publish({ ...baseTask, article: { ...baseArticle, draft: true } })
    expect(publishViaApiMock).toHaveBeenCalledWith(
      "baijiahao",
      expect.objectContaining({ draft: true }),
      expect.stringContaining("BAIDUID=ABC"),
      expect.objectContaining({ draft: true }),
    )
  })

  it("父域 .baidu.com cookie（BDUSS）通过平台域过滤", async () => {
    accountManager.loadSavedCredentials.mockReturnValueOnce({
      platform: "baijiahao",
      cookies: [
        { name: "BDUSS", value: "XYZ", domain: ".baidu.com" },
        { name: "BAIDUID", value: "ABC", domain: ".baidu.com" },
      ],
      localStorage: {},
    })
    publishViaApiMock.mockResolvedValue({ success: true, publishId: "A1", url: "" })
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => ({ width: 1920, height: 1080, duration: 1 }),
      publishViaApi: publishViaApiMock,
    })
    await p.publish(baseTask)
    expect(publishViaApiMock).toHaveBeenCalledWith(
      "baijiahao",
      expect.anything(),
      expect.stringContaining("BDUSS=XYZ"),
      expect.anything(),
    )
  })

  it("竖版视频拒绝 API 发布", async () => {
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => ({ width: 720, height: 1280, duration: 1 }),
    })
    await expect(p.publish(baseTask)).rejects.toThrow(/竖版/)
  })

  // P0-3：平台特有字段透传回归测试（bilibili tid/copyright、youtube categoryId/privacy、
  // tiktok privacyLevel、baijiahao original/location）——验证 resolvePlatformArticle →
  // buildPublishArticle → taskData 三层链路不断链
  it("bilibili platformOverrides 的 category/copyright 透传（buildPublishArticle 层）", () => {
    const article = routerSrc.buildPublishArticle({ article: { ...baseArticle, platformOverrides: { bilibili: { category: 21, copyright: 1 } } } }, "bilibili")
    expect(article.category).toBe(21)
    expect(article.copyright).toBe(1)
  })

  it("youtube categoryId/privacy、tiktok privacyLevel、baijiahao original/location 透传（buildPublishArticle 层）", () => {
    const yt = routerSrc.buildPublishArticle({ article: { ...baseArticle, platformOverrides: { youtube: { categoryId: "10", privacy: "unlisted" } } } }, "youtube")
    expect(yt.categoryId).toBe("10")
    expect(yt.privacy).toBe("unlisted")

    const tt = routerSrc.buildPublishArticle({ article: { ...baseArticle, platformOverrides: { tiktok: { privacyLevel: "FRIENDS" } } } }, "tiktok")
    expect(tt.privacyLevel).toBe("FRIENDS")

    const loc = { uid: "poi-1", name: "北京·三里屯", city_name: "北京" }
    const bjh = routerSrc.buildPublishArticle({ article: { ...baseArticle, original: true, location: loc } }, "baijiahao")
    expect(bjh.original).toBe(true)
    expect(bjh.location).toEqual(loc)
  })

  it("非法平台特有字段被过滤（category 非正整数/privacy 非法枚举不透传）", () => {
    const a1 = routerSrc.buildPublishArticle({ article: { ...baseArticle, platformOverrides: { bilibili: { category: -1, copyright: 9 } } } }, "bilibili")
    expect(a1.category).toBeUndefined()
    expect(a1.copyright).toBeUndefined()

    const a2 = routerSrc.buildPublishArticle({ article: { ...baseArticle, platformOverrides: { youtube: { categoryId: "abc", privacy: "hack" } } } }, "youtube")
    expect(a2.categoryId).toBeUndefined()
    expect(a2.privacy).toBeUndefined()
  })

  it("baijiahao locationName 手输位置转换为 location 对象", () => {
    const a = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { baijiahao: { locationName: "北京·三里屯" } } } },
      "baijiahao",
    )
    expect(a.location).toEqual({ uid: "manual-北京·三里屯", name: "北京·三里屯" })

    // 完整 location 对象优先于 locationName
    const b = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { baijiahao: { locationName: "手输", location: { uid: "poi-9", name: "POI" } } } } },
      "baijiahao",
    )
    expect(b.location).toEqual({ uid: "poi-9", name: "POI" })
  })

  it("P2-1 合集/播放列表透传：B站 collectionId、YouTube playlistId、百家号 collection", () => {
    const bili = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { bilibili: { collectionId: 12345 } } } },
      "bilibili",
    )
    expect(bili.collectionId).toBe(12345)

    const yt = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { youtube: { playlistId: "PLabc123xyz_-" } } } },
      "youtube",
    )
    expect(yt.playlistId).toBe("PLabc123xyz_-")

    const col = { id: "topic-77", name: "我的合集" }
    const bjh = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { baijiahao: { collection: col } } } },
      "baijiahao",
    )
    expect(bjh.collection).toEqual(col)

    // 非法值过滤：负数 collectionId、含特殊字符 playlistId 不透传
    const bad = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { bilibili: { collectionId: -1 }, youtube: { playlistId: "bad id!" } } } },
      "bilibili",
    )
    expect(bad.collectionId).toBeUndefined()
  })

  it("P1-4/P1-5/P3-3：公众号 digest/openComment 与全平台 author 透传", () => {
    // 公众号摘要 + 评论开关
    const wx = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { wechat_mp: { digest: "这是摘要" } }, openComment: false, author: "张三" } },
      "wechat_mp",
    )
    expect(wx.digest).toBe("这是摘要")
    expect(wx.openComment).toBe(false)
    expect(wx.author).toBe("张三")

    // author 全平台透传（非公众号也有）
    const dy = routerSrc.buildPublishArticle({ article: { ...baseArticle, author: "李四" } }, "douyin")
    expect(dy.author).toBe("李四")

    // openComment 默认 true（未显式 false）
    const wx2 = routerSrc.buildPublishArticle({ article: { ...baseArticle } }, "wechat_mp")
    expect(wx2.openComment).toBe(true)

    // digest 超长截断 120
    const wx3 = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, platformOverrides: { wechat_mp: { digest: "x".repeat(200) } } } },
      "wechat_mp",
    )
    expect(wx3.digest.length).toBe(120)
  })

  it("P3-1/P3-2/P3-4：商品/任务/投票/交叉发布透传与过滤", () => {
    const goods = [{ id: "g1", title: "商品1" }, { id: "g2", title: "商品2" }]
    const a = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, goods, taskId: "act-123" } },
      "douyin",
    )
    expect(a.goods).toEqual(goods)
    expect(a.taskId).toBe("act-123")
    expect(a.poll).toBeUndefined()
    expect(a.crossPost).toBeUndefined()

    // 过滤：空 goods / 非法 taskId / 选项不足的 poll / 非数组 goods 不透传
    const b = routerSrc.buildPublishArticle(
      { article: { ...baseArticle, goods: [], taskId: "bad id!" } },
      "douyin",
    )
    expect(b.goods).toBeUndefined()
    expect(b.taskId).toBeUndefined()
    expect(b.poll).toBeUndefined()
  })

  it("缺少 cookie 时抛错", async () => {
    accountManager.loadSavedCredentials.mockReturnValueOnce(null)
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => ({ width: 1, height: 1, duration: 1 }),
      publishViaApi: publishViaApiMock,
    })
    await expect(p.publish(baseTask)).rejects.toThrow(/Cookie/)
  })

  it("adapter 返回失败时抛错", async () => {
    publishViaApiMock.mockResolvedValue({ success: false, error: "compuploadVideo 失败" })
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => ({ width: 1, height: 1, duration: 1 }),
      publishViaApi: publishViaApiMock,
    })
    await expect(p.publish(baseTask)).rejects.toThrow(/compuploadVideo/)
  })

  it("视频探测失败时抛错", async () => {
    const r = new PublisherRouter()
    const p = r.createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => null,
    })
    await expect(p.publish(baseTask)).rejects.toThrow(/视频/)
  })
})

describe("PublisherRouter", () => {
  describe("ROUTE_TABLE", () => {
    it("defines all platforms with rpa_vm mode", () => {
      expect(Object.keys(ROUTE_TABLE).length).toBeGreaterThanOrEqual(14);
    });
    it("wechat_mp has timeout 120000", () => {
      expect(ROUTE_TABLE.wechat_mp.timeout).toBe(120000);
    });
    it("douyin has timeout 300000", () => {
      expect(ROUTE_TABLE.douyin.timeout).toBe(300000);
    });
  });

  describe("constructor", () => {
    it("creates instance", () => {
      const r = new PublisherRouter();
      expect(r).toBeDefined();
    });
    it("stores routeTable", () => {
      const r = new PublisherRouter();
      expect(r._routeTable).toBe(ROUTE_TABLE);
    });
  });

  describe("getRoute()", () => {
    it("returns route for known platform", () => {
      const r = new PublisherRouter();
      const route = r.getRoute("wechat_mp");
      expect(route).toBeDefined();
      expect(route.platform).toBe("wechat_mp");
      expect(route.mode).toBe("rpa_vm");
      expect(route.timeout).toBe(120000);
    });
    it("throws for unconfigured platform", () => {
      const r = new PublisherRouter();
      expect(() => r.getRoute("unknown")).toThrow("平台未配置: ");
    });
    it("throws for platform not in route table", () => {
      const r = new PublisherRouter();
      // PlatformConfig returns config but no route = different error
      // unknown returns null from mock, so we get '?????'
      expect(() => r.getRoute("unknown")).toThrow();
    });
  });

  describe("getPlatformConfig()", () => {
    it("returns config from PlatformConfig", () => {
      const r = new PublisherRouter();
      const cfg = r.getPlatformConfig("wechat_mp");
      expect(cfg.type).toBe("article");
    });
  });

  describe("listPlatforms()", () => {
    it("returns platform list", () => {
      const r = new PublisherRouter();
      const list = r.listPlatforms();
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe("getRouteTable()", () => {
    it("returns copy of route table", () => {
      const r = new PublisherRouter();
      const table = r.getRouteTable();
      expect(table.wechat_mp).toBeDefined();
      expect(table).not.toBe(ROUTE_TABLE); // different reference
    });
  });

  describe("createPublisher()", () => {
    it("creates RpaVmPublisher for rpa_vm mode", () => {
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager: { publish: vi.fn() },
        store: { getAccount: vi.fn(), getDefaultAccount: vi.fn() },
      });
      expect(publisher).toBeDefined();
      expect(typeof publisher.publish).toBe("function");
    });

    it("取消信号会请求 RPA 管理器销毁对应账号窗口", async () => {
      let resolvePublish
      const rpaViewManager = {
        publish: vi.fn(() => new Promise(resolve => { resolvePublish = resolve })),
        cancel: vi.fn(() => true),
      }
      const r = new PublisherRouter()
      const publisher = r.createPublisher("wechat_mp", { rpaViewManager, store: { getAccount: vi.fn() } })
      const controller = new AbortController()
      const pending = publisher.publish({ id: "task-1", platform: "wechat_mp", article: { accountId: "acc-1" } }, { signal: controller.signal })

      controller.abort()
      expect(rpaViewManager.cancel).toHaveBeenCalledWith("wechat_mp", "acc-1")
      resolvePublish({ success: false, error: "已取消" })
      await expect(pending).rejects.toThrow("已取消")
    });
    it("RPA 成功返回与取消竞争时仍以取消结果为准", async () => {
      const controller = new AbortController()
      const rpaViewManager = {
        publish: vi.fn(async () => {
          controller.abort()
          return { success: true, url: "https://example.com/post/1" }
        }),
        cancel: vi.fn(() => true),
      }
      const r = new PublisherRouter()
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn() },
      })

      await expect(publisher.publish({
        id: "task-race",
        article: { accountId: "acc-race" },
      }, { signal: controller.signal })).rejects.toThrow("任务已取消")
      expect(rpaViewManager.cancel).toHaveBeenCalledWith("wechat_mp", "acc-race")
    });
    it("发布诊断只向上游透传脱敏网络摘要", async () => {
      const rpaViewManager = {
        publish: vi.fn(async () => ({
          success: true,
          url: "https://example.test/post/1?access_token=secret-token&postId=post-123",
          diagnostics: {
            text: "用户发布正文和 cookie=secret-cookie",
            requests: [{
              url: "https://example.test/api/publish?access_token=secret-token",
              status: 201,
              mimeType: "application/json",
              body: '{"token":"secret-token","content":"用户发布正文"}',
            }],
            artifact: { postId: "post-123", title: "用户发布正文" },
          },
        })),
      };
      const publisher = new PublisherRouter().createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });

      const result = await publisher.publish({ id: "task-diagnostics", article: {} });
      const serialized = JSON.stringify(result.diagnostics);

      expect(result.diagnostics).toEqual({
        responseCount: 1,
        responses: [{ endpoint: "https://example.test/api/publish", status: 201, mimeType: "application/json" }],
        artifactFound: true,
      });
      expect(result.url).toBe("https://example.test/post/1?postId=post-123");
      expect(serialized).not.toContain("secret-token");
      expect(serialized).not.toContain("secret-cookie");
      expect(serialized).not.toContain("用户发布正文");
      expect(serialized).not.toContain("access_token");
    });
    it("向 RPA 传递账号 localStorage 并吞掉取消清理异常", async () => {
      const account = {
        cookies: [{ name: "session", value: "secret", domain: ".mp.weixin.qq.com" }, { name: "third-party", value: "drop", domain: ".evil.example" }],
        localStorage: { token: "private" },
      }
      let resolvePublish
      const rpaViewManager = {
        publish: vi.fn(() => new Promise(resolve => { resolvePublish = resolve })),
        cancel: vi.fn(() => Promise.reject(new Error("窗口已销毁"))),
      }
      const r = new PublisherRouter()
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => account) },
      })
      const controller = new AbortController()
      const pending = publisher.publish({ id: "task-2", article: { accountId: "acc-2" } }, { signal: controller.signal })

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.any(Object),
        { cookies: [account.cookies[0]], localStorage: account.localStorage },
        120000,
      )
      controller.abort()
      await Promise.resolve()
      resolvePublish({ success: false, error: "已取消" })

      await expect(pending).rejects.toThrow("已取消")
    });
    it("向 RPA 传递仅由 IndexedDB 保存的账号登录态", async () => {
      const indexedDB = { auth: { tokens: [{ __multi_publish_indexeddb_key__: 7, value: { token: 'private' } }] } }
      const rpaViewManager = { publish: vi.fn(async () => ({ success: true, url: 'https://example.test/post' })) }
      const r = new PublisherRouter()
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => ({ cookies: [], localStorage: {}, indexedDB })) },
      })

      await publisher.publish({ id: 'task-indexed-db', article: { accountId: 'acc-indexed-db' } })

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        'wechat_mp',
        expect.any(Object),
        { cookies: [], localStorage: {}, indexedDB },
        120000,
      )
    })
    it("刚保存的账号可从主进程账号管理器恢复凭证并立即发布", async () => {
      const credentials = {
        cookies: [{ name: "session", value: "captured", domain: ".mp.weixin.qq.com" }, { name: "third-party", value: "drop", domain: ".qq.com" }],
        localStorage: { token: "captured-token" },
      };
      const accountManager = {
        loadSavedCredentials: vi.fn(() => credentials),
      };
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true, url: "https://example.com/post/new-account" })),
      };
      const store = {
        getAccount: vi.fn(() => null),
        getDefaultAccount: vi.fn(() => null),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store,
        accountManager,
      });

      await publisher.publish({
        id: "task-new-account",
        article: {
          accountId: "account-new",
          title: "标题",
          content: "正文",
        },
      });

      expect(accountManager.loadSavedCredentials).toHaveBeenCalledWith("account-new", "wechat_mp");
      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.objectContaining({ title: "标题", content: "正文" }),
        { cookies: [credentials.cookies[0]], localStorage: credentials.localStorage },
        120000,
      );
    });
    it("账号加密凭证中的代理随 RPA 发布传递，不经渲染层", async () => {
      const credentials = {
        cookies: [{ name: "session", value: "captured", domain: ".mp.weixin.qq.com" }],
        localStorage: { token: "captured-token" },
        proxy: { host: "127.0.0.1", port: 8080, type: "http" },
      };
      const rpaViewManager = { publish: vi.fn(async () => ({ success: true })) };
      const publisher = new PublisherRouter().createPublisher("wechat_mp", {
        rpaViewManager,
        accountManager: { loadSavedCredentials: vi.fn(() => credentials) },
        store: { getAccount: vi.fn(() => null) },
      });

      await publisher.publish({ id: "task-proxy", article: { accountId: "account-proxy" } });

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.any(Object),
        expect.objectContaining({ proxy: credentials.proxy }),
        120000,
      );
    });
    it("将富文本语义和平台发布选项完整传递给发布器", async () => {
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true, url: "https://example.com/post/semantic" })),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("zhihu", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });

      await publisher.publish({
        id: "task-semantic",
        article: {
          accountId: "account-semantic",
          title: "语义标题",
          content: '<p>正文 <topic>人工智能</topic> <friend>小李</friend><img src="https://example.com/a.jpg"></p>',
          tags: ["已有标签"],
          platformOverrides: {
            zhihu: { topics: ["专属话题"], draft: true, declare: 5 },
          },
        },
      });

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "zhihu",
        expect.objectContaining({
          content: expect.stringContaining("#人工智能#"),
          tags: expect.arrayContaining(["已有标签", "人工智能", "专属话题"]),
          draft: true,
          declare: 5,
          mentions: [expect.objectContaining({ name: "小李" })],
          images: ["https://example.com/a.jpg"],
        }),
        expect.any(Object),
        120000,
      );
    });
    it("默认账号优先使用主进程中的最新凭证，避免 SQLite 旧状态覆盖", async () => {
      const freshCredentials = {
        cookies: [{ name: "session", value: "fresh", domain: ".mp.weixin.qq.com" }],
        localStorage: { token: "fresh-token" },
      };
      const staleAccount = {
        id: "account-default",
        cookies: [{ name: "session", value: "stale", domain: ".mp.weixin.qq.com" }],
        localStorage: { token: "stale-token" },
      };
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true })),
      };
      const accountManager = {
        loadSavedCredentials: vi.fn(() => freshCredentials),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        accountManager,
        store: { getDefaultAccount: vi.fn(() => staleAccount) },
      });

      await publisher.publish({
        id: "task-default-account",
        article: { title: "标题", content: "正文" },
      });

      expect(accountManager.loadSavedCredentials).toHaveBeenCalledWith("account-default", "wechat_mp");
      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.any(Object),
        freshCredentials,
        120000,
      );
    });
    it("兼容 SQLite 旧账号记录中的 local_storage 字段", async () => {
      const account = {
        id: "account-legacy",
        cookies: [{ name: "session", value: "legacy", domain: ".mp.weixin.qq.com" }, { name: "other", value: "drop", domain: ".baidu.com" }],
        local_storage: { token: "legacy-token" },
      };
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true })),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => account) },
      });

      await publisher.publish({
        id: "task-legacy-account",
        article: { accountId: "account-legacy", title: "标题", content: "正文" },
      });

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.any(Object),
        {
          cookies: [account.cookies[0]],
          localStorage: account.local_storage,
        },
        120000,
      );
    });
    it("平台不匹配的 SQLite 账号不会透传凭证", async () => {
      const rpaViewManager = { publish: vi.fn(async () => ({ success: true })) };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => ({ platform: "douyin", cookies: [{ name: "x", domain: ".douyin.com" }], localStorage: { token: "x" } })) },
      });
      await publisher.publish({ article: { accountId: "mismatch" } });
      expect(rpaViewManager.publish).toHaveBeenCalledWith("wechat_mp", expect.any(Object), { cookies: [], localStorage: {} }, 120000);
    });
    it("视频文章的 RPA 超时放宽到 30 分钟（实测 96MB 上传超 10 分钟）", async () => {
      const rpaViewManager = { publish: vi.fn(async () => ({ success: true, postId: "ks-9", url: "https://m.gifshow.com/fw/photo/ks-9" })) };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("kuaishou", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });
      await publisher.publish({ article: { title: "标题", content: "正文", video_path: "C:/tmp/a.mp4" } });
      expect(rpaViewManager.publish.mock.calls[0][3]).toBeGreaterThanOrEqual(1800000);
    });
    it("图文文章仍用平台默认 RPA 超时 300s", async () => {
      const rpaViewManager = { publish: vi.fn(async () => ({ success: true, postId: "ks-9", url: "https://m.gifshow.com/fw/photo/ks-9" })) };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("kuaishou", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });
      await publisher.publish({ article: { title: "标题", content: "正文" } });
      expect(rpaViewManager.publish.mock.calls[0][3]).toBe(300000);
    });
    it("默认账号 SQLite 回退过滤第三方 Cookie", async () => {
      const rpaViewManager = { publish: vi.fn(async () => ({ success: true })) };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getDefaultAccount: vi.fn(() => ({ id: "default", cookies: [{ name: "ok", domain: ".mp.weixin.qq.com" }, { name: "bad", domain: ".evil.example" }] })) },
      });
      await publisher.publish({ article: {} });
      expect(rpaViewManager.publish.mock.calls[0][2]).toEqual({ cookies: [{ name: "ok", domain: ".mp.weixin.qq.com" }], localStorage: {} });
    });
    it("RPA 发布使用当前平台的差异化标题和正文", async () => {
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true, url: "https://example.com/post/override" })),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });

      await publisher.publish({
        id: "task-override",
        article: {
          accountId: "acc-override",
          title: "通用标题",
          content: "通用正文",
          platformOverrides: {
            wechat_mp: { title: "公众号标题", content: "公众号正文" },
            zhihu: { title: "知乎标题", content: "知乎正文" },
          },
        },
      });

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.objectContaining({ title: "公众号标题", content: "公众号正文" }),
        expect.any(Object),
        120000,
      );
    });
    it("平台差异内容缺字段时逐字段回退到通用内容", async () => {
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true })),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("wechat_mp", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });

      await publisher.publish({
        id: "task-partial-override",
        article: {
          accountId: "acc-override",
          title: "通用标题",
          content: "通用正文",
          platformOverrides: { wechat_mp: { title: "公众号标题" } },
        },
      });

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "wechat_mp",
        expect.objectContaining({ title: "公众号标题", content: "通用正文" }),
        expect.any(Object),
        120000,
      );
    });
    it("知乎发布向 RPA 透传评论权限和创作声明", async () => {
      const rpaViewManager = {
        publish: vi.fn(async () => ({ success: true })),
      };
      const r = new PublisherRouter();
      const publisher = r.createPublisher("zhihu", {
        rpaViewManager,
        store: { getAccount: vi.fn(() => null) },
      });

      await publisher.publish({
        id: "task-zhihu-options",
        article: {
          accountId: "zhihu-account",
          title: "通用标题",
          content: "通用正文",
          platformOverrides: {
            zhihu: {
              title: "知乎标题",
              content: "知乎正文",
              commentPermission: "anyone",
              declare: 5,
            },
          },
        },
      });

      expect(rpaViewManager.publish).toHaveBeenCalledWith(
        "zhihu",
        expect.objectContaining({
          title: "知乎标题",
          content: "知乎正文",
          commentPermission: "anyone",
          declare: 5,
        }),
        expect.any(Object),
        120000,
      );
    });
    it("backend 发布也使用当前平台的差异化内容", async () => {
      const originalMode = ROUTE_TABLE.wechat_mp.mode;
      ROUTE_TABLE.wechat_mp.mode = "backend";
      try {
        const pythonBridge = {
          requestBackend: vi.fn(async () => ({ code: 0, data: { success: true } })),
        };
        const r = new PublisherRouter();
        const publisher = r.createPublisher("wechat_mp", { pythonBridge });

        await publisher.publish({
          id: "task-backend-override",
          article: {
            title: "通用标题",
            content: "通用正文",
            platformOverrides: { wechat_mp: { title: "公众号标题", content: "公众号正文" } },
          },
        });

        expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
          "POST",
          "/api/publish",
          expect.objectContaining({ title: "公众号标题", content: "公众号正文" }),
        );
      } finally {
        ROUTE_TABLE.wechat_mp.mode = originalMode;
      }
    });
    it("backend 发布保留知乎权限字段", async () => {
      const originalMode = ROUTE_TABLE.zhihu.mode;
      ROUTE_TABLE.zhihu.mode = "backend";
      try {
        const pythonBridge = {
          requestBackend: vi.fn(async () => ({ code: 0, data: { success: true } })),
        };
        const r = new PublisherRouter();
        const publisher = r.createPublisher("zhihu", { pythonBridge });

        await publisher.publish({
          id: "task-backend-zhihu-options",
          article: {
            title: "标题",
            content: "正文",
            platformOverrides: {
              zhihu: { commentPermission: "anyone", declare: 5 },
            },
          },
        });

        expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
          "POST",
          "/api/publish",
          expect.objectContaining({ commentPermission: "anyone", declare: 5 }),
        );
      } finally {
        ROUTE_TABLE.zhihu.mode = originalMode;
      }
    });
    it("backend 发布也传递富文本语义和可执行的知乎选项", async () => {
      const originalMode = ROUTE_TABLE.zhihu.mode;
      ROUTE_TABLE.zhihu.mode = "backend";
      try {
        const pythonBridge = {
          requestBackend: vi.fn(async () => ({ code: 0, data: { success: true } })),
        };
        const r = new PublisherRouter();
        const publisher = r.createPublisher("zhihu", { pythonBridge });

        await publisher.publish({
          id: "task-backend-semantic",
          article: {
            title: "标题",
            content: '<p>正文 <topic>人工智能</topic> <friend>小李</friend><img src="https://example.com/a.jpg"></p>',
            tags: ["已有标签"],
            platformOverrides: {
              zhihu: { topics: ["专属话题"], draft: true, declare: 5 },
            },
          },
        });

        expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
          "POST",
          "/api/publish",
          expect.objectContaining({
            content: expect.stringContaining("#人工智能#"),
            tags: expect.arrayContaining(["已有标签", "人工智能", "专属话题"]),
            draft: true,
            mentions: [expect.objectContaining({ name: "小李" })],
            images: ["https://example.com/a.jpg"],
          }),
        );
      } finally {
        ROUTE_TABLE.zhihu.mode = originalMode;
      }
    });
    it("throws for unknown mode platform", () => {
      const r = new PublisherRouter();
      // PlatformConfig returns config, but no route entry = error
      // use a platform that has config but no route
      expect(() => r.createPublisher("unknown", {})).toThrow();
    });

    it("按任务 owner 查询账号，不能借用当前用户的默认账号", async () => {
      const r = new PublisherRouter();
      const getAccount = vi.fn(() => ({ cookies: [{ name: 'sid', value: 'a' }] }));
      const getDefaultAccount = vi.fn(() => ({ cookies: [{ name: 'sid', value: 'default' }] }));
      const publish = vi.fn(async () => ({ success: true, url: 'https://example.test/post' }));
      const publisher = r.createPublisher("douyin", {
        rpaViewManager: { publish },
        store: { getAccount, getDefaultAccount },
      });

      await publisher.publish({
        id: 'task-a',
        platform: 'douyin',
        owner_subject: 'user-a',
        accountId: 'account-a',
        article: { title: 'A' },
      });

      expect(getAccount).toHaveBeenCalledWith('account-a', 'user-a');
      expect(getDefaultAccount).not.toHaveBeenCalled();
    });

    it("按任务 owner 查询默认账号和加密凭据", async () => {
      const r = new PublisherRouter();
      const getDefaultAccount = vi.fn(() => ({ id: 'default-a', cookies: [] }));
      const loadSavedCredentials = vi.fn(() => ({ cookies: [{ name: 'sid', value: 'a' }], localStorage: {} }));
      const publish = vi.fn(async () => ({ success: true, url: 'https://example.test/post' }));
      const publisher = r.createPublisher("douyin", {
        rpaViewManager: { publish },
        store: { getDefaultAccount },
        accountManager: { loadSavedCredentials },
      });

      await publisher.publish({
        id: 'task-default-a',
        platform: 'douyin',
        owner_subject: 'user-a',
        article: { title: 'A' },
      });

      expect(getDefaultAccount).toHaveBeenCalledWith('douyin', 'user-a');
      expect(loadSavedCredentials).toHaveBeenCalledWith('default-a', 'douyin', { ownerSubject: 'user-a' });
    });
  });
});

describe("ApiPublisher 图文模式（§4.4 百家号 article-only 的桌面接线）", () => {
  const store = { getAccount: vi.fn(() => null), getDefaultAccount: vi.fn(() => null) }
  const accountManager = {
    loadSavedCredentials: vi.fn(() => ({
      platform: "baijiahao",
      cookies: [{ name: "BAIDUID", value: "ABC", domain: ".baijiahao.baidu.com" }],
      localStorage: {},
    })),
  }
  const mk = () => new PublisherRouter().createPublisher("baijiahao", {
    store, accountManager, publishViaApi: publishViaApiMock,
  })
  it("无 video_path 走图文：不调 probeVideo、taskData 无 video 字段、返回 mode:api", async () => {
    let probed = false
    const p = new PublisherRouter().createPublisher("baijiahao", {
      store, accountManager,
      probeVideo: async () => { probed = true; return { width: 1, height: 1, duration: 1 } },
      publishViaApi: publishViaApiMock,
    })
    publishViaApiMock.mockResolvedValue({ success: true, publishId: "ART_1", url: "https://baijiahao.baidu.com/pcui/article/ART_1" })
    const result = await p.publish({ id: "t-art", platform: "baijiahao", article: { accountId: "a1", title: "图文标题", content: "正文", tags: ["x"] } })
    expect(probed).toBe(false)
    expect(result.mode).toBe("api")
    expect(result.postId).toBe("ART_1")
    const sent = publishViaApiMock.mock.calls.at(-1)[1]
    expect(sent.title).toBe("图文标题")
    expect(sent.video).toBeUndefined()
  })
  it("图文透传 images（来自正文）与 author", async () => {
    publishViaApiMock.mockResolvedValue({ success: true, publishId: "ART_2", url: "" })
    const p = mk()
    await p.publish({ id: "t-art2", platform: "baijiahao", article: { accountId: "a1", title: "T", content: '<img src="https://e.com/a.jpg">', author: "张三" } })
    const sent = publishViaApiMock.mock.calls.at(-1)[1]
    expect(sent.images).toEqual(["https://e.com/a.jpg"])
    expect(sent.author).toBe("张三")
    expect(sent.video).toBeUndefined()
  })
  it("图文 draft 透传（私密草稿优先）到 taskData 与 opts", async () => {
    publishViaApiMock.mockResolvedValue({ success: true, publishId: "D1", url: "" })
    const p = mk()
    await p.publish({ id: "t-draft", platform: "baijiahao", article: { accountId: "a1", title: "T", content: "C", draft: true } })
    expect(publishViaApiMock).toHaveBeenCalledWith("baijiahao", expect.objectContaining({ draft: true }), expect.any(String), expect.objectContaining({ draft: true }))
  })
})

describe("RpaVmPublisher 发布方式标记", () => {
  it("RPA 成功返回 mode:dom（发布方式徽标三态数据源）", async () => {
    const rpaViewManager = { publish: vi.fn(async () => ({ success: true, url: "https://example.com/post/1" })) }
    const publisher = new PublisherRouter().createPublisher("wechat_mp", { rpaViewManager, store: { getAccount: vi.fn(() => null) } })
    const result = await publisher.publish({ id: "t-rpa", platform: "wechat_mp", article: { title: "T", content: "C" } })
    expect(result.mode).toBe("dom")
  })
})
