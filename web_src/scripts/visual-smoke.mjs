import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const url = args.url ?? process.env.WEBVIEW_URL ?? "http://127.0.0.1:8765/?snapshot=1&smoke=1";
const chrome = args.chrome ?? process.env.CHROME_PATH ?? findChrome();

if (!chrome) {
  console.error("Unable to find Chrome. Set CHROME_PATH to a headless-capable Chrome executable.");
  process.exit(1);
}

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Webview did not respond: ${response.status} ${response.statusText}`);
}

const { stdout } = await execFileAsync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-sync",
    "--force-device-scale-factor=1",
    "--window-size=1448,1086",
    "--virtual-time-budget=1000",
    "--dump-dom",
    url,
  ],
  { maxBuffer: 4 * 1024 * 1024, timeout: 15000 },
);

const match = stdout.match(/data-visual-smoke="([^"]+)"/);
if (!match) {
  throw new Error("Visual smoke probe was not written to the DOM.");
}

const probe = Object.fromEntries(
  match[1]
    .replace(/&quot;/g, '"')
    .split(";")
    .filter(Boolean)
    .map((pair) => pair.split("=")),
);

const failures = [];
if (probe.scrollX !== "0" || probe.scrollY !== "0") {
  failures.push(`page scroll detected (${probe.scrollX}, ${probe.scrollY})`);
}
if (Number(probe.canvasW) < 900 || Number(probe.canvasH) < 520) {
  failures.push(`canvas too small (${probe.canvasW}x${probe.canvasH})`);
}
if (Number(probe.shellW) < 1400 || Number(probe.shellH) < 980) {
  failures.push(`shell mismatch (${probe.shellW}x${probe.shellH})`);
}

if (failures.length) {
  throw new Error(`Visual smoke failed: ${failures.join(", ")}`);
}

console.log(
  `Visual smoke passed: viewport=${probe.viewportW}x${probe.viewportH}, canvas=${probe.canvasW}x${probe.canvasH}, scroll=0`,
);

function parseArgs(items) {
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    parsed[rawKey] = inlineValue ?? items[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  return parsed;
}

function findChrome() {
  const candidates = [
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ];
  return candidates.find((candidate) => !candidate.startsWith("/") || existsSync(candidate));
}
