// Offline assets from the approved tokens and bundled type; no external requests.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "../../desktop/node_modules/playwright/index.mjs";
import sharp from "sharp";
const root = new URL("../", import.meta.url);
const font = await readFile(new URL("public/fonts/ibm-plex-sans-hebrew-latin-600-normal.woff2", root));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route("**/*", route => route.abort());
  await page.setContent(`<style>@font-face{font-family:Plex;src:url(data:font/woff2;base64,${font.toString("base64")})}*{box-sizing:border-box}body{margin:0;background:#17151c;color:#f0edf5;font-family:Plex}main{height:630px;display:flex;flex-direction:column;padding:70px}header{font-size:24px;color:#bfb7c8;border-bottom:1px solid #49434f;padding-bottom:28px}h1{font-size:68px;line-height:1.15;letter-spacing:-2px;max-width:800px;margin:66px 0 28px}p{font-size:26px;color:#bfb7c8;margin:0}footer{margin-top:auto;display:flex;gap:12px}i{display:block;background:#302a38;border:1px solid #49434f;border-radius:10px;height:32px;width:82px}i:nth-child(2){width:240px;background:#494053}i:nth-child(3){width:160px}</style><main><header>CONTROL ROOM</header><h1>Chief of Noumenon</h1><p>Your bots, conversations and computers.<br>You stay in control.</p><footer><i></i><i></i><i></i></footer></main>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL("public/social.png", root).pathname });
} finally { await browser.close(); }
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#17151c"/><rect x="9" y="14" width="9" height="36" rx="3" fill="#bfb7c8"/><rect x="22" y="14" width="20" height="36" rx="3" fill="#f0edf5"/><rect x="46" y="14" width="9" height="36" rx="3" fill="#bfb7c8"/></svg>`;
await writeFile(new URL("app/icon.svg", root), icon);
const png = await sharp(Buffer.from(icon)).png().toBuffer();
// PNG-compressed ICO: one 64px entry, supported by current browsers and desktop shells.
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = 64; header[7] = 64; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await writeFile(new URL("app/favicon.ico", root), Buffer.concat([header, png]));
