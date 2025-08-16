// Node 20+
// 由 docs/files/**/*.pdf 產生 docs/manifest/*.json

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// -------------------- 設定 --------------------
const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "docs");
const FILES_DIR = process.env.FILES_DIR || path.join(DOCS_DIR, "files");
const OUT_DIR = process.env.MANIFEST_DIR || path.join(DOCS_DIR, "manifest");
const ERROR_FILE = path.join(OUT_DIR, "manifest-errors.json");

// 檔名解析：舊制 6+6
const LEGACY_RE = /^(\d{6})[-_\s]?(\d{6})$/i;

// 新制（管/蓋）+「可選」尾端 6+6 舊制：…Lot-<LOT>-<dddddd>-<dddddd>.pdf
const NEW_CAP_RE  = /^MB-([A-Za-z0-9]+)CAP-Lot-([A-Za-z0-9]+)(?:-(\d{6})[-_]?(\d{6}))?\.pdf$/i;
const NEW_TUBE_RE = /^MB-([A-Za-z0-9]+)-Lot-([A-Za-z0-9]+)(?:-(\d{6})[-_]?(\d{6}))?\.pdf$/i;

// -------------------- 工具 --------------------
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(walk(p));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) files.push(p);
  }
  return files;
}

function sha256FileSync(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function prettyJSON(x) { return JSON.stringify(x, null, 2); }
function bytes(n) { return Number.isFinite(n) ? n : 0; }

function toUrl(fromDocsPath) {
  // 將 docs 相對路徑轉為網站相對路徑（GitHub Pages 可用）
  return fromDocsPath.replace(/\\/g, "/");
}

function groupByYear(items) {
  const map = new Map();
  for (const it of items) {
    const y = new Date(it.mtime || Date.now()).getFullYear();
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(it);
  }
  return map;
}

// -------------------- 檔名解析 --------------------
function parseName(base) {
  let m;
  if ((m = base.match(NEW_CAP_RE))) {
    const product = "MB-" + m[1];
    const legacy  = (m[3] && m[4]) ? `${m[3]}-${m[4]}` : "";
    return { product, is_cap: true,  lot: m[2], legacy_key: legacy };
  }
  if ((m = base.match(NEW_TUBE_RE))) {
    const product = "MB-" + m[1];
    const legacy  = (m[3] && m[4]) ? `${m[3]}-${m[4]}` : "";
    return { product, is_cap: false, lot: m[2], legacy_key: legacy };
  }
  if ((m = base.replace(/\.pdf$/i, "").match(LEGACY_RE))) {
    const k = `${m[1]}-${m[2]}`;
    return { product: "", is_cap: false, lot: "", legacy_key: k };
  }
  return null; // 不合規：寫入 errors
}

// -------------------- 主流程 --------------------
function build() {
  ensureDir(OUT_DIR);

  const absFiles = fs.existsSync(FILES_DIR) ? walk(FILES_DIR) : [];
  const items = [];
  const errors = [];

  for (const abs of absFiles) {
    const relFromDocs = path.relative(DOCS_DIR, abs); // files/.../name.pdf
    const base = path.basename(abs);
    const stat = fs.statSync(abs);
    const parsed = parseName(base);

    if (!parsed) {
      errors.push({ file: relFromDocs, reason: "unrecognized filename pattern" });
      continue;
    }

    items.push({
      file_name: base,
      url: toUrl(relFromDocs),
      product: parsed.product,
      is_cap: !!parsed.is_cap,
      lot: parsed.lot,
      legacy_key: parsed.legacy_key || "",
      mtime: new Date(stat.mtimeMs).toISOString(),
      size: bytes(stat.size),
      sha256: sha256FileSync(abs),
    });
  }

  // 依時間新到舊排序
  items.sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));

  // 依年份分片
  const shards = [];
  const byYear = groupByYear(items);
  for (const [year, arr] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const shardPath = `manifest-${year}.json`;
    fs.writeFileSync(path.join(OUT_DIR, shardPath), prettyJSON({ items: arr }), "utf8");
    shards.push({
      year,
      path: shardPath,
      items: arr.length,
      etag: sha256(arr.map(it => it.sha256).join(",")),
    });
  }

  // 索引檔
  const index = { version: new Date().toISOString(), total: items.length, shards };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), prettyJSON(index), "utf8");

  // 錯誤清單
  fs.writeFileSync(ERROR_FILE, prettyJSON({ errors }), "utf8");

  console.log(`[manifest] items=${items.length} shards=${shards.length} errors=${errors.length}`);
  return { items: items.length, shards: shards.length, errors: errors.length };
}

// 直接執行
if (import.meta.url === `file://${process.argv[1]}`) {
  build();
}
