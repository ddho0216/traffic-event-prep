"use strict";
/* 백본 트래픽 관제 · 이벤트 대비 (전부 가상 데이터) */

/* ---------- 공통 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, "0");
function parseT(s) {
  const [d, t] = s.split("T"); const [y, m, da] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number);
  return Date.UTC(y, m - 1, da, h, mi);
}
const T0 = parseT(DATA.start), STEP = DATA.stepMin * 60000, N = DATA.n, PER_DAY = 288;
const LINKS = DATA.links, LINK = Object.fromEntries(LINKS.map(l => [l.id, l]));
const idxOf = ms => Math.round((ms - T0) / STEP), msOf = i => T0 + i * STEP;
const ymdhm = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const md = ms => ymdhm(ms).slice(5).replace("-", "/");
const hm = ms => ymdhm(ms).slice(11);
const ymd = ms => ymdhm(ms).slice(0, 10);
const isoLocal = ms => ymdhm(ms).replace(" ", "T");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가여도 화면은 동작 */ } }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function downloadCsv(name, text) { download(name, new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" })); }

/* zip (압축 없이 묶기만 하는 최소 구현) */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), chunks = [], cd = []; let off = 0;
  const now = new Date();
  const dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const f of files) {
    const nm = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdSize = cd.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...cd, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/* ---------- 가상 고객사·센터 ---------- */
const CUSTOMERS = [
  { name: "가상물산", links: ["OUR-A", "OUR-B"] },
  { name: "예시미디어", links: ["OUR-A", "CTR-B1", "IX-1"] },
  { name: "샘플게임즈", links: ["CTR-C1", "CTR-D1"] }
];
const CENTER = id => id.startsWith("OUR") ? "우리 센터" : id.startsWith("CTR-B") ? "센터B" : id === "CTR-C1" ? "센터C" : id === "CTR-D1" ? "센터D" : "연동";

/* ---------- 경고 탐지 (관제 화면 아래 표) ---------- */
function runs(flags) {
  const out = []; let s = -1;
  flags.forEach((f, i) => { if (f && s < 0) s = i; if (!f && s >= 0) { out.push([s, i - 1]); s = -1; } });
  if (s >= 0) out.push([s, flags.length - 1]);
  return out;
}
function median(a) { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
const ALERTS = (() => {
  const res = [];
  for (const l of LINKS) {
    // 1) out 사용률 80% 이상
    runs(l.out.map(v => v >= l.cap * 0.8)).forEach(([s, e]) => {
      let p = s; for (let i = s; i <= e; i++) if (l.out[i] > l.out[p]) p = i;
      res.push({ link: l.id, kind: "사용률 80%+", s, e, peak: p, val: `${(l.out[p] / l.cap * 100).toFixed(0)}% (${l.out[p].toFixed(1)}G)`, sev: "crit" });
    });
    // 2) in이 같은 시간대 평소(14일 중앙값)의 3배 이상 = 급증 의심
    const slotMed = Array.from({ length: PER_DAY }, (_, k) => { const v = []; for (let i = k; i < N; i += PER_DAY) v.push(l.in[i]); return median(v); });
    runs(l.in.map((v, i) => v >= 3 * slotMed[i % PER_DAY])).forEach(([s, e]) => {
      let p = s; for (let i = s; i <= e; i++) if (l.in[i] / slotMed[i % PER_DAY] > l.in[p] / slotMed[p % PER_DAY]) p = i;
      res.push({ link: l.id, kind: "in 급증 의심", s, e, peak: p, val: `평소의 ${(l.in[p] / slotMed[p % PER_DAY]).toFixed(1)}배 (${l.in[p].toFixed(1)}G)`, sev: "warn" });
    });
  }
  const evWin = DATA.events.map(ev => ({ ev, a: idxOf(parseT(ev.start)) - 6, b: idxOf(parseT(ev.end)) + 4 }));
  res.forEach(a => { const hit = evWin.find(w => a.peak >= w.a && a.peak <= w.b); a.evName = hit ? hit.ev.name : ""; });
  return res.sort((a, b) => a.s - b.s);
})();

/* ---------- 탭 ---------- */
function showTab(name) {
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $$("section.tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  if (name === "monitor") { renderAll(); renderTasks(); }
  try { history.replaceState(null, "", "#" + name); } catch (e) { /* 무시 */ }
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });

/* ---------- 1. 관제 ---------- */
const state = { end: idxOf(parseT("2026-10-22T21:00")), win: 12, ymode: "cap", cust: "all" };
const custOf = id => CUSTOMERS.filter(c => c.links.includes(id)).map(c => c.name);

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(x => x >= m) || 10) * p;
}

function buildGrid() {
  $("#grid").innerHTML = LINKS.map(l => `
    <div class="panel" id="p-${l.id}">
      <div class="hd"><b>${custOf(l.id).join(" · ") || "공용 (고객사 없음)"}</b><span class="sp"></span><span class="chip">정상</span><button class="btn sm csv" data-link="${l.id}">CSV</button></div>
      <div class="sub">${l.id} · ${esc(l.desc)} · ${l.cap}G</div>
      <div class="now"></div><div class="svgbox"></div><div class="tip"></div>
    </div>`).join("");
}

