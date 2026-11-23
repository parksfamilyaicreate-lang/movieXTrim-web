"use strict";

// ブラウザだけで動く movieXTrim 簡易版（Python / サーバー不要）
const $ = (sel) => document.querySelector(sel);
const state = {
  file: null, name: "", ext: ".mp4", duration: 0,
  cuts: [], segments: [], segStart: null, segEnd: null, results: [],
};
let ffmpeg = null;
let ffmpegReady = false;
let busy = false;

function fmt(t) {
  if (t == null || !isFinite(t)) return "--:--";
  const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}
function fmtSize(b) {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + " GB";
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}
function notify(msg, type = "info") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast toast-" + type;
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => { el.className = "toast toast-hidden"; }, 6000);
}
function setProgress(pct, text) {
  $("#progress-card").hidden = false;
  $("#progress-bar").style.width = Math.max(0, Math.min(100, pct)) + "%";
  $("#job-status").textContent = text || t("progress.processing");
}
function lock(locked) {
  busy = locked;
  document.querySelectorAll("button, input, select").forEach((el) => { el.disabled = locked; });
  if (!locked) {
    if (!state.cuts.length) $("#cut-select").disabled = true;
    $("#btn-goto-cut").disabled = true;
  }
}

// ------------------------------------------------------------ ffmpeg.wasm の準備
async function ensureFFmpeg() {
  if (ffmpegReady) return ffmpeg;
  setProgress(2, t("web.core.loading"));
  const { FFmpeg } = window.FFmpegWASM;
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => { $("#job-message").textContent = message.slice(-160); });
  ffmpeg.on("progress", ({ progress }) => {
    if (isFinite(progress)) setProgress(Math.round(progress * 100), t("web.processing", { pct: Math.round(progress * 100) }));
  });
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  const toBlobURL = async (url, type) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error("ffmpeg core download failed: " + res.status);
    return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
  };
  await ffmpeg.load({
    coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
    wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm"),
  });
  ffmpegReady = true;
  setProgress(100, t("web.core.ready"));
  $("#job-message").textContent = "";
  return ffmpeg;
}

// ------------------------------------------------------------ ファイルを開く
$("#file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    lock(true);
    state.file = file;
    state.name = file.name;
    state.ext = (file.name.match(/\.[^.]+$/) || [".mp4"])[0].toLowerCase();
    state.cuts = [];
    state.segments = [];
    state.segStart = state.segEnd = null;
    state.results = [];
    $("#open-file-name").textContent = `${file.name} (${fmtSize(file.size)})`;
    const video = $("#video");
    video.src = URL.createObjectURL(file);
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error("video load failed"));
    });
    state.duration = video.duration;
    $("#total-time").textContent = fmt(state.duration);
    $("#video-card").hidden = false;
    $("#auto-card").hidden = false;
    $("#manual-card").hidden = false;
    renderCuts();
    renderSegments();
    renderResults();
    notify(t("web.core.ready"));
  } catch (err) {
    notify(t("web.error", { msg: err.message }), "error");
  } finally {
    lock(false);
  }
});

// ------------------------------------------------------------ タブ
document.querySelectorAll(".page-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".page").forEach((p) => { p.hidden = p.id !== tab.dataset.page; });
    document.querySelectorAll(".page-tab").forEach((x) => x.classList.toggle("active", x === tab));
  });
});

