import { chromium } from "playwright";

const out = process.argv[2] ?? 'screenshots';
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://127.0.0.1:4177/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/1-office.png` });

// hover the first busy desk: find via store
const pos = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const r = c.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
});
// sweep to find a desk that triggers a tooltip
let found = false;
for (let y = 250; y < 700 && !found; y += 40) {
  for (let x = 350; x < 1100 && !found; x += 40) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
    if (await page.$(".tooltip")) found = true;
  }
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/2-tooltip.png` });

if (found) {
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/3-panel.png` });
}

await page.click(".hud >> text=Board");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/4-board.png` });

await page.click(".hud >> text=Hire");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/5-hire.png` });
await page.click(".modal button.primary");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/6-hired.png` });

// wait for a waiting state to appear
for (let i = 0; i < 40; i++) {
  const w = await page.evaluate(() => document.querySelector(".hud")?.textContent);
  if (w && /[1-9] need you/.test(w)) break;
  await page.waitForTimeout(700);
}
await page.click(".hud >> text=Close board"); await page.click(".panel header button"); await page.mouse.move(10, 10);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/7-waiting.png` });
console.log("errors:", errors);
await browser.close();
