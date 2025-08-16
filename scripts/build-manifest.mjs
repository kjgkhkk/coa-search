import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs", "manifest");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const ERRORS = path.join(OUT_DIR, "manifest-errors.json");

const { GDRIVE_SERVICE_ACCOUNT, FOLDER_ID } = process.env;
if (!GDRIVE_SERVICE_ACCOUNT || !FOLDER_ID) {
  console.error("Missing env GDRIVE_SERVICE_ACCOUNT or FOLDER_ID"); process.exit(1);
}
const sa = JSON.parse(GDRIVE_SERVICE_ACCOUNT);
const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
const drive = google.drive({ version: "v3", auth });

const NEW_CAP_RE  = /^MB-([^/\\]+?)CAP-?Lot-(\d{5,})/i;
const NEW_TUBE_RE = /^MB-([^/\\]+?)-Lot-(\d{5,})/i;
const LEGACY_RE   = /(^|[^0-9])(\d{6})[-_](\d{6})([^0-9]|$)/;

function parseName(base){
  let m;
  if ((m=base.match(NEW_CAP_RE)))  return { product:`MB-${m[1]}`, lot:m[2], is_cap:true };
  if ((m=base.match(NEW_TUBE_RE))) return { product:`MB-${m[1]}`, lot:m[2], is_cap:false };
  if ((m=base.replace(/\.pdf$/i,"").match(LEGACY_RE))) return { product:"", lot:"", is_cap:null, legacy_key:`${m[2]}-${m[3]}` };
  return { product:"", lot:"", is_cap:null };
}

async function listChildren(pid, pageToken=""){
  const res = await drive.files.list({
    q: `'${pid}' in parents and trashed=false`,
    fields: "nextPageToken, files(id,name,mimeType,modifiedTime,size)",
    pageSize: 1000,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageToken,
  });
  return res.data;
}

async function walk(root){
  const files=[]; const errs=[]; const q=[root];
  while(q.length){
    const id=q.shift();
    let token=""; do{
      const d = await listChildren(id, token);
      for (const f of d.files||[]){
        if (f.mimeType==="application/vnd.google-apps.folder"){ q.push(f.id); continue; }
        if (f.mimeType!=="application/pdf") continue;
        const info = parseName(f.name);
        files.push({
          id:f.id, name:f.name,
          url:`https://drive.google.com/uc?id=${f.id}&export=download`,
          modifiedTime:f.modifiedTime||"", size:f.size?Number(f.size):null,
          product:info.product||"", lot:info.lot||"", is_cap:info.is_cap, legacy_key:info.legacy_key||""
        });
        if (!info.product && !info.legacy_key) errs.push({ id:f.id, name:f.name });
      }
      token = d.nextPageToken || "";
    }while(token);
  }
  return { files, errs };
}

(async ()=>{
  fs.mkdirSync(OUT_DIR, { recursive:true });
  const { files, errs } = await walk(FOLDER_ID);
  files.sort((a,b)=>(b.modifiedTime||"").localeCompare(a.modifiedTime||""));
  fs.writeFileSync(MANIFEST, JSON.stringify({ generated_at:new Date().toISOString(), files }, null, 2));
  fs.writeFileSync(ERRORS, JSON.stringify(errs, null, 2));
  console.log(`Wrote ${files.length} → ${MANIFEST}`);
})();