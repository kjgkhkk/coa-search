// Node 20+
// Build manifest from docs/files/**/*.pdf into docs/manifest/*.json
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "docs");
const FILES_DIR = process.env.FILES_DIR || path.join(DOCS_DIR, "files");
const OUT_DIR = process.env.MANIFEST_DIR || path.join(DOCS_DIR, "manifest");
const ERROR_FILE = path.join(OUT_DIR, "manifest-errors.json");

const LEGACY_RE = /^(\d{6})[-_\s]?(\d{6})$/i;
const NEW_CAP_RE = /^MB-([A-Za-z0-9]+)CAP-Lot-([A-Za-z0-9]+)\.pdf$/i;
const NEW_TUBE_RE = /^MB-([A-Za-z0-9]+)-Lot-([A-Za-z0-9]+)\.pdf$/i;

function walk(dir){
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries){
    const p = path.join(dir, e.name);
    if (e.isDirectory()){
      files = files.concat(walk(p));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")){
      files.push(p);
    }
  }
  return files;
}

function sha256FileSync(p){
  const hash = crypto.createHash("sha256");
  const buf = fs.readFileSync(p);
  hash.update(buf);
  return hash.digest("hex");
}

function toUrl(fromDocsPath){
  // Use relative URL from site root (works on GitHub Pages project sites).
  return fromDocsPath.replace(/\\/g, "/");
}

function parseName(base){
  // Return {product,is_cap,lot,legacy_key} or null on totally invalid
  let m;
  if ((m = base.match(NEW_CAP_RE))){
    const product = "MB-" + m[1];
    return { product, is_cap: true, lot: m[2], legacy_key: "" };
  }
  if ((m = base.match(NEW_TUBE_RE))){
    const product = "MB-" + m[1];
    return { product, is_cap: false, lot: m[2], legacy_key: "" };
  }
  if ((m = base.replace(/\.pdf$/i,"").match(LEGACY_RE))){
    const k = `${m[1]}-${m[2]}`;
    return { product: "", is_cap: false, lot: "", legacy_key: k };
  }
  // Unrecognized -> still emit minimal record so user can see errors
  return null;
}

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function groupByYear(items){
  const map = new Map();
  for (const it of items){
    const y = new Date(it.mtime || Date.now()).getFullYear();
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(it);
  }
  return map;
}

function prettyJSON(obj){ return JSON.stringify(obj, null, 2); }

function bytes(n){ return typeof n === "number" && Number.isFinite(n) ? n : 0; }

function build(){
  ensureDir(OUT_DIR);
  const files = walk(FILES_DIR);
  const items = [];
  const errors = [];

  for (const abs of files){
    const relFromDocs = path.relative(DOCS_DIR, abs); // files/.../name.pdf
    const base = path.basename(abs);
    const stat = fs.statSync(abs);
    const parsed = parseName(base);

    if (!parsed){
      errors.push({ file: relFromDocs, reason: "unrecognized filename pattern" });
      continue;
    }

    const entry = {
      file_name: base,
      url: toUrl(relFromDocs),
      product: parsed.product,
      is_cap: !!parsed.is_cap,
      lot: parsed.lot,
      legacy_key: parsed.legacy_key || "",
      mtime: new Date(stat.mtimeMs).toISOString(),
      size: bytes(stat.size),
      sha256: sha256FileSync(abs),
    };
    items.push(entry);
  }

  // Sort by time desc
  items.sort((a,b)=> (b.mtime||"").localeCompare(a.mtime||""));

  // shard by year
  const shards = [];
  const byYear = groupByYear(items);
  for (const [year, arr] of [...byYear.entries()].sort((a,b)=>a[0]-b[0])){
    const shardPath = `manifest-${year}.json`;
    fs.writeFileSync(path.join(OUT_DIR, shardPath), prettyJSON({ items: arr }), "utf8");
    shards.push({ year, path: shardPath, items: arr.length, etag: sha256(Array.from(arr).map(it=>it.sha256).join(",")) });
  }

  const index = {
    version: new Date().toISOString(),
    total: items.length,
    shards
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), prettyJSON(index), "utf8");
  fs.writeFileSync(ERROR_FILE, prettyJSON({ errors }), "utf8");

  return { total: items.length, errors: errors.length, shards: shards.length };
}

// Simple checksum for a string (used for shards etag)
function sha256(s){
  return crypto.createHash("sha256").update(s).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`){
  const r = build();
  console.log(`[manifest] items=${r.total} shards=${r.shards} errors=${r.errors}`);
}
