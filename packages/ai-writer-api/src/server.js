/**
 * AiWriter API Server — HTTP REST API for @multi-publish/ai-writer
 *
 * Endpoints:
 *   GET  /api/ai/health       — Health check
 *   POST /api/ai/titles       — Generate titles     { topic, count? }
 *   POST /api/ai/summary      — Generate summary     { content }
 *   POST /api/ai/enhance      — Enhance content      { content, style? }
 *
 * Auth via X-API-Key header (key from env AI_WRITER_API_KEY, required)
 *
 * Usage:
 *   AI_WRITER_API_KEY=sk-xxx node src/server.js              # Start on port 3487
 *   AI_WRITER_API_KEY=sk-xxx node src/server.js --port 8080
 */

var express = require("express")
var AiWriter = require("@multi-publish/ai-writer")
var { timingSafeKeyEqual } = require("./auth")

var DEFAULT_PORT = 3487
// 安全：必须显式设置 AI_WRITER_API_KEY，不再提供弱默认值
var API_KEY = process.env.AI_WRITER_API_KEY || ""

function getWriterApiKey(req) {
  return req.headers["x-openai-key"] || process.env.OPENAI_API_KEY || ""
}

function createApp(options) {
  options = options || {}
  var apiKey = options.apiKey || API_KEY
  if (!apiKey) {
    throw new Error("AI_WRITER_API_KEY environment variable is required (set it before starting the server)")
  }
  var app = express()

  app.use(express.json())

  // Auth middleware
  app.use("/api/ai", function(req, res, next) {
    if (req.path === "/health") return next()  // skip auth for health
    var key = req.headers["x-api-key"]
    // 恒定时间比较（体检报告 P2 安全小项）：`!==` 在首个差异字节短路，耗时可被用来逐字节猜密钥；
    // 非字符串（重复头会给出数组）与空串一律 401，不给「两侧都空 ⇒ 相等」留口子。
    if (!timingSafeKeyEqual(key, apiKey)) {
      return res.status(401).json({ error: "Unauthorized. Set X-API-Key header." })
    }
    next()
  })

  // Health
  app.get("/api/ai/health", function(req, res) {
    res.json({ status: "ok", service: "ai-writer-api", version: "1.0.0" })
  })

  // Generate Titles
  app.post("/api/ai/titles", async function(req, res) {
    try {
      var topic = req.body.topic
      if (!topic) return res.status(400).json({ error: "Missing required field: topic" })
      var count = req.body.count || 5
      var writer = new AiWriter({ apiKey: getWriterApiKey(req) })
      var titles = await writer.generateTitles(topic, count)
      res.json({ data: titles })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Generate Summary
  app.post("/api/ai/summary", async function(req, res) {
    try {
      var content = req.body.content
      if (!content) return res.status(400).json({ error: "Missing required field: content" })
      var writer = new AiWriter({ apiKey: getWriterApiKey(req) })
      var summary = await writer.generateSummary(content)
      res.json({ data: summary })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Enhance Content
  app.post("/api/ai/enhance", async function(req, res) {
    try {
      var content = req.body.content
      if (!content) return res.status(400).json({ error: "Missing required field: content" })
      var style = req.body.style || "polish"
      var writer = new AiWriter({ apiKey: getWriterApiKey(req) })
      var enhanced = await writer.enhanceContent(content, style)
      res.json({ data: enhanced })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return app
}

// 延迟初始化：仅在 API_KEY 可用时导出 app，否则导出工厂（避免 require 时抛错）
module.exports = API_KEY ? createApp() : { createApp: createApp, _needsApiKey: true }

// Main
if (require.main === module) {
  var port = parseInt(process.argv[process.argv.indexOf("--port") + 1], 10) || DEFAULT_PORT
  if (!API_KEY) {
    console.error("ERROR: AI_WRITER_API_KEY environment variable is required")
    console.error("Example: AI_WRITER_API_KEY=sk-xxx node src/server.js")
    process.exit(1)
  }
  var app = createApp()
  app.listen(port, function() {
    console.log("AiWriter API server listening on port " + port)
    console.log("API Key: (configured)")
  })
}
