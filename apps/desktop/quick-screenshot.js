const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function main() {
  const screenshotDir = path.join(__dirname, "tests/visual-testing/screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: "D:/Data/projects/mulpub/apps/desktop/.playwright-browsers/chromium-1228/chrome-win64/chrome.exe"
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const routes = [
    { name: "home", url: "http://localhost:5174/#/" },
    { name: "accounts", url: "http://localhost:5174/#/accounts" },
    { name: "publish", url: "http://localhost:5174/#/publish" },
    { name: "monitor", url: "http://localhost:5174/#/monitor" },
    { name: "dashboard", url: "http://localhost:5174/#/dashboard" },
  ];

  for (const r of routes) {
    console.log("Navigating to: " + r.url);
    await page.goto(r.url, { waitUntil: "networkidle", timeout: 10000 });
    await page.waitForTimeout(1000);
    const screenshotPath = path.join(screenshotDir, r.name + ".png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log("Screenshot: " + screenshotPath);
  }

  await browser.close();
  console.log("Done");
}

main().catch(e => { console.error(e.message); process.exit(1); });