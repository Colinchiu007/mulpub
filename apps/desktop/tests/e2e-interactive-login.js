/**
 * e2e-interactive-login.js - Multi-Publish 交互式登录测试
 * 
 * 支持: 手机号+验证码 (B站) / 二维码 (B站)
 * 交互流程: 截图验证码→用户输入→发送短信→用户输验证码→登录→验证
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CHROMIUM_PATH = "/usr/bin/chromium-browser";
const SS = "/opt/multipublish/apps/desktop/tests/screenshots";
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function bilibiliSMSLogin(browser) {
  console.log("\n=== Bilibili SMS Login ===");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("https://passport.bilibili.com/login", { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Click SMS tab
  await page.evaluate(() => {
    const tabs = document.querySelectorAll(".tabs_wp > *");
    for (let t of tabs) {
      if (t.textContent.includes("\u77ed\u4fe1")) { t.click(); return; }
    }
  });
  await sleep(1000);
  console.log("  SMS tab clicked");

  // Ask for phone number
  const phone = await ask("\u8bf7\u8f93\u5165\u624b\u673a\u53f7: ");
  const phoneInput = await page.$('input[placeholder*="\u624b\u673a\u53f7"]');
  if (phoneInput) {
    await phoneInput.fill(phone);
    console.log("  Phone entered");
  }

  // Screenshot captcha area
  await sleep(500);
  const captchaImg = await page.$(".body__captcha-input, .captcha-img, img[src*=captcha]");
  if (captchaImg) {
    await captchaImg.screenshot({ path: "/tmp/bili-captcha.png" });
    console.log("  Captcha screenshot saved to /tmp/bili-captcha.png");
    console.log("  Run: scp ali:/tmp/bili-captcha.png " + SS.replace("/opt/multipublish", "D:\\Data\\projects\\mulpub") + "\\captcha.png");
  } else {
    await page.screenshot({ path: "/tmp/bili-captcha-page.png", clip: { x: 0, y: 400, width: 400, height: 200 } });
    console.log("  Page screenshot saved for captcha reference");
    console.log("  Run: scp ali:/tmp/bili-captcha-page.png " + SS.replace("/opt/multipublish", "D:\\Data\\projects\\mulpub") + "\\captcha.png");
  }

  // Ask for captcha text
  const captcha = await ask("\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801\u56fe\u7247\u4e2d\u7684\u5185\u5bb9: ");
  const captchaInput = await page.$('input[placeholder*="\u56fe\u7247"]');
  if (captchaInput) {
    await captchaInput.fill(captcha);
    console.log("  Captcha entered");
  }

  // Click send SMS button
  const sendBtn = await page.$("text=\u53d1\u9001\u9a8c\u8bc1\u7801, button:has-text(\"\u83b7\u53d6\"), button:has-text(\"\u53d1\u9001\")");
  if (sendBtn) {
    await sendBtn.click();
    console.log("  SMS sent!");
  } else {
    // Try finding any button that sends SMS
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (let b of btns) {
        if (b.textContent.includes("\u83b7\u53d6") || b.textContent.includes("\u53d1\u9001")) {
          b.click(); return;
        }
      }
    });
  }

  // Wait for SMS code
  await sleep(1000);
  const smsCode = await ask("\u624b\u673a\u6536\u5230\u9a8c\u8bc1\u7801\u540e\u8bf7\u8f93\u5165: ");

  const codeInput = await page.$('input[placeholder*="\u9a8c\u8bc1\u7801"], input[type="text"]:not([placeholder*="\u624b\u673a"]):not([placeholder*="\u56fe\u7247"])');
  if (codeInput) {
    await codeInput.fill(smsCode);
    console.log("  SMS code entered");
  }

  // Click login button
  const loginBtn = await page.$("text=\u767b\u5f55, button:has-text(\"\u767b\u5f55\")");
  if (loginBtn) {
    await loginBtn.click();
  } else {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (let b of btns) {
        if (b.textContent.includes("\u767b\u5f55")) { b.click(); return; }
      }
    });
  }

  // Wait for login result
  console.log("  Waiting for login...");
  await sleep(5000);

  // Check cookies
  const cookies = await page.context().cookies();
  const sess = cookies.find(c => c.name === "SESSDATA");
  if (sess) {
    console.log("  LOGIN SUCCESSFUL! SESSDATA: " + sess.value.substring(0, 20) + "...");
    const fp = "/opt/multipublish/apps/desktop/tests/bilibili-cookies.json";
    fs.writeFileSync(fp, JSON.stringify(cookies, null, 2));
    console.log("  Cookies saved to " + fp);

    // Visit Bilibili home to confirm
    await page.goto("https://www.bilibili.com/", { waitUntil: "networkidle", timeout: 15000 });
    await sleep(2000);
    await page.screenshot({ path: "/tmp/bilibili-loggedin-sms.png" });
    console.log("  Logged-in screenshot saved");
    await page.close();
    return true;
  }

  console.log("  Login may have failed. Current URL: " + page.url());
  await page.screenshot({ path: "/tmp/bilibili-login-failed.png" });
  await page.close();
  return false;
}

async function bilibiliQRLogin(browser) {
  console.log("\n=== Bilibili QR Login ===");
  const page = await browser.newPage();

  // Generate QR via API
  const resp = await page.goto("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", {
    waitUntil: "networkidle", timeout: 15000
  });
  const data = JSON.parse(await resp.text());
  const qrKey = data.data.qrcode_key;
  const qrUrl = data.data.url;

  console.log("  QR Key: " + qrKey);

  // Get QR image
  const qrImgUrl = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(qrUrl);
  await page.goto(qrImgUrl, { waitUntil: "networkidle", timeout: 15000 });
  await sleep(1000);
  await page.screenshot({ path: "/tmp/bilibili-qr-interactive.png" });

  console.log("  QR image at: /tmp/bilibili-qr-interactive.png");
  console.log("  Run: scp ali:/tmp/bilibili-qr-interactive.png " + SS.replace("/opt/multipublish", "D:\\Data\\projects\\mulpub") + "\\bilibili-qr.png");
  console.log("  Scan with Bilibili app. Waiting up to 180s...");

  const pollUrl = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=" + qrKey;
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    try {
      const r = await page.goto(pollUrl, { waitUntil: "networkidle", timeout: 10000 });
      const d = JSON.parse(await r.text());
      if (d.code === 0 && d.data) {
        if (d.data.code === 0) {
          console.log("  LOGIN SUCCESSFUL!");
          const cookies = await page.context().cookies();
          fs.writeFileSync("/opt/multipublish/apps/desktop/tests/bilibili-cookies.json", JSON.stringify(cookies, null, 2));
          console.log("  Cookies saved!");
          await page.close();
          return true;
        } else if (d.data.code === 86101) {
          if (i % 15 === 0) console.log("  Waiting... (" + i + "s)");
        } else if (d.data.code === 86090) {
          console.log("  Scanned! Confirming...");
        }
      }
    } catch(e) { /* retry */ }
  }
  console.log("  QR timeout");
  await page.close();
  return false;
}

async function main() {
  console.log("========================================");
  console.log("  Multi-Publish Interactive Login Test");
  console.log("========================================");

  console.log("\nAvailable methods:");
  console.log("  1. Bilibili QR login (scan with app)");
  console.log("  2. Bilibili SMS login (phone + captcha + SMS)");

  const method = await ask("\nSelect method (1 or 2): ");

  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-gpu"]
  });

  let ok = false;
  try {
    if (method === "1") {
      ok = await bilibiliQRLogin(browser);
    } else if (method === "2") {
      ok = await bilibiliSMSLogin(browser);
    } else {
      console.log("Invalid choice");
    }
  } catch (err) {
    console.log("Error: " + err.message);
  } finally {
    await browser.close();
    rl.close();
  }

  console.log("\nResult: " + (ok ? "PASS" : "FAIL"));
  process.exit(ok ? 0 : 1);
}

main();