// ------------------------------------------------------------ シーンチェンジ検出（JS のみ）
async function detectScenes() {
  if (!state.file) return alert(t("alert.open_video_first"));
  if (busy) return alert(t("web.busy"));
  lock(true);
  $("#scene-cuts").textContent = t("web.scene.detecting");
  try {
    const v = document.createElement("video");
    v.src = $("#video").src;
    v.muted = true;
    v.preload = "auto";
    await new Promise((res) => { v.onloadeddata = res; });
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 18;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const step = Math.max(0.25, state.duration / 240);
    const threshold = parseFloat($("#threshold").value);
    const level = (1 - threshold) * 42 + 6;
    const cuts = [];
    let prev = null;
    for (let time = 0; time < state.duration; time += step) {
      v.currentTime = time;
      await new Promise((res) => { v.onseeked = res; });
      ctx.drawImage(v, 0, 0, 32, 18);
      const px = ctx.getImageData(0, 0, 32, 18).data;
      const gray = new Uint8Array(32 * 18);
      for (let i = 0; i < gray.length; i++) {
        gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
      }
      if (prev) {
        let diff = 0;
        for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - prev[i]);
        if (diff / gray.length > level) cuts.push(Math.round(time * 100) / 100);
      }
      prev = gray;
      if (Math.round(time / step) % 8 === 0) $("#scene-cuts").textContent = t("web.scene.detecting") + ` ${Math.round(time / state.duration * 100)}%`;
    }
    v.removeAttribute("src");
    state.cuts = cuts;
    renderCuts();
    $("#scene-cuts").textContent = cuts.length ? `${cuts.length} points` : t("web.no_cuts");
  } catch (err) {
    notify(t("web.error", { msg: err.message }), "error");
  } finally {
    lock(false);
  }
}

function boundariesFromCuts() {
  const min = parseFloat($("#min-dur").value) || 0;
  const max = parseFloat($("#max-dur").value) || null;
  const points = [0];
  for (const c of state.cuts) {
    if (c - points[points.length - 1] >= min && state.duration - c >= min) points.push(c);
  }
  points.push(state.duration);
  if (max && max > 0) {
    const out = [points[0]];
    for (const end of points.slice(1)) {
      const start = out[out.length - 1], len = end - start;
      if (len > max) {
        const k = Math.ceil(len / max);
        for (let i = 1; i < k; i++) out.push(Math.round((start + i * len / k) * 1000) / 1000);
      }
      out.push(end);
    }
    return out;
  }
  return points;
}

function renderCuts() {
  const sel = $("#cut-select");
  sel.innerHTML = "";
  if (!state.cuts.length) {
    sel.innerHTML = `<option value="">${t("web.no_cuts")}</option>`;
    sel.disabled = true;
    $("#btn-goto-cut").disabled = true;
    return;
  }
  state.cuts.forEach((time, i) => {
    const opt = document.createElement("option");
    opt.value = time;
    opt.textContent = t("web.cut.item", { i: i + 1, t: fmt(time) });
    sel.appendChild(opt);
  });
  sel.disabled = false;
  $("#btn-goto-cut").disabled = false;
}

