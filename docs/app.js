// CoA Search front-end loader
const state = { items: [], loaded: false };

const $ = (sel) => document.querySelector(sel);
const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return "";
  const u = ["B","KB","MB","GB"]; let i=0;
  while (n>=1024 && i<u.length-1){ n/=1024; i++; }
  return n.toFixed(i?1:0) + " " + u[i];
};
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso || ""; }
};

function normalize(s){
  return (s||"")
    .replace(/[\u3000\s]+/g, " ")    // collapse spaces (incl. full-width)
    .trim()
    .toLowerCase();
}
function normKey(s){
  return (s||"").toLowerCase().replace(/[_\s]+/g,"-");
}
function isLegacy(q){
  return /^\d{6}[-_\s]?\d{6}$/.test(q);
}

async function loadManifest(){
  if (state.loaded) return;
  $("#status").textContent = "載入清單…";
  const idx = await fetch("manifest/manifest.json", { cache: "no-cache" }).then(r=>r.json());
  const items = [];
  for (const s of idx.shards){
    const shard = await fetch(`manifest/${s.path}`, { cache: "no-cache" }).then(r=>r.json());
    for (const it of shard.items){
      items.push(it);
    }
  }
  // Newer first
  items.sort((a,b)=> (b.mtime||"").localeCompare(a.mtime||""));
  state.items = items;
  state.loaded = true;
  $("#status").textContent = `已載入 ${items.length} 筆`;
}

function matchItem(item, query, productFilter){
  const q = normalize(query);
  const pf = normalize(productFilter||"");
  if (pf && normalize(item.product) !== pf) return false;

  if (!q) return true;
  // legacy exact/loose
  if (isLegacy(q)){
    const k = normKey(item.legacy_key||"");
    const qq = q.replace(/[_\s]+/g, "-");
    return k === qq;
  }
  // lot substring match (>=4 chars)
  if (/^[a-z0-9-]+$/.test(q)){
    if ((item.lot||"").toLowerCase().includes(q)) return true;
  }
  // file-name substring
  if ((item.file_name||"").toLowerCase().includes(q)) return true;
  return false;
}

function render(items){
  const tbody = $("#results tbody");
  tbody.innerHTML = "";
  for (const it of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="${it.url}" target="_blank" rel="noopener">${it.file_name}</a></td>
      <td>${it.product||""}</td>
      <td>${it.is_cap ? '<span class="tag cap">蓋</span>' : '<span class="tag tube">管</span>'}</td>
      <td>${it.lot||""}</td>
      <td class="muted">${it.legacy_key||""}</td>
      <td class="muted">${fmtDate(it.mtime)}</td>
      <td class="muted">${fmtBytes(it.size)}</td>
    `;
    tbody.appendChild(tr);
  }
  $("#status").textContent = `顯示 ${items.length} 筆`;
}

async function doSearch(){
  await loadManifest();
  const q = $("#q").value;
  const pf = $("#product").value;
  // Sort: new-style first for same lot (is_cap false->true), then mtime desc
  const filtered = state.items
    .filter(it => matchItem(it, q, pf))
    .sort((a,b)=>{
      if ((a.lot||"") === (b.lot||"")){
        if (a.is_cap !== b.is_cap) return a.is_cap ? 1 : -1; // 管在前，蓋在後
      }
      return (b.mtime||"").localeCompare(a.mtime||"");
    });
  render(filtered);
}

document.addEventListener("DOMContentLoaded", () => {
  $("#search").addEventListener("click", doSearch);
  $("#q").addEventListener("keydown", e => { if (e.key==="Enter") doSearch(); });
  // initial render (empty query shows all)
  doSearch();
});
