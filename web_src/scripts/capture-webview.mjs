import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const url = args.url ?? process.env.WEBVIEW_URL ?? "http://127.0.0.1:8765/?snapshot=1";
const width = Number(args.width ?? process.env.WEBVIEW_WIDTH ?? 1448);
const height = Number(args.height ?? process.env.WEBVIEW_HEIGHT ?? 1086);
const output = resolve(args.output ?? process.env.WEBVIEW_SCREENSHOT ?? ".tmp-smoke/webui-current.png");
const chrome = args.chrome ?? process.env.CHROME_PATH ?? findChrome();
const timeout = Number(args.timeout ?? process.env.WEBVIEW_CAPTURE_TIMEOUT_MS ?? 12000);
const windowsChrome = chrome?.toLowerCase().endsWith(".exe") ?? false;
const chromeExtraHeight = windowsChrome
  ? Number(args.chromeExtraHeight ?? process.env.WEBVIEW_CHROME_EXTRA_HEIGHT ?? 104)
  : 0;
const chromeExtraWidth = windowsChrome
  ? Number(args.chromeExtraWidth ?? process.env.WEBVIEW_CHROME_EXTRA_WIDTH ?? 22)
  : 0;
const captureWidth = width + chromeExtraWidth;
const captureHeight = height + chromeExtraHeight;
const rawOutput =
  chromeExtraHeight > 0 || chromeExtraWidth > 0
    ? resolve(dirname(output), `capture-${process.pid}-${Date.now()}-raw.png`)
    : output;

if (!chrome) {
  console.error("Unable to find Chrome. Set CHROME_PATH to a headless-capable Chrome executable.");
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });

const chromeArgs = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-extensions",
  "--force-device-scale-factor=1",
  `--window-size=${captureWidth},${captureHeight}`,
  `--screenshot=${pathForChrome(rawOutput, chrome)}`,
  url,
];

await execFileAsync(chrome, chromeArgs, { timeout, maxBuffer: 1024 * 1024 });

if (!existsSync(rawOutput)) {
  throw new Error(`Chrome exited without writing ${rawOutput}`);
}

if (rawOutput !== output) {
  await cropPngWithPowerShell(rawOutput, output, width, height);
  rmSync(rawOutput, { force: true });
}

console.log(`Captured ${width}x${height} ${url} -> ${output}`);

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

function pathForChrome(path, chromePath) {
  if (!chromePath.toLowerCase().endsWith(".exe")) {
    return path;
  }
  const match = path.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (!match) {
    return path;
  }
  return `${match[1].toUpperCase()}:\\${match[2].replaceAll("/", "\\")}`;
}

async function cropPngWithPowerShell(source, target, cropWidth, cropHeight) {
  const script = `
Add-Type -AssemblyName System.Drawing
$sourcePath = ${psString(pathForChrome(source, chrome))}
$targetPath = ${psString(pathForChrome(target, chrome))}
$sourceImage = [System.Drawing.Bitmap]::FromFile($sourcePath)
$targetImage = New-Object System.Drawing.Bitmap(${cropWidth}, ${cropHeight})
$graphics = [System.Drawing.Graphics]::FromImage($targetImage)
try {
  $targetRect = New-Object System.Drawing.Rectangle(0, 0, ${cropWidth}, ${cropHeight})
  $sourceRect = New-Object System.Drawing.Rectangle(0, 0, ${cropWidth}, ${cropHeight})
  $graphics.DrawImage($sourceImage, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $targetImage.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $targetImage.Dispose()
  $sourceImage.Dispose()
}
`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
}

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