// ------------------------------------------------------------ 区間指定
function updatePending() {
  $("#pending-info").textContent = state.segStart != null && state.segEnd != null
    ? `${fmt(state.segStart)} ~ ${fmt(state.segEnd)}`
    : t("pending.hint");
}
function markIn() { state.segStart = $("#video").currentTime; updatePending(); }
function markOut() { state.segEnd = $("#video").currentTime; updatePending(); }
function addSegment() {
  let s = state.segStart, e = state.segEnd;
  if (s == null || e == null) return alert(t("alert.set_in_out_first"));
  if (s > e) [s, e] = [e, s];
  if (e - s < 0.1) return alert(t("alert.seg_too_short"));
  state.segments.push([s, e]);
  state.segments.sort((a, b) => a[0] - b[0]);
  state.segStart = state.segEnd = null;
  renderSegments();
  updatePending();
}
function renderSegments() {
  const ul = $("#seg-list");
  ul.innerHTML = "";
  state.segments.forEach(([s, e], i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i + 1}.</span> <span>${fmt(s)} ~ ${fmt(e)}</span> <span class="dur">(${fmt(e - s)})</span>`;
    const del = document.createElement("button");
    del.textContent = t("seg.delete");
    del.onclick = () => { state.segments.splice(i, 1); renderSegments(); };
    li.appendChild(del);
    ul.appendChild(li);
  });
}

// ------------------------------------------------------------ ffmpeg で書き出し
async function processSegments(mode, segments) {
  if (!state.file || !segments.length) return;
  await ensureFFmpeg();
  lock(true);
  const input = "input" + state.ext;
  try {
    setProgress(3, t("web.processing", { pct: 3 }));
    await ffmpeg.writeFile(input, new Uint8Array(await state.file.arrayBuffer()));
    const made = [];
    if (mode === "extract") {
      for (let i = 0; i < segments.length; i++) {
        const [s, e] = segments[i];
        const out = `part_${String(i + 1).padStart(2, "0")}.mp4`;
        await ffmpeg.exec([
          "-y", "-ss", s.toFixed(3), "-i", input, "-t", Math.max(0.1, e - s).toFixed(3),
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out,
        ]);
        made.push({ name: `${state.name.replace(/\.[^.]+$/, "")}_seg${String(i + 1).padStart(2, "0")}.mp4`, data: await ffmpeg.readFile(out) });
        await ffmpeg.deleteFile(out);
      }
    } else {
      const cond = segments.map(([s, e]) => `between(t\\,${s.toFixed(3)}\\,${e.toFixed(3)})`).join("+");
      const sel = mode === "delete" ? `not(${cond})` : cond;
      const out = "edited.mp4";
      await ffmpeg.exec([
        "-y", "-i", input,
        "-vf", `select='${sel}',setpts=N/FRAME_RATE/TB`,
        "-af", `aselect='${sel}',asetpts=N/SR/TB`,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out,
      ]);
      made.push({ name: `${state.name.replace(/\.[^.]+$/, "")}_edited.mp4`, data: await ffmpeg.readFile(out) });
    }
    await ffmpeg.deleteFile(input).catch(() => {});
    state.results = made;
    renderResults();
    setProgress(100, t("web.done"));
    notify(t("web.done"), "success");
  } catch (err) {
    notify(t("web.error", { msg: err.message }), "error");
  } finally {
    lock(false);
  }
}

function renderResults() {
  const card = $("#result-card"), ul = $("#result-list");
  ul.innerHTML = "";
  if (!state.results.length) { card.hidden = true; return; }
  state.results.forEach((r) => {
    const blob = new Blob([r.data], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = r.name;
    const size = document.createElement("span");
    size.className = "size";
    size.textContent = fmtSize(blob.size);
    const dl = document.createElement("a");
    dl.href = url; dl.download = r.name; dl.className = "primary";
    dl.textContent = t("web.result.download");
    const pv = document.createElement("button");
    pv.textContent = t("web.result.preview");
    pv.onclick = () => { $("#preview-video").src = url; $("#preview-overlay").hidden = false; $("#preview-video").play().catch(() => {}); };
    li.append(name, size, dl, pv);
    ul.appendChild(li);
  });
  card.hidden = false;
}

// ------------------------------------------------------------ イベント
$("#threshold").addEventListener("input", () => { $("#th-val").textContent = parseFloat($("#threshold").value).toFixed(2); });
$("#btn-scenes").onclick = detectScenes;
$("#btn-goto-cut").onclick = () => {
  const v = parseFloat($("#cut-select").value);
  if (isFinite(v)) { $("#video").currentTime = Math.min(v, state.duration - 0.05); $("#video").pause(); }
};
$("#btn-run-split").onclick = () => {
  const points = boundariesFromCuts();
  const segs = points.slice(0, -1).map((s, i) => [s, points[i + 1]]);
  if (segs.length < 2) return alert(t("web.no_cuts"));
  processSegments("extract", segs);
};
$("#btn-mark-in").onclick = markIn;
$("#btn-mark-out").onclick = markOut;
$("#btn-add-seg").onclick = addSegment;
$("#btn-run-edit").onclick = () => {
  const mode = document.querySelector('input[name="web-mode"]:checked').value;
  processSegments(mode, state.segments);
};
$("#btn-back-10").onclick = () => { $("#video").currentTime = Math.max(0, $("#video").currentTime - 10); };
$("#btn-fwd-10").onclick = () => { $("#video").currentTime = Math.min(state.duration, $("#video").currentTime + 10); };
$("#btn-preview-close").onclick = () => { $("#preview-video").pause(); $("#preview-overlay").hidden = true; };
$("#preview-overlay").onclick = (e) => { if (e.target.id === "preview-overlay") $("#btn-preview-close").click(); };

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || !$("#video").src) return;
  if (e.key === "i" || e.key === "I") markIn();
  if (e.key === "o" || e.key === "O") markOut();
  if (e.key === "Escape") $("#btn-preview-close").click();
});
document.addEventListener("mxt:langchange", () => {
  renderCuts(); renderSegments(); renderResults(); updatePending();
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  applyTranslations();
});
