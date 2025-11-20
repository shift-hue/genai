/* app.js - separated JS */
/* Assumes the backend exposes:
   GET  /taxonomy            -> returns taxonomy JSON (categories array)
   POST /predict            -> form field 'transaction'
   POST /predict_batch      -> form file named 'file'
   POST /upload_taxonomy    -> form file named 'file'
   POST /rebuild_index
   POST /correct           -> form fields 'transaction' and 'correct_label'
   Optional: POST /add_to_index
*/

const base = ""; // same origin

// DOM nodes (safe to get immediately; script has defer)
const txnInput = document.getElementById("txnInput");
const predictBtn = document.getElementById("predictBtn");
const singleArea = document.getElementById("singleResultArea");
const predCategory = document.getElementById("predCategory");
const predConfidence = document.getElementById("predConfidence");
const neighborsList = document.getElementById("neighborsList");
const rawJson = document.getElementById("rawJson");
const rationaleText = document.getElementById("rationaleText");
const csvFile = document.getElementById("csvFile");
const csvPreview = document.getElementById("csvPreview");
const predictCsvBtn = document.getElementById("predictCsvBtn");
const batchResult = document.getElementById("batchResult");
const clearCsvBtn = document.getElementById("clearCsvBtn");
const corrTxn = document.getElementById("corr_txn");
const corrLabel = document.getElementById("corr_label");
const submitCorr = document.getElementById("submitCorr");
const uploadTax = document.getElementById("uploadTax");
const taxfile = document.getElementById("taxfile");
const rebuildBtn = document.getElementById("rebuildBtn");
const statusLog = document.getElementById("statusLog");
const autoAdd = document.getElementById("autoAdd");
const modelNameEl = document.getElementById("modelName");
const indexCountEl = document.getElementById("indexCount");
const copyJsonBtn = document.getElementById("copyJson");
const downloadJsonBtn = document.getElementById("downloadJson");
const themeToggle = document.getElementById("themeToggle");
const themeLabel = document.getElementById("themeLabel") || document.querySelector(".theme-label");

// theme keys
const THEME_KEY = "txcat_theme"; // 'dark' or 'light'

// misc state
let lastPrediction = null;
let taxonomy = {};

/* ---------------- THEME LOGIC (fixed) ---------------- */
function applyTheme(theme){
  // remove both classes first
  document.body.classList.remove("theme-dark");
  document.body.classList.remove("theme-light");
  if(theme === "dark"){
    document.body.classList.add("theme-dark");
    themeToggle.setAttribute("aria-pressed", "true");
    // update label text/icon
    const lblSpan = themeToggle.querySelector(".theme-label") || document.getElementById("themeLabel");
    if(lblSpan) lblSpan.textContent = "Dark";
  } else {
    document.body.classList.add("theme-light");
    themeToggle.setAttribute("aria-pressed", "false");
    const lblSpan = themeToggle.querySelector(".theme-label") || document.getElementById("themeLabel");
    if(lblSpan) lblSpan.textContent = "Light";
  }
  try{ localStorage.setItem(THEME_KEY, theme); } catch(e){}
}

// determine preferred theme (saved -> system -> default light)
function initTheme(){
  try{
    const saved = localStorage.getItem(THEME_KEY);
    if(saved === "dark" || saved === "light"){
      applyTheme(saved);
      return;
    }
    // fallback to system preference
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? "dark" : "light");
  }catch(e){
    applyTheme("light");
  }
}

// attach toggle
themeToggle.addEventListener("click", () => {
  const active = document.body.classList.contains("theme-dark") ? "dark" : "light";
  applyTheme(active === "dark" ? "light" : "dark");
});

/* ----------------- UTILITIES ----------------- */
function showStatus(msg){
  if(statusLog) statusLog.innerText = msg;
}
function prettyJSON(obj){
  try{ return JSON.stringify(obj, null, 2); } catch(e){ return String(obj); }
}
function copyToClipboard(text){
  return navigator.clipboard ? navigator.clipboard.writeText(text) : (function(){ const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return Promise.resolve(); })();
}
function downloadText(filename, text){
  const a = document.createElement('a');
  const blob = new Blob([text], {type: 'application/json'});
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ----------------- TAXONOMY LOAD ----------------- */
async function loadTaxonomy(){
  try{
    const res = await fetch(base + "/taxonomy");
    if(!res.ok) throw new Error("Failed to fetch taxonomy");
    const j = await res.json();
    taxonomy = j || {};
    const cats = taxonomy.categories || [];
    // populate select
    corrLabel.innerHTML = "";
    cats.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.innerText = `${c.id} — ${c.name}`;
      corrLabel.appendChild(opt);
    });
    // model and index info if present
    if(taxonomy.model) modelNameEl.innerText = taxonomy.model;
    if(taxonomy.index_count !== undefined) indexCountEl.innerText = `Index: ${taxonomy.index_count}`;
  }catch(err){
    console.warn("taxonomy load err", err);
    corrLabel.innerHTML = "<option>load failed</option>";
    modelNameEl.innerText = "unknown";
    indexCountEl.innerText = "Index: n/a";
  }
}