function renderPanel(l) {
  const root = $("#p-" + l.id), box = $(".svgbox", root), tip = $(".tip", root);
  const w = Math.max(220, box.clientWidth || root.clientWidth || 340), h = 168;
  const e = clamp(state.end, 0, N - 1), s = Math.max(0, e - state.win + 1);
  const L = 38, R = 8, T = 8, B = 20;
  let mx = 0; for (let i = s; i <= e; i++) mx = Math.max(mx, l.out[i], l.in[i]);
  const ymax = state.ymode === "cap" ? l.cap : niceMax(mx * 1.1);
  const X = i => L + (i - s) / Math.max(1, e - s) * (w - L - R);
  const Y = v => T + (1 - v / ymax) * (h - T - B);
  const path = arr => { let d = ""; for (let i = s; i <= e; i++) d += (i === s ? "M" : "L") + X(i).toFixed(1) + "," + Y(arr[i]).toFixed(1); return d; };
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = ymax * k / 4, y = Y(v);
    g += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="#26323d" stroke-width="1"/><text x="${L - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#7b8a98">${ymax < 10 ? v.toFixed(1) : Math.round(v)}</text>`;
  }
  const cnt = e - s + 1, every = Math.max(1, Math.ceil(cnt / 5));
  for (let i = s; i <= e; i += every) g += `<text x="${X(i)}" y="${h - 5}" text-anchor="middle" font-size="10" fill="#7b8a98">${state.win >= 288 ? md(msOf(i)) : hm(msOf(i))}</text>`;
  DATA.events.forEach(ev => {
    const a = idxOf(parseT(ev.start)), b = idxOf(parseT(ev.end));
    if (b < s || a > e) return;
    const x1 = X(Math.max(a, s)), x2 = X(Math.min(b, e));
    g += `<rect x="${x1}" y="${T}" width="${Math.max(2, x2 - x1)}" height="${h - T - B}" fill="#6ea8d9" opacity=".08"/><text x="${x1 + 3}" y="${T + 10}" font-size="10" fill="#6ea8d9">${esc(ev.name)}</text>`;
    if (a >= s && a <= e) g += `<line x1="${X(a)}" x2="${X(a)}" y1="${T}" y2="${h - B}" stroke="#6ea8d9" stroke-dasharray="3 3"/>`;
    if (b >= s && b <= e) g += `<line x1="${X(b)}" x2="${X(b)}" y1="${T}" y2="${h - B}" stroke="#6ea8d9" stroke-dasharray="3 3"/>`;
    ev.marks.forEach(mk => {
      const ma = a + mk.a / 5, mb = a + mk.b / 5;
      if (mb < s || ma > e) return;
      const m1 = X(Math.max(ma, s)), m2 = X(Math.min(mb, e)), mw = m2 - m1;
      const col = mk.k === "hydration" ? "#9ad1ff" : "#8a98a6", label = mk.k === "hydration" ? "하이드레이션" : "하프타임";
      g += `<rect x="${m1}" y="${T}" width="${Math.max(2, mw)}" height="${h - T - B}" fill="${col}" opacity=".20"/>`;
      if (mw >= 64) g += `<text x="${m1 + mw / 2}" y="${T + 24}" text-anchor="middle" font-size="9.5" fill="${col}">${label}</text>`;
      else if (mw >= 5) g += `<text x="${m1 + mw / 2 + 3}" y="${h - B - 4}" transform="rotate(-90 ${m1 + mw / 2 + 3} ${h - B - 4})" font-size="9" fill="${col}">${label}</text>`;
    });
  });
  const wl = l.cap * 0.8;
  if (wl <= ymax) g += `<line x1="${L}" x2="${w - R}" y1="${Y(wl)}" y2="${Y(wl)}" stroke="#e5604d" stroke-dasharray="4 3" opacity=".8"/><text x="${w - R - 2}" y="${Y(wl) - 3}" text-anchor="end" font-size="10" fill="#e5604d">80%</text>`;
  g += `<path d="${path(l.out)}L${X(e)},${Y(0)}L${X(s)},${Y(0)}Z" fill="#e5a93d" opacity=".12"/>`;
  g += `<path d="${path(l.out)}" fill="none" stroke="#e5a93d" stroke-width="1.8"/><path d="${path(l.in)}" fill="none" stroke="#4db6ac" stroke-width="1.8"/>`;
  if (cnt <= 14) for (let i = s; i <= e; i++) g += `<circle cx="${X(i)}" cy="${Y(l.out[i])}" r="2.4" fill="#e5a93d"/><circle cx="${X(i)}" cy="${Y(l.in[i])}" r="2.4" fill="#4db6ac"/>`;
  g += `<line class="xh" y1="${T}" y2="${h - B}" stroke="#d6dee6" opacity=".45" style="display:none"/><circle class="co" r="4" fill="#e5a93d" style="display:none"/><circle class="ci" r="4" fill="#4db6ac" style="display:none"/>`;
  g += `<rect class="ov" x="${L}" y="${T}" width="${w - L - R}" height="${h - T - B}" fill="transparent"/>`;
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${g}</svg>`;

  const svg = $("svg", box), ov = $(".ov", svg), xh = $(".xh", svg), co = $(".co", svg), ci = $(".ci", svg);
  ov.addEventListener("pointermove", ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (w / r.width);
    const i = clamp(Math.round(s + (px - L) / (w - L - R) * (e - s)), s, e);
    xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.style.display = "";
    co.setAttribute("cx", X(i)); co.setAttribute("cy", Y(l.out[i])); co.style.display = "";
    ci.setAttribute("cx", X(i)); ci.setAttribute("cy", Y(l.in[i])); ci.style.display = "";
    tip.innerHTML = `${ymdhm(msOf(i))}<br><span class="i">IN&nbsp; ${l.in[i].toFixed(2)} G</span><br><span class="o">OUT ${l.out[i].toFixed(2)} G</span> (${(l.out[i] / l.cap * 100).toFixed(0)}%)`;
    tip.style.display = "block";
    const pr = root.getBoundingClientRect();
    let left = ev.clientX - pr.left + 14; if (left + 170 > pr.width) left = ev.clientX - pr.left - 175;
    tip.style.left = left + "px"; tip.style.top = Math.max(30, ev.clientY - pr.top - 20) + "px";
  });
  ov.addEventListener("pointerleave", () => { xh.style.display = co.style.display = ci.style.display = tip.style.display = "none"; });

  let wmax = 0; for (let i = s; i <= e; i++) wmax = Math.max(wmax, l.out[i]);
  const util = l.out[e] / l.cap, wutil = wmax / l.cap, cls = wutil >= 0.8 ? "crit" : wutil >= 0.7 ? "warn" : "";
  root.className = "panel " + cls;
  $(".chip", root).textContent = wutil >= 0.8 ? "경고" : wutil >= 0.7 ? "주의" : "정상";
  $(".now", root).innerHTML = `<span class="o">OUT ${l.out[e].toFixed(1)}G</span><span class="i">IN ${l.in[e].toFixed(1)}G</span><span class="muted">${(util * 100).toFixed(0)}% · 창 최대 out ${wmax.toFixed(1)}G</span>`;
}
function renderAll() {
  if (!$("#tab-monitor").classList.contains("on")) return;
  state.end = clamp(state.end, 0, N - 1);
  $("#endTime").value = isoLocal(msOf(state.end));
  LINKS.forEach(l => {
    const show = state.cust === "all" || (state.cust === "none" ? !custOf(l.id).length : custOf(l.id).includes(state.cust));
    $("#p-" + l.id).style.display = show ? "" : "none";
    if (show) renderPanel(l);
  });
}
function csvOf(ids, s, e) {
  const rows = ["time,link,in_gbps,out_gbps,out_util_pct"];
  for (const id of ids) { const l = LINK[id]; for (let i = s; i <= e; i++) rows.push(`${ymdhm(msOf(i))},${id},${l.in[i]},${l.out[i]},${(l.out[i] / l.cap * 100).toFixed(1)}`); }
  return rows.join("\n");
}
function viewRange() { const e = clamp(state.end, 0, N - 1); return [Math.max(0, e - state.win + 1), e]; }
const fileStamp = ms => ymdhm(ms).replace(/[- :]/g, "").slice(0, 12);

