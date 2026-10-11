/**
 * e2e-qr-login.js - Multi-Publish E2E QR Login Test (fixed v2)
 *
 * Uses platform's QR login API directly for reliable QR code generation.
 * Saves QR image to /tmp/, provides SCP command to copy to local.
 * Polls for login status. Supports Bilibili and other platforms.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CHROMIUM_PATH = "/usr/bin/chromium-browser";
const SS_DIR = "/opt/multipublish/apps/desktop/tests/screenshots";
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// Platform configurations with QR API endpoints
const PLATFORMS = {
  bilibili: {
    name: "Bilibili",
    generateQR: {
      url: "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
      responsePath: "data.url",
      keyPath: "data.qrcode_key"
    },
    poll: {
      url: "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=",
      isScanning: (d) => d.data && (d.data.code === 86101 || d.data.code === 86090),
      isLoggedIn: (d) => d.data && d.data.code === 0,
      isExpired: (d) => d.data && d.data.code === 86038
    },
    cookies: ["SESSDATA", "bili_jct", "DedeUserID"]
  }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateQRCode(platform, page) {
  const cfg = PLATFORMS[platform];
  console.log("  Generating QR code via API...");

  const resp = await page.goto(cfg.generateQR.url, {
    waitUntil: "networkidle", timeout: 15000
  });
  const data = JSON.parse(await resp.text());

  if (data.code !== 0 || !data.data) {
    throw new Error("API error: " + JSON.stringify(data));
  }

  const qrUrl = data.data.url;
  const qrKey = data.data.qrcode_key;
  console.log("  QR URL: " + qrUrl);
  console.log("  QR Key: " + qrKey);

  // Get QR code image from public API
  const qrImgUrl = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data="
    + encodeURIComponent(qrUrl);
  await page.goto(qrImgUrl, { waitUntil: "networkidle", timeout: 15000 });
  await sleep(1000);

  const qrImgPath = "/tmp/" + platform + "-qr-login.png";
  await page.screenshot({ path: qrImgPath });
  console.log("  QR image saved to " + qrImgPath);

  return { qrKey, qrUrl, qrImgPath };
}

async function pollLogin(platform, qrKey, page) {
  const cfg = PLATFORMS[platform];
  const pollUrl = cfg.poll.url + qrKey;

  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    try {
      const resp = await page.goto(pollUrl, { waitUntil: "networkidle", timeout: 10000 });
      const data = JSON.parse(await resp.text());

      if (cfg.poll.isLoggedIn(data)) {
        console.log("");
        console.log("  ===== LOGIN SUCCESSFUL =====");
        // Save cookies
        const cookies = await page.context().cookies();
        const cookieFile = "/opt/multipublish/apps/desktop/tests/" + platform + "-cookies.json";
        fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
        console.log("  Cookies saved to " + cookieFile);

        // Screenshot logged-in state
        await page.goto("https://www.bilibili.com/", { waitUntil: "networkidle", timeout: 15000 });
        await sleep(2000);
        await page.screenshot({ path: "/tmp/" + platform + "-loggedin.png", fullPage: false });
        return true;
      }

      if (cfg.poll.isExpired(data)) {
        console.log("  QR code expired");
        return false;
      }

      if (i % 10 === 0) {
        const status = data.data ? data.data.code : "unknown";
        console.log("  Polled " + i + "s... status=" + status);
      }
    } catch (e) {
      console.log("  Poll error: " + e.message + ", retrying...");
    }
  }
  return false;
}

async function testBilibiliQR() {
  console.log("");
  console.log("========================================");
  console.log("  Bilibili QR Login Test");
  console.log("========================================");
  console.log("");

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-gpu"]
  });

  let success = false;
  try {
    const page = await browser.newPage();
    const qrInfo = await generateQRCode("bilibili", page);

    console.log("");
    console.log("  === SCAN THIS QR CODE ===");
    console.log("  QR image: " + qrInfo.qrImgPath);
    console.log("");
    console.log("  1. Run this in local PowerShell to get the QR image:");
    console.log("     scp ali:" + qrInfo.qrImgPath + " " + SS_DIR.replace("/opt/multipublish", "D:\\Data\\projects\\mulpub") + "\\bilibili-qr.png");
    console.log("");
    console.log("  2. Open the image on your phone and scan with Bilibili app");
    console.log("  3. Test will auto-detect login (waiting up to 120s)...");
    console.log("");

    // Also save a local reference
    const localCopy = SS_DIR + "/bilibili-qr-reference.png";
    fs.copyFileSync(qrInfo.qrImgPath, localCopy);

    success = await pollLogin("bilibili", qrInfo.qrKey, page);

    if (success) {
      console.log("");
      console.log("  ===== TEST PASSED =====");
      // Copy logged-in screenshot
      try {
        fs.copyFileSync("/tmp/bilibili-loggedin.png", SS_DIR + "/bilibili-loggedin.png");
      } catch(e) {}
    } else {
      console.log("");
      console.log("  ===== TEST TIMEOUT/EXPIRED =====");
    }
  } catch (err) {
    console.log("");
    console.log("  ERROR: " + err.message);
  } finally {
    await browser.close();
  }

  return success;
}

async function main() {
  console.log("========================================");
  console.log("  Multi-Publish E2E QR Login Test");
  console.log("========================================");

  const platform = process.argv[2] || "bilibili";
  console.log("  Platform: " + platform);

  let result = false;
  if (platform === "bilibili") {
    result = await testBilibiliQR();
  } else {
    console.log("  Unknown platform: " + platform);
  }

  console.log("");
  console.log("========================================");
  console.log("  Result: " + (result ? "PASS" : "FAIL/TIMEOUT"));
  console.log("========================================");
  process.exit(result ? 0 : 1);
}

main();