/* ------------- NEIGHBOR CARD RENDER -------------- */
function neighborCard(meta, similarity){
  const wrapper = document.createElement("div");
  wrapper.className = "neigh";
  // left
  const left = document.createElement("div");
  left.className = "left";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = meta.text || meta.transaction || meta.description || meta;
  const label = document.createElement("div");
  label.className = "small muted";
  label.textContent = meta.label || meta.category || "";
  left.appendChild(title);
  left.appendChild(label);
  // right
  const simWrap = document.createElement("div");
  simWrap.style.display = "flex";
  simWrap.style.alignItems = "center";
  simWrap.style.gap = "8px";
  const pct = Math.round(Number(similarity || 0) * 100);
  const bar = document.createElement("div");
  bar.className = "simbar";
  const inner = document.createElement("i");
  inner.style.width = Math.max(2, pct) + "%";
  bar.appendChild(inner);
  const score = document.createElement("div");
  score.style.fontWeight = "700";
  score.textContent = pct + "%";
  simWrap.appendChild(bar);
  simWrap.appendChild(score);

  wrapper.appendChild(left);
  wrapper.appendChild(simWrap);
  return wrapper;
}

/* ------------------ PREDICT SINGLE ------------------ */
predictBtn.addEventListener("click", doPredict);
txnInput.addEventListener("keydown", (e) => {
  if((e.ctrlKey || e.metaKey) && e.key === "Enter") doPredict(e);
});

async function doPredict(e){
  e && e.preventDefault();
  const tx = txnInput.value.trim();
  if(!tx){ alert("Enter a transaction string"); return; }
  predictBtn.disabled = true;
  showStatus("Predicting...");
  singleArea.classList.add("card-hidden");
  try{
    const fd = new FormData();
    fd.append("transaction", tx);
    const res = await fetch(base + "/predict", { method: "POST", body: fd });
    if(!res.ok) throw new Error("server " + res.status);
    const j = await res.json();
    lastPrediction = { transaction: tx, response: j };
    corrTxn.value = tx;
    // display
    singleArea.classList.remove("card-hidden");
    predCategory.textContent = (j.category || "unknown").toUpperCase();
    predConfidence.textContent = `Confidence: ${(Number(j.confidence||0)*100).toFixed(1)}%`;
    // neighbors
    neighborsList.innerHTML = "";
    if(Array.isArray(j.explanations) && j.explanations.length){
      j.explanations.forEach(ex => {
        const meta = ex.transaction || ex.meta || ex;
        const sim = ex.similarity || ex.sim || 0;
        neighborsList.appendChild(neighborCard(meta, sim));
      });
    } else {
      neighborsList.innerHTML = "<div class='muted small'>No neighbors</div>";
    }
    // rationale & raw json
    rationaleText.textContent = j.rationale || (j.keyword_matches ? "Keyword matches: " + (j.keyword_matches.join(", ")) : "Nearest neighbor rationale");
    rawJson.textContent = prettyJSON(j);
  }catch(err){
    console.error(err);
    showStatus("Prediction failed: " + err.message);
  } finally {
    predictBtn.disabled = false;
    showStatus("Ready");
  }
}

