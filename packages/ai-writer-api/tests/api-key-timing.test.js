/**
 * P2 安全小项回归：X-API-Key 必须走恒定时间比较
 *
 * 单元层锁语义（等值/前缀/等长不同/空值/非字符串），
 * 集成层锁行为（这些输入在生产中间件里一律 401，且合法 key 正常 200）。
 */
var request = require("supertest")
var fs = require("fs")
var path = require("path")
var AiWriter = require("@multi-publish/ai-writer")
var { timingSafeKeyEqual } = require("../src/auth")

var API_KEY = "sk-live-0123456789abcdef"
var app

beforeAll(function () {
  process.env.AI_WRITER_API_KEY = API_KEY
  vi.spyOn(AiWriter.prototype, "generateTitles").mockResolvedValue(["T1"])
  vi.spyOn(AiWriter.prototype, "isConfigured").mockReturnValue(true)
  var mod = require("../src/server")
  app = mod.createApp ? mod.createApp({ apiKey: API_KEY }) : mod
})

afterAll(function () {
  vi.restoreAllMocks()
})

describe("timingSafeKeyEqual", function () {
  test("相等密钥通过", function () {
    expect(timingSafeKeyEqual(API_KEY, API_KEY)).toBe(true)
  })

  test("前缀（更短）不通过 —— 旧写法在此短路，正是时序侧信道所在", function () {
    expect(timingSafeKeyEqual(API_KEY.slice(0, 8), API_KEY)).toBe(false)
  })

  test("等长但内容不同不通过", function () {
    expect(timingSafeKeyEqual("sk-live-0123456789abcdeg", API_KEY)).toBe(false)
  })

  test("空值 fail-closed：两侧都空也不等价于「已认证」", function () {
    expect(timingSafeKeyEqual("", "")).toBe(false)
    expect(timingSafeKeyEqual("", API_KEY)).toBe(false)
    expect(timingSafeKeyEqual(undefined, API_KEY)).toBe(false)
    expect(timingSafeKeyEqual(null, null)).toBe(false)
  })

  test("非字符串（重复头会给数组）不通过，也不抛 RangeError", function () {
    expect(timingSafeKeyEqual([API_KEY, API_KEY], API_KEY)).toBe(false)
    expect(timingSafeKeyEqual(Buffer.from(API_KEY), API_KEY)).toBe(false)
  })

  test("非 ASCII 密钥按 UTF-8 字节比较", function () {
    expect(timingSafeKeyEqual("密钥-α", "密钥-α")).toBe(true)
    expect(timingSafeKeyEqual("密钥-α", "密钥-β")).toBe(false)
  })
})

describe("auth 中间件", function () {
  test("合法 key → 200", async function () {
    var res = await request(app)
      .post("/api/ai/titles")
      .send({ topic: "t" })
      .set("X-API-Key", API_KEY)
    expect(res.status).toBe(200)
  })

  test("正确前缀 → 401（不得因前缀匹配而变快/变通）", async function () {
    var res = await request(app)
      .post("/api/ai/titles")
      .send({ topic: "t" })
      .set("X-API-Key", API_KEY.slice(0, 20))
    expect(res.status).toBe(401)
  })

  test("等长错误 key → 401", async function () {
    var res = await request(app)
      .post("/api/ai/titles")
      .send({ topic: "t" })
      .set("X-API-Key", "x".repeat(API_KEY.length))
    expect(res.status).toBe(401)
  })

  test("空 X-API-Key 头 → 401", async function () {
    var res = await request(app)
      .post("/api/ai/titles")
      .send({ topic: "t" })
      .set("X-API-Key", "")
    expect(res.status).toBe(401)
  })

  test("health 仍免鉴权（既有契约不变）", async function () {
    var res = await request(app).get("/api/ai/health")
    expect(res.status).toBe(200)
  })
})

/**
 * 防复发（QM-5 第 5 步）：行为用例无法区分「恒定时间比较」与「!== 比较」（两者接受/拒绝结果相同），
 * 因此把「必须走 timingSafeKeyEqual」固定成静态不变量 —— 否则换回 `!==` 也能全绿。
 */
describe("中间件必须走恒定时间比较", function () {
  // vitest 的 cwd 就是包根目录（与 vitest.config.js 同层）
  var src = fs.readFileSync(path.join(process.cwd(), "src", "server.js"), "utf8")

  test("使用 timingSafeKeyEqual 比较 X-API-Key", function () {
    expect(src).toContain('require("./auth")')
    expect(src).toContain("timingSafeKeyEqual(key, apiKey)")
  })

  test("不保留 `key !== apiKey` 短路写法", function () {
    expect(src).not.toMatch(/key\s*!==\s*apiKey/)
    expect(src).not.toMatch(/key\s*===\s*apiKey/)
  })
})
