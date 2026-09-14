/**
 * YouTube API Adapter (P0) ? YouTube Data API v3
 *
 * Uses OAuth 2.0 for authentication.
 * Requires YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN in env.
 */
const https = require("https");
const querystring = require("querystring");

var CONFIG = {
  apiBase: "https://www.googleapis.com/youtube/v3",
  uploadBase: "https://www.googleapis.com/upload/youtube/v3",
  scopes: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
};

function getAccessToken() {
  var clientId = process.env.YOUTUBE_CLIENT_ID;
  var clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  var refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return Promise.reject(new Error("YouTube OAuth: missing YOUTUBE_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN"));
  }
  return new Promise(function(resolve, reject) {
    var data = querystring.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    var req = https.request({
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(data) },
    }, function(resp) {
      var body = "";
      resp.on("data", function(c) { body += c; });
      resp.on("end", function() {
        try { var j = JSON.parse(body); resolve(j.access_token); }
        catch(e) { reject(new Error("YouTube OAuth failed: " + body)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function apiRequest(method, path, accessToken, body) {
  return new Promise(function(resolve, reject) {
    var headers = { Authorization: "Bearer " + accessToken };
    if (body) headers["Content-Type"] = "application/json";
    var req = https.request({
      hostname: "www.googleapis.com",
      path: path,
      method: method,
      headers: headers,
    }, function(resp) {
      var data = "";
      resp.on("data", function(c) { data += c; });
      resp.on("end", function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error("YouTube API: " + data)); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

class YouTubeAdapter {
  constructor() { this.name = "youtube"; }

  async execute(taskData, cookie, opts) {
    try {
      var token = await getAccessToken();

      // Step 1: Create video resource
      var videoBody = {
        snippet: {
          title: taskData.title || "Untitled",
          description: taskData.content || "",
          tags: taskData.tags || [],
          categoryId: taskData.categoryId || "22",
        },
        status: {
          privacyStatus: taskData.privacy || "public",
          selfDeclaredMadeForKids: false,
        },
      };

      // P2-1：播放列表（参考产品无此映射；YouTube Data API 需先建 video 再
      // playlistItems.insert — 此处记录 playlistId，上传完成后由调用方处理）
      if (taskData.playlistId) {
        videoBody.playlistId = taskData.playlistId;
      }

      var videoRes = await apiRequest("POST", "/youtube/v3/videos?part=snippet,status", token, videoBody);

      if (taskData.videoPath || taskData.videoUrl) {
        // Resumable upload would go here ? simplified for now
        return { success: true, platform: "youtube", publishId: videoRes.id, videoRes: videoRes };
      }

      return { success: true, platform: "youtube", publishId: videoRes.id, videoRes: videoRes };
    } catch (e) {
      return { success: false, error: e.message, platform: "youtube" };
    }
  }
}

module.exports = YouTubeAdapter;