/* --------------- CSV BATCH HANDLING --------------- */
csvFile.addEventListener("change", async () => {
  const f = csvFile.files[0];
  if(!f){ csvPreview.textContent = "No file selected"; return; }
  const txt = await f.text();
  const lines = txt.split(/\r?\n/).slice(0, 8).filter(Boolean);
  // render table preview if has header
  if(lines.length){
    const rows = lines.map(l => l.split(","));
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "13px";
    table.style.marginTop = "8px";
    // header
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    rows[0].forEach(cell => { const th = document.createElement("th"); th.style.textAlign = "left"; th.style.padding = "6px"; th.style.borderBottom = "1px solid var(--control-border)"; th.textContent = cell; htr.appendChild(th); });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.slice(1).forEach(r => {
      const tr = document.createElement("tr");
      r.forEach(cell => { const td = document.createElement("td"); td.style.padding = "6px"; td.textContent = cell; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    csvPreview.innerHTML = "";
    csvPreview.appendChild(table);
  } else {
    csvPreview.textContent = "Empty or no preview available";
  }
});

clearCsvBtn.addEventListener("click", () => {
  csvFile.value = "";
  csvPreview.textContent = "No file selected";
  batchResult.classList.add("hidden");
  batchResult.textContent = "";
});

predictCsvBtn.addEventListener("click", async () => {
  const f = csvFile.files[0];
  if(!f){ alert("Choose a CSV file first"); return; }
  predictCsvBtn.disabled = true;
  showStatus("Predicting CSV...");
  try{
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(base + "/predict_batch", { method: "POST", body: fd });
    if(!res.ok) throw new Error("server " + res.status);
    const j = await res.json();
    batchResult.classList.remove("hidden");
    batchResult.textContent = prettyJSON(j);
    showStatus("CSV predictions done");
  }catch(err){
    console.error(err);
    showStatus("CSV prediction failed: " + err.message);
  } finally {
    predictCsvBtn.disabled = false;
  }
});

/* ---------------- taxonomy upload & rebuild ---------------- */
uploadTax.addEventListener("click", async () => {
  const f = taxfile.files[0];
  if(!f){ alert("Choose taxonomy.json"); return; }
  uploadTax.disabled = true;
  showStatus("Uploading taxonomy...");
  try{
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(base + "/upload_taxonomy", { method: "POST", body: fd });
    if(!res.ok) throw new Error("server " + res.status);
    const j = await res.json();
    showStatus("Uploaded taxonomy");
    await loadTaxonomy();
  }catch(err){
    console.error(err);
    showStatus("Upload failed: " + err.message);
  } finally {
    uploadTax.disabled = false;
  }
});

rebuildBtn.addEventListener("click", async () => {
  if(!confirm("Rebuild index from data/transactions.csv?")) return;
  rebuildBtn.disabled = true;
  showStatus("Rebuilding index...");
  try{
    const res = await fetch(base + "/rebuild_index", { method: "POST" });
    if(!res.ok) throw new Error("server " + res.status);
    const j = await res.json();
    showStatus("Index rebuilt");
    // reload taxonomy/status
    await loadTaxonomy();
  }catch(err){
    console.error(err);
    showStatus("Index rebuild failed: " + err.message);
  } finally {
    rebuildBtn.disabled = false;
  }
});

/* ---------------- corrections ---------------- */
submitCorr.addEventListener("click", async () => {
  const tx = corrTxn.value.trim();
  const lbl = corrLabel.value;
  if(!tx || !lbl){ alert("Provide transaction and label"); return; }
  submitCorr.disabled = true;
  showStatus("Submitting correction...");
  try{
    const fd = new FormData();
    fd.append("transaction", tx);
    fd.append("correct_label", lbl);
    const res = await fetch(base + "/correct", { method: "POST", body: fd });
    if(!res.ok) throw new Error("server " + res.status);
    const j = await res.json();
    showStatus("Correction saved");
    document.getElementById("corrStatus").textContent = prettyJSON(j);
  }catch(err){
    console.error(err);
    showStatus("Correction failed: " + err.message);
  } finally {
    submitCorr.disabled = false;
  }
});

autoAdd.addEventListener("click", async () => {
  if(!lastPrediction){ alert("Run a prediction first"); return; }
  if(!confirm("Save the last prediction as correction and try to add to index (if backend supports /add_to_index)?")) return;
  const fd = new FormData();
  fd.append("transaction", lastPrediction.transaction);
  fd.append("correct_label", lastPrediction.response.category || corrLabel.value);
  try{
    await fetch(base + "/correct", { method: "POST", body: fd });
    // optional: call /add_to_index
    try{
      const r = await fetch(base + "/add_to_index", { method: "POST", body: fd });
      if(r.ok) showStatus("Added to index");
      else showStatus("Saved correction; add_to_index not supported");
    }catch(e){ showStatus("Saved correction; add_to_index not available"); }
  }catch(e){ showStatus("Failed to save correction"); }
});

/* ---------------- raw json copy/download ---------------- */
if(copyJsonBtn) copyJsonBtn.addEventListener("click", async () => {
  await copyToClipboard(rawJson.textContent || "");
  showStatus("JSON copied to clipboard");
});
if(downloadJsonBtn) downloadJsonBtn.addEventListener("click", () => {
  downloadText("prediction.json", rawJson.textContent || "{}");
});

/* ----------------- init ------------------ */
window.addEventListener("load", async () => {
  initTheme(); // start theme before load for flicker-free
  await loadTaxonomy();
  showStatus("Ready");
});
