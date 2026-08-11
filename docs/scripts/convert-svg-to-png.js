// Renders the Docs/diagrams SVGs to PNG at retina scale for docx embedding.
// Uses puppeteer-core with the locally installed Chrome (no Chromium download).
// Add an entry to DIAGRAMS for every new diagram; w/h must match the SVG viewport.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const DIAGRAMS = [
  {
    svg: "security-diagram-1-architecture.svg",
    png: "security-diagram-1-architecture.png",
    w: 1000,
    h: 700,
  },
  {
    svg: "security-diagram-2-web-clockin.svg",
    png: "security-diagram-2-web-clockin.png",
    w: 1000,
    h: 570,
  },
  {
    svg: "security-diagram-3-device-api.svg",
    png: "security-diagram-3-device-api.png",
    w: 1000,
    h: 600,
  },
  {
    svg: "security-diagram-4-observability.svg",
    png: "security-diagram-4-observability.png",
    w: 1000,
    h: 690,
  },
];

const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome() {
  for (const p of CHROME_PATHS) if (fs.existsSync(p)) return p;
  throw new Error("Chrome not found — install Google Chrome or add its path to CHROME_PATHS");
}

(async () => {
  const diagramsDir = path.join(__dirname, "../diagrams");
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: "new" });
  const page = await browser.newPage();

  for (const d of DIAGRAMS) {
    const svgPath = path.join(diagramsDir, d.svg);
    const pngPath = path.join(diagramsDir, d.png);
    const svg = fs.readFileSync(svgPath, "utf8");

    await page.setViewport({ width: d.w, height: d.h, deviceScaleFactor: 2 });
    // Wrap in a page so the Montserrat webfont @import resolves; white bg for docx.
    const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#FFFFFF;}</style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    // Wait for the Montserrat webfont without depending on network idleness
    // (Google Fonts keep-alive connections can stall networkidle0 forever).
    await Promise.race([
      page.evaluateHandle("document.fonts.ready"),
      new Promise((r) => setTimeout(r, 15000)),
    ]);
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: d.w, height: d.h } });
    console.log(`OK  ${d.png}  (${d.w * 2}x${d.h * 2})`);
  }

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