(function initMonitor() {
  buildGrid();
  const et = $("#endTime"); et.min = isoLocal(T0); et.max = isoLocal(msOf(N - 1));
  et.addEventListener("change", () => { if (et.value) { state.end = idxOf(parseT(et.value)); renderAll(); } });
  $("#prev").onclick = () => { state.end -= state.win; renderAll(); };
  $("#next").onclick = () => { state.end += state.win; renderAll(); };
  $("#win").onchange = e => { state.win = +e.target.value; renderAll(); };
  $("#cust").innerHTML = '<option value="all">전체</option>' + CUSTOMERS.map(c => `<option>${c.name}</option>`).join("") + '<option value="none">공용 (고객사 없음)</option>';
  $("#cust").onchange = e => { state.cust = e.target.value; renderAll(); };
  $("#ymode").onchange = e => { state.ymode = e.target.value; renderAll(); };
  $("#jumpEv").innerHTML = '<option value="">월드컵 경기 보기…</option>' + DATA.events.map((ev, i) => `<option value="${i}">${esc(ev.name)} (${md(parseT(ev.start))})</option>`).join("");
  $("#jumpEv").onchange = e => {
    if (e.target.value === "") return;
    const ev = DATA.events[+e.target.value]; state.win = 36; $("#win").value = "36"; state.end = idxOf(parseT(ev.start)) + 25; e.target.value = ""; renderAll();
  };
  $$("[data-jump]").forEach(b => b.onclick = () => { state.end = idxOf(parseT(b.dataset.jump)); renderAll(); });
  $("#csvAll").onclick = () => { const [s, e] = viewRange(); downloadCsv(`traffic_all_${fileStamp(msOf(s))}_${fileStamp(msOf(e))}.csv`, csvOf(LINKS.filter(l => $("#p-" + l.id).style.display !== "none").map(l => l.id), s, e)); };
  $("#grid").addEventListener("click", ev => {
    const b = ev.target.closest(".csv"); if (!b) return;
    const [s, e] = viewRange(); downloadCsv(`traffic_${b.dataset.link}_${fileStamp(msOf(s))}_${fileStamp(msOf(e))}.csv`, csvOf([b.dataset.link], s, e));
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderAll, 120); });

  $("#alertTbl").innerHTML = `<tr><th>시각</th><th>링크</th><th>유형</th><th>최대</th><th>경기 일정과 겹침</th></tr>` + ALERTS.map((a, k) =>
    `<tr class="click" data-k="${k}"><td>${md(msOf(a.s))} ~ ${hm(msOf(a.e))}</td><td>${a.link}</td><td><span class="tag ${a.sev}">${a.kind}</span></td><td>${a.val}</td><td>${a.evName ? `<span class="tag ok">${esc(a.evName)}</span>` : '<span class="tag crit">경기 아님 · 확인 필요</span>'}</td></tr>`).join("");
  $("#alertTbl").addEventListener("click", ev => {
    const tr = ev.target.closest("tr.click"); if (!tr) return;
    state.end = Math.min(N - 1, ALERTS[+tr.dataset.k].peak + 6); renderAll(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

function renderTasks() {
  const sent = CUSTOMERS.filter(c => store.get("sent:" + c.name, false)).length;
  const checks = DATA.events.map(ev => (store.get("chk:" + ev.id, []) || []).length);
  const visits = store.get("visits", []).length;
  const spikes = ALERTS.filter(a => a.kind === "in 급증 의심").length;
  const rows = [
    ["월말 자료 발송", `${sent}/${CUSTOMERS.length} 고객사 완료`, sent === CUSTOMERS.length ? "ok" : "warn", "monthly"],
    ["이벤트 대비", `월드컵 ${checks.filter(c => c === CHECK_ITEMS.length).length}/${DATA.events.length}경기 체크 완료`, "warn", "event"],
    ["방문 신청 등록", `등록 ${visits}건`, "ok", "visit"],
    ["새벽 급증 확인", `in 급증 의심 ${spikes}건 (경고 이력 참고)`, spikes ? "warn" : "ok", "monitor"],
    ["장비 점검 (광값·CRC)", "CRC·광 수신값 이상 회선 있음", "crit", "term"]
  ];
  $("#taskTbl").innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td><span class="tag ${r[2]}">${r[1]}</span></td><td><button class="btn sm" data-go="${r[3]}">열기</button></td></tr>`).join("");
}
$("#taskTbl").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) showTab(b.dataset.go); });

/* ---------- 2. 월간 자료 ---------- */
const MIN_DAY = ymd(T0), MAX_DAY = ymd(msOf(N - 1));
function p95(a) { const b = [...a].sort((x, y) => x - y); return b[Math.floor(0.95 * (b.length - 1))]; }
function statsOf(l, s, e) {
  const r = {};
  for (const dir of ["out", "in"]) {
    const a = l[dir].slice(s, e + 1); let mxi = 0;
    a.forEach((v, i) => { if (v > a[mxi]) mxi = i; });
    r[dir] = { max: a[mxi], at: msOf(s + mxi), min: Math.min(...a), avg: a.reduce((x, y) => x + y, 0) / a.length, p95: p95(a) };
  }
  return r;
}
function mState() {
  const c = CUSTOMERS[$("#mCust").selectedIndex];
  const ids = $$("#mLinks input:checked").map(i => i.value);
  let s = idxOf(parseT($("#mFrom").value + "T00:00")), e = idxOf(parseT($("#mTo").value + "T23:55"));
  s = clamp(s, 0, N - 1); e = clamp(e, s, N - 1);
  return { c, ids, s, e, from: $("#mFrom").value, to: $("#mTo").value };
}
function mSummaryRows(m) {
  const rows = [];
  m.ids.forEach(id => { const st = statsOf(LINK[id], m.s, m.e); ["out", "in"].forEach(d => rows.push({ id, d, ...st[d] })); });
  return rows;
}
function renderMonthly() {
  const m = mState();
  const rows = mSummaryRows(m);
  $("#mSum").innerHTML = `<tr><th>회선</th><th>방향</th><th class="n">최대</th><th>최대 시각</th><th class="n">최소</th><th class="n">평균</th><th class="n">95%값</th></tr>` +
    (rows.length ? rows.map(r => `<tr><td>${r.id}</td><td>${r.d.toUpperCase()}</td><td class="n">${r.max.toFixed(2)}</td><td>${md(r.at)}</td><td class="n">${r.min.toFixed(2)}</td><td class="n">${r.avg.toFixed(2)}</td><td class="n">${r.p95.toFixed(2)}</td></tr>`).join("") : `<tr><td colspan="7" class="muted">회선을 선택하세요.</td></tr>`);
  $("#mMail").value =
`제목: [${m.c.name}] ${m.from} ~ ${m.to} 회선별 5분 단위 트래픽 자료 송부

${m.c.name} 담당자님, 안녕하세요.
요청하신 ${m.from} ~ ${m.to} 회선별 5분 단위 트래픽 자료를 보내드립니다.

- 대상 회선: ${m.ids.join(", ") || "(선택 없음)"}
- 첨부: 회선별 5분 단위 CSV, 요약(최대·최소·평균·95%값)
- 단위: Gbps (IN = 센터로 들어온 트래픽, OUT = 센터에서 나간 트래픽)

추가로 필요한 자료가 있으면 말씀해 주세요.
감사합니다.`;
}
function summaryCsv(m) {
  return ["link,direction,max_gbps,max_time,min_gbps,avg_gbps,p95_gbps"].concat(
    mSummaryRows(m).map(r => `${r.id},${r.d},${r.max.toFixed(2)},${ymdhm(r.at)},${r.min.toFixed(2)},${r.avg.toFixed(2)},${r.p95.toFixed(2)}`)).join("\n");
}
(function initMonthly() {
  $("#mCust").innerHTML = CUSTOMERS.map(c => `<option>${c.name}</option>`).join("");
  ["mFrom", "mTo"].forEach(id => { const el = $("#" + id); el.min = MIN_DAY; el.max = MAX_DAY; });
  $("#mFrom").value = MIN_DAY; $("#mTo").value = MAX_DAY;
  const drawLinks = () => {
    const c = CUSTOMERS[$("#mCust").selectedIndex];
    $("#mLinks").innerHTML = c.links.map(id => `<label class="chk"><input type="checkbox" value="${id}" checked> ${id}</label>`).join("");
    renderMonthly();
  };
  $("#mCust").onchange = drawLinks;
  $("#mFrom").onchange = $("#mTo").onchange = renderMonthly;
  $("#mLinks").addEventListener("change", renderMonthly);
  $("#mZip").onclick = () => {
    const m = mState(); if (!m.ids.length) return;
    const enc = new TextEncoder(), tag = `${m.from}_${m.to}`;
    const files = m.ids.map(id => ({ name: `${m.c.name}_${id}_5min_${tag}.csv`, data: enc.encode("﻿" + csvOf([id], m.s, m.e)) }));
    files.push({ name: `${m.c.name}_요약_${tag}.csv`, data: enc.encode("﻿" + summaryCsv(m)) });
    download(`${m.c.name}_트래픽자료_${tag}.zip`, makeZip(files));
  };
  $("#mSumCsv").onclick = () => { const m = mState(); downloadCsv(`${m.c.name}_요약_${m.from}_${m.to}.csv`, summaryCsv(m)); };
  $("#mCopy").onclick = () => copyText($("#mMail").value, $("#mCopy"));
  $("#sendTbl").innerHTML = CUSTOMERS.map(c => `<tr><td>${c.name}</td><td class="muted">${c.links.join(", ")}</td><td><label class="chk"><input type="checkbox" data-sent="${c.name}" ${store.get("sent:" + c.name, false) ? "checked" : ""}> 발송 완료</label></td></tr>`).join("");
  $("#sendTbl").addEventListener("change", e => { if (e.target.dataset.sent) { store.set("sent:" + e.target.dataset.sent, e.target.checked); renderTasks(); } });
  drawLinks();
})();
function copyText(text, btn) {
  const done = () => { const t = btn.textContent; btn.textContent = "복사됨"; setTimeout(() => btn.textContent = t, 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done); else done();
}

/* ---------- 3. 이벤트 대비 ---------- */
const CHECK_ITEMS = ["고객사 사전 연락 (이쪽으로 보내겠다고 안내)", "분산 작업 사전 점검", "시작 전 그래프 확인", "이벤트 중 30분마다 사용률 확인", "종료 후 원복 확인", "사후 정리 고객사 회신"];
const MOVE_LIMIT = 0.70, WATCH = 0.60, TARGET = 0.60;
function evBaseline(l, ev) {
  const s = idxOf(parseT(ev.start)), e = idxOf(parseT(ev.end)), len = e - s, off = s % PER_DAY;
  const evDays = new Set(DATA.events.flatMap(x => [Math.floor(idxOf(parseT(x.start)) / PER_DAY), Math.floor(idxOf(parseT(x.end)) / PER_DAY)]));
  const vals = [];
  for (let d = 0; d * PER_DAY + off + len < N; d++) {
    if (evDays.has(d)) continue;
    let m = 0; for (let k = 0; k <= len; k++) m = Math.max(m, l.out[d * PER_DAY + off + k]);
    vals.push(m);
  }
  return median(vals);
}
const REF = {};
function refPeak(l) {   // 평소 하루 최대 out의 중앙값 (경기 있는 날 제외)
  if (!REF[l.id]) {
    const evDays = new Set(DATA.events.flatMap(x => [Math.floor(idxOf(parseT(x.start)) / PER_DAY), Math.floor(idxOf(parseT(x.end)) / PER_DAY)]));
    const v = [];
    for (let d = 0; (d + 1) * PER_DAY <= N; d++) { if (evDays.has(d)) continue; let m = 0; for (let k = 0; k < PER_DAY; k++) m = Math.max(m, l.out[d * PER_DAY + k]); v.push(m); }
    REF[l.id] = median(v);
  }
  return REF[l.id];
}
function evCalc(ev) {
  const s = idxOf(parseT(ev.start)), e = idxOf(parseT(ev.end));
  const rows = LINKS.map(l => {
    const base = evBaseline(l, ev), f = ev.links.includes(l.id) ? ev.expected : 1;
    const exp = base + (f > 1 ? refPeak(l) * (f - 1) : 0), util = exp / l.cap;
    let act = 0; for (let i = s; i <= e; i++) act = Math.max(act, l.out[i]);
    return { l, base, f, exp, util, act, level: util >= MOVE_LIMIT ? "crit" : util >= WATCH ? "warn" : "ok" };
  });
  const moves = rows.filter(r => r.level === "crit").map(r => {
    const need = r.exp - TARGET * r.l.cap;
    const cands = rows.filter(c => c.l.id !== r.l.id && c.level !== "crit" && !/^(IX|INTL)/.test(c.l.id))
      .map(c => ({ c, spare: 0.70 * c.l.cap - c.exp, same: CENTER(c.l.id) === CENTER(r.l.id) }))
      .filter(x => x.spare > 0).sort((a, b) => (b.same - a.same) || (b.spare - a.spare));
    const best = cands[0];
    return { r, need, best, ok: best && best.spare >= need };
  });
  return { s, e, rows, moves };
}
function evNoticeText(ev, calc) {
  const when = `${md(msOf(calc.s)).split(" ")[0]} ${hm(msOf(calc.s))}~${hm(msOf(calc.e))}`;
  if (!calc.moves.length) return `분산이 필요한 링크가 없습니다. (예상 사용률 ${Math.round(MOVE_LIMIT * 100)}% 미만)\n사전 통보는 필요 없고, 당일 모니터링만 진행합니다.`;
  const blocks = CUSTOMERS.map(c => {
    const mine = calc.moves.filter(m => c.links.includes(m.r.l.id)); if (!mine.length) return null;
    const lines = mine.map(m => {
      const to = m.best ? `${m.best.c.l.id}${CENTER(m.best.c.l.id) !== CENTER(m.r.l.id) ? " (" + CENTER(m.best.c.l.id) + ", 협의 후 진행)" : ""}` : "(여유 회선 없음, 별도 협의)";
      return `- ${m.r.l.id}: 예상 최대 ${m.r.exp.toFixed(0)}Gbps (용량 대비 ${(m.r.util * 100).toFixed(0)}%)\n  조치: 해당 시간대 일부(약 ${Math.max(1, Math.ceil(m.need))}Gbps)를 ${to}로 보내겠습니다.`;
    }).join("\n");
    return `제목: [사전 안내] ${when} ${ev.name} 대비 트래픽 분산 안내\n\n${c.name} 담당자님, 안녕하세요.\n${when} ${ev.name}로 트래픽 증가가 예상되어 미리 안내드립니다.\n\n${lines}\n\n서비스 중단 없이 진행할 예정이며, 종료 후 원복하고 결과를 안내드리겠습니다.\n문의는 관제 담당에게 연락 주세요. (가상 고객사 · 가상 센터)`;
  }).filter(Boolean);
  return blocks.join("\n\n--------------------------------\n\n");
}
function renderEvList() {
  const sel = $("#evSel").selectedIndex;
  $("#evList").innerHTML = `<tr><th>경기</th><th>킥오프</th><th>시간대</th><th class="n">예상 배율</th><th>분산 필요 링크</th><th class="n">실제 최대 사용률</th><th>사후 판정</th></tr>` +
    DATA.events.map((ev, i) => {
      const c = evCalc(ev), top = c.rows.filter(r => r.f !== 1).sort((a, b) => b.act / b.l.cap - a.act / a.l.cap)[0], u = top.act / top.l.cap * 100;
      const hr = +hm(msOf(c.s)).slice(0, 2), slot = hr < 6 ? "새벽" : "저녁";
      return `<tr class="click ${i === sel ? "sel" : ""}" data-i="${i}"><td>${esc(ev.name)}</td><td>${md(msOf(c.s))}</td><td>${slot}</td><td class="n">×${ev.expected}</td><td>${c.moves.map(m => m.r.l.id).join(", ") || "-"}</td><td class="n">${u.toFixed(0)}% (${top.l.id})</td><td>${u >= 80 ? '<span class="tag crit">경고선 초과</span>' : u >= 70 ? '<span class="tag warn">주의</span>' : '<span class="tag ok">여유</span>'}</td></tr>`;
    }).join("");
}
function renderEvent() {
  const ev = DATA.events[$("#evSel").selectedIndex], calc = evCalc(ev);
  $("#evInfo").textContent = `${md(msOf(calc.s))} ~ ${hm(msOf(calc.e))} · 예상 배율 ×${ev.expected} (${ev.links.join(", ")})`;
  const lv = { crit: ["분산 필요", "crit"], warn: ["주의", "warn"], ok: ["정상", "ok"] };
  $("#evPlan").innerHTML = `<tr><th>링크</th><th class="n">평소 최대</th><th class="n">배율</th><th class="n">예상 최대</th><th class="n">용량</th><th class="n">예상 사용률</th><th>판정</th></tr>` +
    calc.rows.map(r => `<tr><td>${r.l.id} <span class="muted">${esc(r.l.desc)}</span></td><td class="n">${r.base.toFixed(1)}</td><td class="n">${r.f === 1 ? "-" : "×" + r.f}</td><td class="n">${r.exp.toFixed(1)}</td><td class="n">${r.l.cap}</td><td class="n">${(r.util * 100).toFixed(0)}%</td><td><span class="tag ${lv[r.level][1]}">${lv[r.level][0]}</span></td></tr>`).join("");
  $("#evMove").innerHTML = `<div class="note">기준: 예상 사용률 ${Math.round(MOVE_LIMIT * 100)}% 이상이면 미리 분산 (경고선 80%에 여유를 둠). 분산 후 목표 ${Math.round(TARGET * 100)}% 이하.</div>` +
    (calc.moves.length ? calc.moves.map(m => `<p><b>${m.r.l.id}</b>: 예상 ${m.r.exp.toFixed(0)}G → 약 <b>${Math.max(1, Math.ceil(m.need))}G</b> 덜어내기. ` +
      (m.best ? `후보 <b>${m.best.c.l.id}</b> (${CENTER(m.best.c.l.id)}, 여유 약 ${m.best.spare.toFixed(0)}G) ${m.ok ? '<span class="tag ok">가능</span>' : '<span class="tag warn">여유 부족</span>'}${CENTER(m.best.c.l.id) !== CENTER(m.r.l.id) ? ' <span class="muted">다른 센터라 협의 필요</span>' : ""}` : '<span class="tag crit">후보 없음</span> 증설·서비스 협의 필요') + "</p>").join("") : "<p>분산이 필요한 링크가 없습니다.</p>");
  $("#evNotice").value = evNoticeText(ev, calc);
  $("#evPost").innerHTML = `<tr><th>링크</th><th class="n">예상 최대</th><th class="n">실제 최대</th><th class="n">차이</th><th class="n">실제 사용률</th><th>비고</th></tr>` +
    calc.rows.filter(r => r.f !== 1).map(r => {
      const diff = (r.act / r.exp - 1) * 100, u = r.act / r.l.cap * 100;
      return `<tr><td>${r.l.id}</td><td class="n">${r.exp.toFixed(1)}</td><td class="n">${r.act.toFixed(1)}</td><td class="n ${diff > 5 ? "crit-t" : ""}">${diff > 0 ? "+" : ""}${diff.toFixed(0)}%</td><td class="n">${u.toFixed(0)}%</td><td>${u >= 80 ? '<span class="tag crit">경고선 초과 (분산 없었다면)</span> ' : ""}${diff > 5 ? "예상보다 큼" : diff < -5 ? "예상보다 작음" : "예상과 비슷"}</td></tr>`;
    }).join("");
  const worst = calc.rows.filter(r => r.f !== 1).sort((a, b) => Math.abs(b.act / b.exp - 1) - Math.abs(a.act / a.exp - 1))[0];
  $("#evSummary").textContent = worst ? `가장 크게 어긋난 링크는 ${worst.l.id}: 예상 ${worst.exp.toFixed(0)}G, 실제 ${worst.act.toFixed(0)}G (${((worst.act / worst.exp - 1) * 100).toFixed(0)}%). 다음에 같은 유형의 이벤트는 배율을 ×${(1 + (worst.act - worst.base) / refPeak(worst.l)).toFixed(1)} 정도로 잡는 것을 제안합니다.` : "";
  const done = new Set(store.get("chk:" + ev.id, []));
  renderEvList();
  $("#evCheck").innerHTML = CHECK_ITEMS.map((t, i) => `<label class="chk" style="display:flex;margin:4px 0"><input type="checkbox" data-i="${i}" ${done.has(i) ? "checked" : ""}> ${t}</label>`).join("");
}
(function initEvent() {
  $("#evSel").innerHTML = DATA.events.map(e => `<option>${e.name} (${md(parseT(e.start))})</option>`).join("");
  $("#evList").addEventListener("click", ev => { const tr = ev.target.closest("tr.click"); if (tr) { $("#evSel").selectedIndex = +tr.dataset.i; renderEvent(); } });
  $("#evSel").onchange = renderEvent;
  $("#evCopy").onclick = () => copyText($("#evNotice").value, $("#evCopy"));
  $("#evGo").onclick = () => { const ev = DATA.events[$("#evSel").selectedIndex]; state.win = 36; $("#win").value = "36"; state.end = idxOf(parseT(ev.start)) + 25; showTab("monitor"); };
  $("#evCheck").addEventListener("change", e => {
    const ev = DATA.events[$("#evSel").selectedIndex];
    const set = new Set(store.get("chk:" + ev.id, [])); e.target.checked ? set.add(+e.target.dataset.i) : set.delete(+e.target.dataset.i);
    store.set("chk:" + ev.id, [...set]); renderTasks();
  });
  const first = DATA.events.findIndex(ev => evCalc(ev).moves.length > 0);
  if (first > 0) $("#evSel").selectedIndex = first;
  renderEvent();
})();

/* ---------- 4. 방문 신청 ---------- */
const SAMPLE_MAIL = `제목: 방문 신청 - 11/06 센터 방문
방문자: 김가상 (예시전자)
방문예정일시: 2026-11-06 14:00
방문센터: 우리 센터(가상)
방문목적: 서버 증설 작업
방문장소: 서버실 2층 B구역
주차: 필요
서버실 출입키: 필요`;
const KNOWN0 = [{ name: "이샘플", org: "샘플게임즈" }, { name: "박예시", org: "예시미디어" }];
const vv = id => $("#" + id);
function visitors() { return store.get("visitors", KNOWN0); }
function parseMail(text) {
  const get = k => { const m = text.match(new RegExp("^\\s*" + k + "\\s*[:：]\\s*(.+)$", "m")); return m ? m[1].trim() : ""; };
  const who = get("방문자"), m = who.match(/^(.+?)\s*[\(（](.+?)[\)）]\s*$/);
  const yes = v => /필요|예|Y/i.test(v);
  return { name: m ? m[1] : who, org: m ? m[2] : "", when: get("방문예정일시").replace(" ", "T"), center: get("방문센터"), purpose: get("방문목적"), place: get("방문장소"), park: yes(get("주차")), key: yes(get("서버실 출입키")) };
}
function vWho() {
  const n = vv("vName").value.trim(), o = vv("vOrg").value.trim();
  if (!n) { vv("vWho").innerHTML = ""; return null; }
  const known = visitors().some(v => v.name === n && v.org === o);
  vv("vWho").innerHTML = known ? '<span class="tag ok">기존 방문자</span> 출입자 정보가 이미 있습니다. 방문 등록만 하면 됩니다.' : '<span class="tag warn">처음 방문</span> 출입자 정보를 먼저 등록한 뒤 방문 등록합니다. (등록 버튼을 누르면 함께 처리됩니다)';
  return known;
}
function replyText(r) {
  return `제목: [회신] 방문 등록 완료 - ${r.name}님 ${r.when.slice(0, 10)}\n\n${r.org} ${r.name}님, 안녕하세요.\n요청하신 방문이 아래와 같이 등록되었습니다.\n\n- 방문예정일시: ${r.when.replace("T", " ")}\n- 방문센터: ${r.center}\n- 방문장소: ${r.place}\n- 방문목적: ${r.purpose}\n- 주차: ${r.park ? "등록 완료" : "해당 없음"}\n- 서버실 출입키: ${r.key ? "사전 준비 완료 (방문 시 수령)" : "해당 없음"}\n\n방문 당일 신분증을 지참해 주세요.\n감사합니다. (가상 메일)`;
}
function renderVisits() {
  const v = store.get("visits", []);
  vv("vTbl").innerHTML = `<tr><th>방문예정</th><th>방문자</th><th>소속</th><th>장소</th><th>주차</th><th>키</th><th>구분</th><th></th></tr>` +
    (v.length ? v.map((r, i) => `<tr><td>${r.when.replace("T", " ")}</td><td>${esc(r.name)}</td><td>${esc(r.org)}</td><td>${esc(r.place)}</td><td>${r.park ? "O" : "-"}</td><td>${r.key ? "O" : "-"}</td><td>${r.isNew ? '<span class="tag warn">신규 출입자</span>' : '<span class="tag ok">기존</span>'}</td><td><button class="btn sm" data-reply="${i}">회신 보기</button></td></tr>`).join("") : `<tr><td colspan="8" class="muted">아직 등록한 방문이 없습니다.</td></tr>`);
}
(function initVisit() {
  vv("vMail").value = SAMPLE_MAIL;
  vv("vSample").onclick = () => { vv("vMail").value = SAMPLE_MAIL; };
  vv("vParse").onclick = () => {
    const p = parseMail(vv("vMail").value);
    vv("vName").value = p.name; vv("vOrg").value = p.org; vv("vWhen").value = p.when; vv("vCenter").value = p.center;
    vv("vPurpose").value = p.purpose; vv("vPlace").value = p.place; vv("vPark").checked = p.park; vv("vKey").checked = p.key; vWho();
  };
  ["vName", "vOrg"].forEach(id => vv(id).addEventListener("input", vWho));
  vv("vReg").onclick = () => {
    const r = { name: vv("vName").value.trim(), org: vv("vOrg").value.trim(), when: vv("vWhen").value, center: vv("vCenter").value.trim(), purpose: vv("vPurpose").value.trim(), place: vv("vPlace").value.trim(), park: vv("vPark").checked, key: vv("vKey").checked };
    if (!r.name || !r.when || !r.purpose) { vv("vWho").innerHTML = '<span class="tag crit">방문자, 일시, 목적은 꼭 필요합니다</span>'; return; }
    const known = vWho(); r.isNew = !known;
    if (r.isNew) store.set("visitors", visitors().concat([{ name: r.name, org: r.org }]));
    store.set("visits", store.get("visits", []).concat([r]));
    vv("vReply").value = replyText(r); renderVisits(); renderTasks(); vWho();
  };
  vv("vTbl").addEventListener("click", e => { const b = e.target.closest("[data-reply]"); if (b) vv("vReply").value = replyText(store.get("visits", [])[+b.dataset.reply]); });
  renderVisits();
})();

/* ---------- 5. 장비 터미널 (가상) ---------- */
const DEVICES = [
  { id: "SW-OUR-A", vendor: "juniper", prompt: "admin@SW-OUR-A>", ifs: [["xe-0/0/0", "OUR-A", 0, -3.1], ["xe-0/0/1", "OUR-B", 0, -3.4], ["xe-0/0/2", "IX-1", 2, -3.8], ["xe-0/0/3", "INTL-1", 1423, -14.2]] },
  { id: "SW-CTR-B", vendor: "cisco", prompt: "SW-CTR-B#", ifs: [["Te1/0/1", "CTR-B1", 0, -2.9], ["Te1/0/2", "CTR-B2", 87, -12.9], ["Te1/0/3", "CTR-C1", 0, -3.3], ["Te1/0/4", "CTR-D1", 0, -3.0]] },
  { id: "AS-1", vendor: "huawei", prompt: "<AS-1>", ifs: [["XGigabitEthernet0/1/1", "ACC-1", 0, -3.2], ["XGigabitEthernet0/1/2", "ACC-2", 12, -9.8]] }
];
const dBm = v => (Math.pow(10, v / 10)).toFixed(4);
function jOptics(f) {
  const bad = f[3] < -11;
  return `Physical interface: ${f[0]}\n    Laser bias current                        :  38.412 mA\n    Laser output power                        :  0.5120 mW / -2.91 dBm\n    Module temperature                        :  41 degrees C / 106 degrees F\n    Module voltage                            :  3.3010 V\n    Receiver signal average optical power     :  ${dBm(f[3])} mW / ${f[3].toFixed(2)} dBm\n    Laser rx power low alarm                  :  ${bad ? "On" : "Off"}\n    Laser rx power low warning                :  ${bad ? "On" : "Off"}`;
}
const jCrc = f => `      CRC/Align errors                  ${String(f[2]).padEnd(12)}0`;
const DEV_CMDS = {
  juniper: [
    [/^show interfaces? diagnostics optics (\S+)$/i, (d, m) => { const f = findIf(d, m[1]); return f ? jOptics(f) : `error: device ${m[1]} not found`; }],
    [/^show interfaces? extensive (\S+) \| match CRC$/i, (d, m) => { const f = findIf(d, m[1]); return f ? jCrc(f) : `error: device ${m[1]} not found`; }],
    [/^show interfaces? extensive \| (?:match )?"?CRC\|(?:physical interface|xe)"?$/i, d => d.ifs.map(f => `Physical interface: ${f[0]}, Enabled, Physical link is Up\n${jCrc(f)}`).join("\n")]
  ],
  cisco: [
    [/^show interfaces? (\S+) \| include CRC$/i, (d, m) => { const f = findIf(d, m[1]); return f ? `     ${f[2]} input errors, ${f[2]} CRC, 0 frame, 0 overrun, 0 ignored` : `% Invalid input detected at '^' marker.`; }]
  ],
  huawei: [
    [/^display transceiver interface (.+?) verbose$/i, (d, m) => {
      const f = findIf(d, m[1].replace(/\s+/g, "")); if (!f) return "Error: Wrong parameter found at '^' position.";
      const bad = f[3] < -9;
      return `${f[0]} transceiver information:\n-------------------------------------------------------------\nCommon information:\n  Transceiver Type                      :10G_BASE_LR_SFP\n  Wavelength(nm)                        :1310\n  Transmission Distance(m)              :10000\nDiagnostic information:\n  Temperature(C)                        :39\n  Voltage(V)                            :3.30\n  TX Power(dBm)                         :-2.80\n  RX Power(dBm)                         :${f[3].toFixed(2)}\nAlarm information:\n  ${bad ? "RX power is low (warning)" : "None"}`;
    }]
  ]
};
function findIf(d, name) { return d.ifs.find(f => f[0].toLowerCase() === String(name).toLowerCase()); }
const VENDOR_ERR = { juniper: "                     ^\nunknown command.", cisco: "% Invalid input detected at '^' marker.", huawei: "Error: Unrecognized command found at '^' position." };
const devNow = () => DEVICES[$("#devSel").selectedIndex];
function runCmd(raw) {
  const d = devNow(), cmd = raw.trim().replace(/\s+/g, " ");
  if (!cmd) return "";
  if (cmd === "?" || /^help$/i.test(cmd)) return "오른쪽의 '자주 쓰던 명령'을 참고하세요. 장비 종류에 맞는 명령만 동작합니다.";
  for (const [re, fn] of DEV_CMDS[d.vendor]) { const m = cmd.match(re); if (m) return fn(d, m); }
  return VENDOR_ERR[d.vendor];
}
function quickCmds() {
  const d = devNow(), bad = d.ifs.find(f => f[2] > 50) || d.ifs[0], ok = d.ifs[0];
  const list = {
    juniper: [`show interfaces diagnostics optics ${bad[0]}`, `show interfaces extensive ${bad[0]} | match CRC`, `show interfaces extensive | match "CRC|physical interface"`],
    cisco: [`show interface ${bad[0]} | include CRC`, `show interface ${ok[0]} | include CRC`],
    huawei: [`display transceiver interface ${bad[0].replace("XGigabitEthernet", "XGigabitEthernet ")} verbose`]
  }[d.vendor];
  $("#qcmd").innerHTML = list.map(c => `<button data-c="${esc(c)}">${esc(c)}</button>`).join("");
}
const termHist = []; let hp = 0;
function termPrint(html) { const t = $("#termOut"); t.insertAdjacentHTML("beforeend", html); t.scrollTop = t.scrollHeight; }
function termBanner() { const d = devNow(); $("#termOut").innerHTML = `<span class="muted">가상 장비 ${d.id} (${d.vendor}) 에 연결됨. 실제 장비가 아닙니다.</span>\n`; $("#termPrompt").textContent = d.prompt; quickCmds(); }
(function initTerm() {
  $("#devSel").innerHTML = DEVICES.map(d => `<option>${d.id} (${d.vendor})</option>`).join("");
  $("#devSel").onchange = termBanner;
  $("#termClear").onclick = termBanner;
  $("#qcmd").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { $("#termIn").value = b.dataset.c; $("#termIn").focus(); } });
  $("#termIn").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const v = e.target.value; termHist.push(v); hp = termHist.length;
      const out = runCmd(v);
      termPrint(`<span class="p">${esc(devNow().prompt)}</span> <span class="c">${esc(v)}</span>\n${/^(error|%|Error|\s+\^)/.test(out) ? `<span class="e">${esc(out)}</span>` : esc(out)}\n`);
      e.target.value = "";
    } else if (e.key === "ArrowUp" && termHist.length) { hp = Math.max(0, hp - 1); e.target.value = termHist[hp]; e.preventDefault(); }
    else if (e.key === "ArrowDown" && termHist.length) { hp = Math.min(termHist.length, hp + 1); e.target.value = termHist[hp] || ""; e.preventDefault(); }
  });
  termBanner();
})();

/* ---------- 시작 ---------- */
const h0 = location.hash.slice(1);
showTab(["monitor", "monthly", "event", "visit", "term"].includes(h0) ? h0 : "monitor");
