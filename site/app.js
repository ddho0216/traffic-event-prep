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
const CUSTOMERS = TOPOLOGY.customers;   // 전부 가상 고객사. 설계도(topology.js)에서 읽는다 (회선 배정은 제가 임의로 정한 것)
const CENTER_NAME = TOPOLOGY.centers;   // 이름의 센터 코드: IDC_<코드>_... (센터 목록은 설계도에서)
const CENTER = id => /_(IX|INTL)\d/.test(id) ? "연동" : (CENTER_NAME[id.split("_")[1]] || "연동");

/* ---------- 경고 탐지: 규칙은 lib.js에 있다 (터미널에서도 시험할 수 있게 분리) ---------- */
const { runs, median } = Lib;
const DROP = {};   // 링크별 급감 여부 (그래프 패널 표시용)
const ALERTS = (() => { const r = Lib.detectTraffic(DATA); Object.assign(DROP, r.drop); return r.alerts; })();

/* ---------- 탭 ---------- */
function showTab(name) {
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $$("section.tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  if (typeof renderCenterBar === "function") {   // 센터 선택은 관제와 서버실에서만 보인다
    $("#centerBar").hidden = !(name === "monitor" || name === "room" || name === "room3d");
    if ($("#centerBar").hidden) syncHdr(); else renderCenterBar();
  }
  if (name === "monitor") { renderAll(); renderTasks(); }
  if (name !== "room" && typeof stopPlay === "function") stopPlay();
  if (name === "room") renderServerRoom();
  if (name === "room3d" && typeof render3d === "function") render3d();
  try { history.replaceState(null, "", "#" + name); } catch (e) { /* 무시 */ }
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });

/* ---------- 1. 관제 ---------- */
const NOW_IDX = idxOf(parseT("2026-10-22T21:00"));   // 가상 "현재" 시각: 평소 저녁
const HL = new Set();   // 시나리오가 강조 표시하는 링크·랙
const state = { end: NOW_IDX, win: 12, ymode: "cap", cust: "all" };
// 공통 센터 선택: 관제 그래프·서버실 랙·터미널 장비·설계도가 모두 이 선택에 맞춰 보인다. "ALL" 또는 센터 코드(B/S/G/A).
// 회선·랙·장비 이름이 모두 IDC_<센터 코드>_... 라서 이름의 두 번째 칸으로 센터를 알 수 있다.
const codeOf = id => id.split("_")[1];
const view = { center: ["ALL", ...Object.keys(TOPOLOGY.centers)].includes(store.get("center", "ALL")) ? store.get("center", "ALL") : "ALL" };
const inView = id => view.center === "ALL" || codeOf(id) === view.center;
const viewLabel = () => view.center === "ALL" ? "전체 센터" : TOPOLOGY.centers[view.center];
const custOf = id => CUSTOMERS.filter(c => c.links.includes(id)).map(c => c.name);

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(x => x >= m) || 10) * p;
}

const endpoints = id => { const t = TOPOLOGY.links.find(x => x.link === id); return t ? `${t.a} ${t.ap} → ${esc(t.b)}${t.bp && t.bp !== "-" ? " " + t.bp : ""}` : ""; };
const custTitle = id => { const n = custOf(id); return n.length === 0 ? "공용 (고객사 없음)" : n.length <= 2 ? n.join(" · ") : `${n.slice(0, 2).join(" · ")} 외 ${n.length - 2}곳`; };
function buildGrid() {
  $("#grid").innerHTML = LINKS.map(l => `
    <div class="panel" id="p-${l.id}">
      <div class="hd"><b title="${esc(custOf(l.id).join(", ") || "고객사 없음")}">${custTitle(l.id)}</b><span class="sp"></span><span class="chip">정상</span><button class="btn sm csv" data-link="${l.id}">CSV</button></div>
      <div class="sub">${l.id} · ${esc(l.desc)} · ${l.cap}G</div>
      <div class="sub2">${endpoints(l.id)}</div>
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
  let dropped = false; for (let i = s; i <= e; i++) if (DROP[l.id][i]) { dropped = true; break; }
  const util = l.out[e] / l.cap, wutil = wmax / l.cap, cls = wutil >= 0.8 || dropped ? "crit" : wutil >= 0.7 ? "warn" : "";
  root.className = "panel " + cls + (HL.has(l.id) ? " hl" : "");
  $(".chip", root).textContent = wutil >= 0.8 ? "경고" : dropped ? "급감" : wutil >= 0.7 ? "주의" : "정상";
  $(".now", root).innerHTML = `<span class="o">OUT ${l.out[e].toFixed(1)}G</span><span class="i">IN ${l.in[e].toFixed(1)}G</span><span class="muted">${(util * 100).toFixed(0)}% · 창 최대 out ${wmax.toFixed(1)}G</span>`;
}
function renderMonSum() {   // 지금 보이는 회선과 그 회선에 연결된 장비 (설계도 기준)
  const links = LINKS.filter(l => $("#p-" + l.id) && $("#p-" + l.id).style.display !== "none").map(l => TOPOLOGY.links.find(t => t.link === l.id)).filter(Boolean);
  const devs = [...new Set(links.flatMap(t => [t.a, t.b]).filter(d => DEV[d]))];
  $("#monSum").textContent = `${viewLabel()} · 회선 ${links.length}개 · 연결된 장비 ${devs.length}대${devs.length <= 8 ? " (" + devs.join(", ") + ")" : ""}`;
}
function renderAll() { renderAllPanels(); renderMonSum(); }
function renderAllPanels() {
  if (!$("#tab-monitor").classList.contains("on")) return;
  state.end = clamp(state.end, 0, N - 1);
  $("#endTime").value = isoLocal(msOf(state.end));
  LINKS.forEach(l => {
    const show = inView(l.id) && (state.cust === "all" || (state.cust === "none" ? !custOf(l.id).length : custOf(l.id).includes(state.cust)));
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
  $("#goNow").onclick = () => { stopScn(); goNow(); };
  $("#csvAll").onclick = () => { const [s, e] = viewRange(); downloadCsv(`traffic_all_${fileStamp(msOf(s))}_${fileStamp(msOf(e))}.csv`, csvOf(LINKS.filter(l => $("#p-" + l.id).style.display !== "none").map(l => l.id), s, e)); };
  $("#grid").addEventListener("click", ev => {
    const b = ev.target.closest(".csv"); if (!b) return;
    const [s, e] = viewRange(); downloadCsv(`traffic_${b.dataset.link}_${fileStamp(msOf(s))}_${fileStamp(msOf(e))}.csv`, csvOf([b.dataset.link], s, e));
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderAll, 120); });
})();

function renderTasksTable() {
  const sent = CUSTOMERS.filter(c => store.get("sent:" + c.name, false)).length;
  const checks = DATA.events.map(ev => (store.get("chk:" + ev.id, []) || []).length);
  const visits = store.get("visits", []).length;
  const spikes = ALERTS.filter(a => a.kind === "in 급증 의심" && !a.evName).length;
  const drops = ALERTS.filter(a => a.kind.includes("급감") && !a.evName).length;
  const rows = [
    ["월말 자료 발송", `${sent}/${CUSTOMERS.length} 고객사 완료`, sent === CUSTOMERS.length ? "ok" : "warn", "monthly"],
    ["이벤트 대비", `월드컵 ${checks.filter(c => c === CHECK_ITEMS.length).length}/${DATA.events.length}경기 체크 완료`, "warn", "event"],
    ["방문 신청 등록", `등록 ${visits}건`, "ok", "visit"],
    ["트래픽 급증·급감 확인", `경기와 겹치지 않는 급증 ${spikes}건 · 급감 ${drops}건 (경고 이력 참고)`, spikes + drops ? "warn" : "ok", "monitor"],
    ["서버실 온도·육안점검", `온도 경고 ${ROOM_ALERTS.length}건 · 점검 기록 ${store.get("inspections", []).length}건`, ROOM_ALERTS.length ? "warn" : "ok", "room"],
    ["장비 점검 (광값·CRC)", "CRC·광 수신값 이상 회선 있음", "crit", "term"]
  ];
  $("#taskTbl").innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td><span class="tag ${r[2]}">${r[1]}</span></td><td><button class="btn sm" data-go="${r[3]}">열기</button></td></tr>`).join("");
}
function renderTasks() { renderTasksTable(); renderBell(); }
$("#taskTbl").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) { closeNotif(); showTab(b.dataset.go); } });

/* ---------- 알림 (종 모양): 경고 이력 + 내 업무. 관제 첫 화면에는 모니터만 남긴다 ---------- */
const needCheck = () => ALERTS.filter(a => !a.evName).length + ROOM_ALERTS.length;   // 사람이 확인해야 하는 건수
function renderBell() {
  const n = needCheck(), all = $("#showAllAlerts").checked, hidden = ALERTS.filter(a => a.evName).length;
  $("#bellN").textContent = n; $("#bellN").hidden = n === 0;
  const rows = [];
  ALERTS.forEach((a, k) => { if (all || !a.evName) rows.push({ t: a.s, html: `<tr class="click" data-k="${k}"><td>${md(msOf(a.s))} ~ ${hm(msOf(a.e))}</td><td>${a.link}</td><td><span class="tag ${a.sev}">${a.kind}</span></td><td>${a.val}</td><td>${a.evName ? `<span class="tag ok">${esc(a.evName)}</span>` : '<span class="tag crit">확인 필요</span>'}</td></tr>` }); });
  ROOM_ALERTS.forEach((a, k) => rows.push({ t: a.s, html: `<tr class="click" data-r="${k}"><td>${md(msOf(a.s))} ~ ${hm(msOf(a.e))}</td><td>랙 ${a.rack}</td><td><span class="tag crit">온도 경고</span></td><td>${TEMP_HOT}°C 이상, 최고 ${a.max.toFixed(1)}°C</td><td><span class="tag crit">확인 필요</span></td></tr>` }));
  rows.sort((x, y) => x.t - y.t);
  $("#alertTbl").innerHTML = `<tr><th>시각</th><th>대상</th><th>유형</th><th>내용</th><th>구분</th></tr>` + (rows.length ? rows.map(r => r.html).join("") : `<tr><td colspan="5" class="muted">확인 필요한 알림이 없습니다.</td></tr>`);
  $("#alertSum").textContent = `확인 필요 ${n}건` + (all ? ` · 경기와 겹침 ${hidden}건 포함` : ` · 경기와 겹치는 ${hidden}건은 숨김`);
}
function closeNotif() { $("#notif").hidden = true; $("#bell").setAttribute("aria-expanded", "false"); }
(function initNotif() {
  const panel = $("#notif"), bell = $("#bell");
  bell.addEventListener("click", e => { e.stopPropagation(); if (panel.hidden) { renderTasks(); panel.hidden = false; bell.setAttribute("aria-expanded", "true"); } else closeNotif(); });
  $("#notifClose").onclick = closeNotif;
  document.addEventListener("click", e => { if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) closeNotif(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeNotif(); });
  $$("[data-np]").forEach(b => b.addEventListener("click", () => {
    $$("[data-np]").forEach(x => x.classList.toggle("on", x === b));
    $("#np-alerts").hidden = b.dataset.np !== "alerts"; $("#np-tasks").hidden = b.dataset.np !== "tasks";
  }));
  $("#showAllAlerts").addEventListener("change", renderBell);
  $("#alertTbl").addEventListener("click", ev => {
    const tr = ev.target.closest("tr.click"); if (!tr) return;
    closeNotif();
    if (tr.dataset.k !== undefined) { const al = ALERTS[+tr.dataset.k]; if (!inView(al.link)) setCenter(codeOf(al.link)); showTab("monitor"); state.end = Math.min(N - 1, al.peak + 6); renderAll(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else { const ra = ROOM_ALERTS[+tr.dataset.r]; if (!inView(ra.rack)) setCenter(codeOf(ra.rack)); sr.end = ra.peak; showTab("room"); }
  });
})();

/* ---------- 2. 월간 자료 ---------- */
const MIN_DAY = ymd(T0), MAX_DAY = ymd(msOf(N - 1));
const REF = {};   // refPeak 계산 결과 보관 (월간 자료가 시작할 때 쓰므로 앞쪽에 선언)
const DAY = 86400000, HIST_DAYS = 190;       // 10/19 이전은 이 일수까지 즉석에서 만들어 준다 (가상)
const MIN_PICK = ymd(T0 - HIST_DAYS * DAY);
function p95(a) { const b = Float64Array.from(a).sort(); return b[Math.floor(0.95 * (b.length - 1))]; }

/* 10/19 이전: 생성해 둔 데이터가 없으므로 같은 규칙(평소 하루 모양 + 작은 잡음)으로 그때그때 만든다.
   같은 시각이면 항상 같은 값이 나온다. 경기·사고는 없는 "평소" 기록이다. */
const SHAPE = (() => {
  const f = (x, we) => { let v = 0.25 + 0.15 * Math.sin((x - 9) / 24 * 2 * Math.PI) + 0.65 * Math.exp(-((x - 21) ** 2) / (2 * 2.2 ** 2)); if (we) v += 0.10 * Math.exp(-((x - 14) ** 2) / (2 * 3.0 ** 2)); return v; };
  let mw = 0, me = 0; for (let k = 0; k < 288; k++) { mw = Math.max(mw, f(k / 12, false)); me = Math.max(me, f(k / 12, true)); }
  return { f, mw, me };
})();
function hn(seed) { let t = (seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function gauss(seed) { return (hn(seed) + hn(seed + 1) + hn(seed + 2) + hn(seed + 3) - 2) * 1.7; }
function synthPoint(l, ms) {
  const d = new Date(ms), x = d.getUTCHours() + d.getUTCMinutes() / 60, we = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const sh = SHAPE.f(x, we) / (we ? SHAPE.me : SHAPE.mw), k = Math.round((ms - T0) / STEP), li = LINKS.indexOf(l), ref = refPeak(l);
  const out = clamp(ref * sh * (1 + 0.02 * gauss(k * 8 + li * 100003)), 0.1, l.cap);
  const inn = clamp(ref * 0.35 * sh * (1 + 0.025 * gauss(k * 8 + li * 100003 + 4)), 0.05, l.cap);
  return [+out.toFixed(2), +inn.toFixed(2)];
}
function seriesFor(l, fromMs, toMs) {
  const n = Math.round((toMs - fromMs) / STEP) + 1, out = new Array(n), inn = new Array(n);
  for (let k = 0; k < n; k++) {
    const ms = fromMs + k * STEP, i = idxOf(ms);
    if (i >= 0 && i < N) { out[k] = l.out[i]; inn[k] = l.in[i]; } else { const v = synthPoint(l, ms); out[k] = v[0]; inn[k] = v[1]; }
  }
  return { out, inn, from: fromMs };
}
function statsArr(a, from) {
  let mxi = 0, mn = a[0], sum = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] > a[mxi]) mxi = i; if (a[i] < mn) mn = a[i]; sum += a[i]; }
  return { max: a[mxi], at: from + mxi * STEP, min: mn, avg: sum / a.length, p95: p95(a) };
}

const DATA_END = msOf(N - 1);   // 마지막 데이터 시각
const monthStart = ym => { const [y, m] = ym.split("-").map(Number); return Date.UTC(y, m - 1, 1); };
const monthEnd = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - STEP; };   // 그 달 말일 23:55
// 기간은 하나다: 기본은 대상 월의 1일~말일, 다른 기간이 필요하면 시작일·끝나는 날을 직접 고른다.
function mState() {
  const c = CUSTOMERS[$("#mCust").selectedIndex];
  const ids = $$("#mLinks input:checked").map(i => i.value);
  const fromStr = $("#mFrom").value, toStr = $("#mTo").value;
  const fromDay = parseT(fromStr + "T00:00"), toDay = parseT(toStr + "T00:00");
  const bad = !fromStr || !toStr || fromDay > toDay;
  return { c, ids, bad, fromStr, toStr, from: fromDay, to: Math.min(toDay + DAY - STEP, DATA_END), clamped: toDay + DAY - STEP > DATA_END };
}
function mCompute(m) {
  return m.ids.map(id => { const sr = seriesFor(LINK[id], m.from, m.to); return { id, sr, st: { out: statsArr(sr.out, m.from), in: statsArr(sr.inn, m.from) } }; });
}
function seriesCsv(id, sr) {
  const l = LINK[id], rows = ["time,link,in_gbps,out_gbps,out_util_pct"];
  for (let k = 0; k < sr.out.length; k++) rows.push(`${ymdhm(sr.from + k * STEP)},${id},${sr.inn[k]},${sr.out[k]},${(sr.out[k] / l.cap * 100).toFixed(1)}`);
  return rows.join("\n");
}
function summaryCsv(data, m) {
  const rows = ["from,to,link,direction,max_gbps,max_time,min_gbps,avg_gbps,p95_gbps"];
  data.forEach(x => ["out", "in"].forEach(d => { const t = x.st[d]; rows.push(`${m.fromStr},${m.toStr},${x.id},${d},${t.max.toFixed(2)},${ymdhm(t.at)},${t.min.toFixed(2)},${t.avg.toFixed(2)},${t.p95.toFixed(2)}`); }));
  return rows.join("\n");
}
function renderMonthly() {
  const m = mState();
  const msg = m.bad ? "시작일이 끝나는 날보다 늦습니다. 날짜를 확인하세요." : !m.ids.length ? "회선을 선택하세요." : "";
  const data = msg ? [] : mCompute(m);
  $("#mSum").innerHTML = `<tr><th>회선</th><th>방향</th><th class="n">최대</th><th>최대 시각</th><th class="n">최소</th><th class="n">평균</th><th class="n">95%값</th></tr>` +
    (msg ? `<tr><td colspan="7" class="${m.bad ? "crit-t" : "muted"}">${msg}</td></tr>` : data.map(x => ["out", "in"].map(d => { const t = x.st[d]; return `<tr><td>${x.id}</td><td>${d.toUpperCase()}</td><td class="n">${t.max.toFixed(2)}</td><td>${md(t.at)}</td><td class="n">${t.min.toFixed(2)}</td><td class="n">${t.avg.toFixed(2)}</td><td class="n">${t.p95.toFixed(2)}</td></tr>`; }).join("")).join(""));
  $("#mNote").textContent = [
    !m.bad && m.from < T0 ? `※ ${MIN_DAY} 이전 구간은 생성해 둔 데이터가 없어서, 같은 규칙(평소 하루 모양)으로 즉석에서 만든 가상 값입니다. 경기·사고는 없는 평소 기록입니다.` : "",
    !m.bad && m.clamped ? `※ 데이터는 ${MAX_DAY}까지만 있어서 거기까지 보냅니다.` : ""].filter(Boolean).join(" ");
  $("#mNote2").textContent = !m.bad && (m.to - m.from) > 60 * DAY ? "긴 기간은 파일이 큽니다 (6개월이면 회선당 약 3MB, 압축하지 않고 묶습니다)." : "";
  $("#mMail").value =
`제목: [${m.c.name}] ${m.fromStr} ~ ${m.toStr} 회선별 5분 단위 트래픽 자료 송부

${m.c.name} 담당자님, 안녕하세요.
요청하신 회선별 5분 단위 트래픽 자료를 보내드립니다.

- 대상 회선: ${m.ids.join(", ") || "(선택 없음)"}
- 기간: ${m.fromStr} ~ ${m.toStr}
- 첨부: 회선별 5분 단위 CSV, 요약 CSV(최대·최소·평균·95%값)
- 단위: Gbps (IN = 센터로 들어온 트래픽, OUT = 센터에서 나간 트래픽)

추가로 필요한 자료가 있으면 말씀해 주세요.
감사합니다.`;
}
(function initMonthly() {
  $("#mCust").innerHTML = CUSTOMERS.map(c => `<option>${c.name}</option>`).join("");
  $("#mMonth").min = MIN_PICK.slice(0, 7); $("#mMonth").max = MAX_DAY.slice(0, 7);
  ["mFrom", "mTo"].forEach(id => { const el = $("#" + id); el.min = MIN_PICK; el.max = MAX_DAY; });
  const syncDates = () => { const ms = monthStart($("#mMonth").value); $("#mFrom").value = ymd(ms); $("#mTo").value = ymd(Math.min(monthEnd(ms), DATA_END)); };
  { const d = new Date(DATA_END); $("#mMonth").value = ymd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).slice(0, 7); }   // 기본: 지난달 (월초에 지난달 자료를 보낸다)
  syncDates();
  const drawLinks = () => {
    const c = CUSTOMERS[$("#mCust").selectedIndex];
    $("#mLinks").innerHTML = c.links.map(id => `<label class="chk"><input type="checkbox" value="${id}" checked> ${id}</label>`).join("");
    renderMonthly();
  };
  $("#mCust").onchange = drawLinks;
  $("#mMonth").onchange = () => { if ($("#mMonth").value) { syncDates(); renderMonthly(); } };
  $("#mFrom").onchange = $("#mTo").onchange = renderMonthly;
  $("#mLinks").addEventListener("change", renderMonthly);
  $("#mZip").onclick = () => {
    const m = mState(); if (m.bad || !m.ids.length) return;
    const enc = new TextEncoder(), data = mCompute(m), files = [];
    data.forEach(x => files.push({ name: `${m.c.name}_${x.id}_5min_${m.fromStr}_${m.toStr}.csv`, data: enc.encode("﻿" + seriesCsv(x.id, x.sr)) }));
    files.push({ name: `${m.c.name}_요약_${m.fromStr}_${m.toStr}.csv`, data: enc.encode("﻿" + summaryCsv(data, m)) });
    download(`traffic_${m.c.key}_${m.fromStr}_${m.toStr}.zip`, makeZip(files));   // 받는 파일 이름은 영문 (한글이면 브라우저가 이름을 잃을 수 있음)
  };
  $("#mSumCsv").onclick = () => { const m = mState(); if (m.bad || !m.ids.length) return; downloadCsv(`summary_${m.c.key}_${m.fromStr}_${m.toStr}.csv`, summaryCsv(mCompute(m), m)); };
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
    const cands = rows.filter(c => c.l.id !== r.l.id && c.level !== "crit" && !/_(IX|INTL)\d/.test(c.l.id))
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
방문센터: 분당 센터(가상)
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
// 설계도(topology.js)에서 가상 장비를 만든다. 포트는 연결표에서 가져온다.
const PROMPT = { juniper: id => `admin@${id}>`, cisco: id => `${id}#`, huawei: id => `<${id}>` };
const DEVICES = TOPOLOGY.devices.map(d => Object.assign({}, d, { prompt: PROMPT[d.vendor](d.id), ifs: [] }));
const DEV = Object.fromEntries(DEVICES.map(d => [d.id, d]));
// 포트 한 칸: [포트 이름, 상대(장비·외부), CRC 오류 수, 광 수신값 dBm, 연결 정보, 링크 상태(up/down), 관리 상태(up/down), 내 IP, 상대 IP]
// IP는 전부 제가 만든 가상 값(10.x)이고 L3 장비(Juniper·Cisco)에만 있다. Huawei(AS)는 L2 스위치라 IP가 없다.
const LINK_NO = new Map(TOPOLOGY.links.map((l, k) => [l, k]));
const addPort = (dev, port, peer, link, side) => {
  const f = TOPOLOGY.faults[`${dev}|${port}`] || {}, d = DEV[dev], k = LINK_NO.get(link), pd = DEV[peer];
  const admin = f.admin === "down" ? "down" : "up", up = f.down || admin === "down" ? "down" : "up";
  const base = `10.${100 + Math.floor(k / 60)}.${k % 60}`, mine = d.vendor !== "huawei", theirs = !pd || pd.vendor !== "huawei";
  const rx = f.rx != null ? f.rx : up === "down" ? -40 : -3.0 - (d.ifs.length % 4) * 0.15;
  d.ifs.push([port, peer, f.crc || 0, rx, link, up, admin, mine && theirs ? `${base}.${side === "a" ? 1 : 2}` : "", mine && theirs ? `${base}.${side === "a" ? 2 : 1}` : ""]);
};
TOPOLOGY.links.forEach(l => { addPort(l.a, l.ap, l.b, l, "a"); if (DEV[l.b]) addPort(l.b, l.bp, l.a, l, "b"); });

/* 업무 메모에서 일반화한 명령들: 회선 설명(Up/Down·Admin/Link·고객사), ARP·ping, 로그, BGP, 설정. 출력은 전부 가상입니다. */
const custNames = keys => keys.map(k => CUSTOMERS.find(c => c.key === k).name);
function descOf(d, f) {   // 회선 설명: 회선 이름 -> 상대 / 고객사
  const l = f[4]; if (!l) return "";
  let cust = CUSTOMERS.filter(c => c.links.includes(l.link)).map(c => c.name);
  if (!cust.length) cust = custNames(d.customers || (DEV[f[1]] && DEV[f[1]].customers) || []);
  const n = cust.length > 2 ? `${cust.slice(0, 2).join("·")} 외 ${cust.length - 2}곳` : cust.join("·");
  return `${l.link} -> ${f[1]}${n ? " / " + n : ""}`;
}
const hexOf = s => [...s].reduce((q, c) => (q * 131 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, "0");
const macOf = s => { const h = hexOf(s); return `00:0e:c6:${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`; };
const asOf = id => id && DEV[id] ? 64512 + (+id.match(/(\d+)$/)[1]) + (id.split("_")[1].charCodeAt(0) % 7) * 10 : 64999;
const shortPort = p => p.replace("XGigabitEthernet", "XGE").replace("TenGigE", "Te");
const logTime = k => `Oct 22 20:${String(10 + k * 7).padStart(2, "0")}:${String((k * 17) % 60).padStart(2, "0")}`;
function pingBody(f, n) {
  const down = f[5] === "down", lost = down ? n : portBad(f) ? Math.round(n * 0.06) : 0, gap = lost && !down ? Math.max(2, Math.floor(n / lost)) : 1;
  let s = "", miss = 0; for (let k = 0; k < n; k++) { const bad = down || (lost && k % gap === 3 && miss < lost); if (bad) miss++; s += bad ? "." : "!"; }
  return { s, ok: n - miss, miss };
}
function findPeerIf(d, ip) { return d.ifs.find(f => f[8] === ip); }
function jDesc(d) {
  return "Interface       Admin Link Description\n" + d.ifs.map(f => `${f[0].padEnd(15)} ${f[6].padEnd(5)} ${f[5].padEnd(4)} ${descOf(d, f)}`).join("\n");
}
function jPing(d, ip, n) {
  const f = findPeerIf(d, ip); if (!f) return `ping: sendto: No route to host`;
  const p = pingBody(f, +n);
  return `PING ${ip} (${ip}): 56 data bytes\n${p.s}\n--- ${ip} ping statistics ---\n${n} packets transmitted, ${p.ok} packets received, ${Math.round(p.miss / n * 100)}% packet loss` + (p.ok ? "\nround-trip min/avg/max/stddev = 0.7/0.9/2.1/0.3 ms" : "");
}
function iosPing(d, ip, n) {
  const f = findPeerIf(d, ip); if (!f) return "Type escape sequence to abort.\n% No route to host";
  const p = pingBody(f, +n);
  return `Type escape sequence to abort.\nSending ${n}, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:\n${p.s}\nSuccess rate is ${Math.round(p.ok / n * 100)} percent (${p.ok}/${n})` + (p.ok ? ", round-trip min/avg/max = 1/1/3 ms" : "");
}
function logLines(d, style) {   // 이상이 있는 포트의 로그만 만든다 (가상)
  const out = []; let k = 0;
  d.ifs.forEach(f => {
    if (f[6] === "down") out.push({ j: `${logTime(k)} ${d.id} mib2d[1234]: SNMP_TRAP_LINK_DOWN: ifIndex ${500 + k}, ifAdminStatus down(2), ifOperStatus down(2), ifName ${f[0]}`, c: `${logTime(k)}: %LINK-5-CHANGED: Interface ${f[0]}, changed state to administratively down`, h: `Oct 22 2026 ${logTime(k).slice(7)} ${d.id} %%01IFNET/4/LINK_STATE(l)[${k}]:The interface ${f[0]} was shut down by the administrator.` }), k++;
    else if (f[5] === "down") out.push({ j: `${logTime(k)} ${d.id} mib2d[1234]: SNMP_TRAP_LINK_DOWN: ifIndex ${500 + k}, ifAdminStatus up(1), ifOperStatus down(2), ifName ${f[0]}`, c: `${logTime(k)}: %LINK-3-UPDOWN: Interface ${f[0]}, changed state to down`, h: `Oct 22 2026 ${logTime(k).slice(7)} ${d.id} %%01IFNET/4/LINK_STATE(l)[${k}]:The line protocol on the interface ${f[0]} has entered the DOWN state.` }), k++;
    else if (f[3] < -9) out.push({ j: `${logTime(k)} ${d.id} fpc0: ${f[0]}: Optical receive power low alarm`, c: `${logTime(k)}: %OPTICS-4-RX_LOW: ${f[0]} receive power low warning (${f[3].toFixed(1)} dBm)`, h: `Oct 22 2026 ${logTime(k).slice(7)} ${d.id} %%01OPTMOD/4/RX_POWER_LOW(l)[${k}]:${f[0]} RX power is too low.` }), k++;
    if (f[2] > 50) out.push({ j: `${logTime(k)} ${d.id} fpc0: ${f[0]}: input errors increasing (CRC ${f[2]})`, c: `${logTime(k)}: %PM-4-ERR: ${f[0]} CRC errors increasing (${f[2]})`, h: `Oct 22 2026 ${logTime(k).slice(7)} ${d.id} %%01IFPDT/4/CRC_ERR(l)[${k}]:${f[0]} CRC errors ${f[2]}.` }), k++;
  });
  const quiet = style === "j" ? `${logTime(9)} ${d.id} mgd[2201]: UI_CMDLINE_READ_LINE: User 'admin', command 'show log messages'` : style === "c" ? `${logTime(9)}: %SYS-5-CONFIG_I: Configured from console by admin` : `Oct 22 2026 20:59:01 ${d.id} %%01SHELL/5/CMDRECORD(s)[9]:Recorded command information.`;
  return out.map(x => x[style]).concat([quiet]).join("\n");
}
function bgpRows(d) { return d.ifs.filter(f => f[8] && DEV[f[1]]).map(f => ({ ip: f[8], as: asOf(f[1]), down: f[5] === "down" })); }
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
    [/^show interfaces? descriptions?$/i, d => jDesc(d)],
    [/^show interfaces? diagnostics optics \| match (\S+)$/i, (d, m) => { const f = findIf(d, m[1]); return f ? jOptics(f) : `error: device ${m[1]} not found`; }],
    [/^show arp \| match (\S+)$/i, (d, m) => { const f = findIf(d, m[1]); if (!f || f[5] === "down" || !f[8]) return ""; return `MAC Address       Address         Name                      Interface           Flags\n${macOf(f[1])} ${f[8].padEnd(15)} ${f[8].padEnd(25)} ${(f[0] + ".0").padEnd(19)} none\nTotal entries: 1`; }],
    [/^show configuration interfaces (\S+) \| display set$/i, (d, m) => { const f = findIf(d, m[1]); if (!f) return `error: configuration database has no interface ${m[1]}`; return `set interfaces ${f[0]} description "${descOf(d, f)}"\n` + (f[8] ? `set interfaces ${f[0]} unit 0 family inet address ${f[7]}/30` : `set interfaces ${f[0]} unit 0 family ethernet-switching`) + (f[6] === "down" ? `\nset interfaces ${f[0]} disable` : ""); }],
    [/^ping (\S+) rapid count (\d+)$/i, (d, m) => jPing(d, m[1], Math.min(+m[2], 200))],
    [/^show log(?:s)? messages?(?: \| last (\d+))?$/i, d => logLines(d, "j")],
    [/^show bgp summary$/i, d => { const r = bgpRows(d); return `Groups: 1 Peers: ${r.length} Down peers: ${r.filter(x => x.down).length}\nPeer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...\n` + r.map(x => `${x.ip.padEnd(24)} ${String(x.as).padEnd(7)} ${x.down ? "      12          9" : "    5148      23139"}       0 ${x.down ? "    1 00:12:01 Active" : "    0 1d 16:23:28 36/37/37/0"}`).join("\n"); }],
    [/^show route (\S+)$/i, (d, m) => { const f = d.ifs.find(x => x[8] === m[1] || x[7] === m[1]); if (!f || !f[7]) return ""; const net = f[7].replace(/\.\d+$/, ".0"); return `inet.0: 12 destinations, 12 routes (12 active, 0 holddown, 0 hidden)\n+ = Active Route, - = Last Active, * = Both\n\n${net}/30 *[Direct/0] 3d 02:11:04\n                    > via ${f[0]}.0`; }],
    [/^show interfaces? extensive \| (?:match )?"?CRC\|(?:physical interface|xe)"?$/i, d => d.ifs.map(f => `Physical interface: ${f[0]}, Enabled, Physical link is Up\n${jCrc(f)}`).join("\n")]
  ],
  cisco: [
    [/^show interfaces? descriptions?$/i, d => "Interface                      Status         Protocol Description\n" + d.ifs.map(f => `${f[0].padEnd(30)} ${(f[6] === "down" ? "admin-down" : f[5]).padEnd(14)} ${(f[6] === "down" ? "down" : f[5]).padEnd(8)} ${descOf(d, f)}`).join("\n")],
    [/^show interfaces? brief$/i, d => "Intf       Intf        LineP           Encap  MTU    BW\nName       State       State           Type   (byte) (Kbps)\n" + d.ifs.map(f => `${f[0].padEnd(10)} ${(f[6] === "down" ? "admin-down" : f[5]).padEnd(11)} ${(f[6] === "down" ? "down" : f[5]).padEnd(15)} ARPA   1514   10000000`).join("\n")],
    [/^show logging(?: last (\d+))?$/i, d => logLines(d, "c")],
    [/^show running-config interface (\S+)$/i, (d, m) => { const f = findIf(d, m[1]); if (!f) return `% Invalid input detected at '^' marker.`; return `interface ${f[0].replace("Te", "TenGigE")}\n description ${descOf(d, f)}\n` + (f[8] ? ` ipv4 address ${f[7]} 255.255.255.252\n` : "") + (f[6] === "down" ? " shutdown\n" : "") + "!"; }],
    [/^ping (\S+) repeat (\d+)$/i, (d, m) => iosPing(d, m[1], Math.min(+m[2], 200))],
    [/^show bgp summary$/i, d => { const r = bgpRows(d); return `BGP router identifier ${d.id}, local AS number ${asOf(d.id)}\n\nNeighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd\n` + r.map(x => `${x.ip.padEnd(15)}   0 ${String(x.as).padEnd(5)}  ${x.down ? "    12       9" : "  5148   23139"}      100    0    0 ${x.down ? "00:12:01 Active" : "1d16h           37"}`).join("\n"); }],
    [/^show route (\S+)$/i, (d, m) => { const f = d.ifs.find(x => x[8] === m[1] || x[7] === m[1]); if (!f || !f[7]) return "% Network not in table"; const net = f[7].replace(/\.\d+$/, ".0"); return `Routing entry for ${net}/30\n  Known via "connected", distance 0, metric 0 (connected)\n    directly connected, via ${f[0].replace("Te", "TenGigE")}`; }],
    [/^show interfaces? (\S+) \| include CRC$/i, (d, m) => { const f = findIf(d, m[1]); return f ? `     ${f[2]} input errors, ${f[2]} CRC, 0 frame, 0 overrun, 0 ignored` : `% Invalid input detected at '^' marker.`; }]
  ],
  huawei: [
    [/^display interface description$/i, d => "PHY: Physical\n*down: administratively down\nInterface                     PHY      Protocol Description\n" + d.ifs.map(f => `${(f[6] === "down" ? "*" : "") + shortPort(f[0])}`.padEnd(29) + ` ${f[5].padEnd(8)} ${f[5].padEnd(8)} ${descOf(d, f)}`).join("\n")],
    [/^display logbuffer$/i, d => logLines(d, "h")],
    [/^display current-configuration interface (.+)$/i, (d, m) => { const f = findIf(d, m[1].replace(/\s+/g, "")); if (!f) return "Error: Wrong parameter found at '^' position."; return `#\ninterface ${f[0]}\n description ${descOf(d, f)}\n port link-type trunk\n` + (f[6] === "down" ? " shutdown\n" : "") + "#"; }],
    [/^display interface (.+?) \| include CRC$/i, (d, m) => {
      const f = findIf(d, m[1].replace(/\s+/g, "")); if (!f) return "Error: Wrong parameter found at '^' position.";
      return `    CRC: ${f[2]} packets, Giants: 0 packets, Jabbers: 0 packets`;
    }],
    [/^display transceiver interface (.+?) verbose$/i, (d, m) => {
      const f = findIf(d, m[1].replace(/\s+/g, "")); if (!f) return "Error: Wrong parameter found at '^' position.";
      const bad = f[3] < -9;
      return `${f[0]} transceiver information:\n-------------------------------------------------------------\nCommon information:\n  Transceiver Type                      :10G_BASE_LR_SFP\n  Wavelength(nm)                        :1310\n  Transmission Distance(m)              :10000\nDiagnostic information:\n  Temperature(C)                        :39\n  Voltage(V)                            :3.30\n  TX Power(dBm)                         :-2.80\n  RX Power(dBm)                         :${f[3].toFixed(2)}\nAlarm information:\n  ${bad ? "RX power is low (warning)" : "None"}`;
    }]
  ]
};
function findIf(d, name) { return d.ifs.find(f => f[0].toLowerCase() === String(name).toLowerCase()); }
const VENDOR_ERR = { juniper: "                     ^\nunknown command.", cisco: "% Invalid input detected at '^' marker.", huawei: "Error: Unrecognized command found at '^' position." };
const devNow = () => DEV[$("#devSel").value] || DEVICES[0];
function runCmd(raw, dev) {
  const d = dev || devNow(), cmd = raw.trim().replace(/\s+/g, " ");
  if (!cmd) return "";
  if (cmd === "?" || /^help$/i.test(cmd)) return "오른쪽의 '자주 쓰던 명령'을 참고하세요. 장비 종류에 맞는 명령만 동작합니다.";
  for (const [re, fn] of DEV_CMDS[d.vendor]) { const m = cmd.match(re); if (m) return fn(d, m); }
  return VENDOR_ERR[d.vendor];
}
function quickCmds() {
  const d = devNow(), bad = d.ifs.find(f => f[2] > 50 || f[3] < -9) || d.ifs[0], ok = d.ifs[0];
  const pp = d.ifs.find(f => f[8] && f[5] === "up"), ip = pp ? pp[8] : "";
  const list = {
    juniper: [`show interfaces descriptions`, `show interfaces diagnostics optics ${bad[0]}`, `show interfaces extensive ${bad[0]} | match CRC`, `show interfaces extensive | match "CRC|physical interface"`, `show log messages | last 20`, ...(ip ? [`show arp | match ${pp[0]}`, `ping ${ip} rapid count 100`] : []), `show bgp summary`],
    cisco: [`show interfaces description`, `show interfaces brief`, `show interface ${bad[0]} | include CRC`, `show logging last 100`, ...(ip ? [`ping ${ip} repeat 100`] : []), `show bgp summary`],
    huawei: [`display interface description`, `display transceiver interface ${bad[0].replace("XGigabitEthernet", "XGigabitEthernet ")} verbose`, `display interface ${bad[0].replace("XGigabitEthernet", "XGigabitEthernet ")} | include CRC`, `display logbuffer`, `display current-configuration interface ${bad[0]}`]
  }[d.vendor];
  $("#qcmd").innerHTML = [...new Set(list)].map(c => `<button data-c="${esc(c)}">${esc(c)}</button>`).join("");   // 포트가 하나뿐인 장비는 같은 명령이 두 번 나오지 않게
}
const termHist = []; let hp = 0;
function termPrint(html) { const t = $("#termOut"); t.insertAdjacentHTML("beforeend", html); t.scrollTop = t.scrollHeight; }
function termBanner() {
  const d = devNow();
  $("#termOut").innerHTML = `<span class="muted">가상 장비 ${d.id} (${d.vendor} · ${d.role}) 에 연결됨. 실제 장비가 아닙니다.</span>\n`;
  $("#termPrompt").textContent = d.prompt;
  $("#termTarget").textContent = `${d.id} · ${d.rack}`;
  quickCmds();
}
const VENDORS = [["juniper", "Juniper · FS 계열"], ["cisco", "Cisco · FR 계열"], ["huawei", "Huawei · AS 계열"]];
function fillVendors(keep) {   // 센터 선택에 맞는 장비 수를 보여 주고, 장비가 없는 제조사는 고를 수 없게 한다
  const cnt = v => DEVICES.filter(d => d.vendor === v).length;
  $("#vendorSel").innerHTML = VENDORS.map(([v, n]) => `<option value="${v}" ${cnt(v) ? "" : "disabled"}>${n} (${cnt(v)}대)</option>`).join("");
  const pick = keep && cnt(keep) ? keep : (VENDORS.map(x => x[0]).find(v => cnt(v)) || "juniper");
  $("#vendorSel").value = pick; fillDevices(pick);
}
function fillDevices(vendor, keep) {   // 고른 제조사·센터의 장비만 목록에 보여 준다
  const list = DEVICES.filter(d => d.vendor === vendor);
  $("#devSel").innerHTML = list.map(d => `<option value="${d.id}">${d.id} · ${esc(d.role)}</option>`).join("");
  if (keep && list.some(d => d.id === keep)) $("#devSel").value = keep;
}
function selectDevice(devId) {
  const d = DEV[devId]; if (!d) return;
  $("#vendorSel").value = d.vendor; fillDevices(d.vendor, devId); termBanner();
}
// 장비 이름으로 연결: 그 장비를 고르고 자주 쓰는 명령을 채워 둔다
function termConnect(devId) {
  const d = DEV[devId]; if (!d) return;
  $("#vendorSel").value = d.vendor; fillDevices(d.vendor, devId); termBanner();
  const first = $("#qcmd button"); if (first) $("#termIn").value = first.dataset.c;
}
function renderDesign() {
  const name = Object.fromEntries(VENDORS);
  const dv = DEVICES, lk = TOPOLOGY.links;
  $("#designSum").textContent = `장비 ${dv.length}대 (${VENDORS.map(([v, n]) => n.split(" ")[0] + " " + dv.filter(d => d.vendor === v).length).join(", ")}) · 랙 ${DATA.racks.length}개 · 고객사 ${CUSTOMERS.length}곳 · 연결 ${lk.length}건`;
  $("#devTbl").innerHTML = `<tr><th>제조사</th><th>장비</th><th>역할</th><th>센터</th><th>랙</th><th class="n">포트</th></tr>` +
    VENDORS.map(([v]) => DEVICES.filter(d => d.vendor === v).map(d => `<tr class="click" data-dev="${d.id}"><td><span class="tag">${name[v]}</span></td><td>${d.id}</td><td>${esc(d.role)}</td><td>${esc(d.center)}</td><td>${d.rack}</td><td class="n">${d.ifs.length}</td></tr>`).join("")).join("");
  $("#custTbl").innerHTML = `<tr><th>고객사</th><th>접속 장비</th><th>쓰는 회선</th></tr>` + CUSTOMERS.map(c => { const d = DEVICES.find(x => (x.customers || []).includes(c.key)); return `<tr class="click" data-dev="${d.id}"><td>${esc(c.name)}</td><td>${d.id}</td><td class="muted">${c.links.join(", ")}</td></tr>`; }).join("");
  $("#linkTbl").innerHTML = `<tr><th>연결</th><th>A 장비 · 포트</th><th>B 장비 · 포트</th><th>종류</th><th class="n">Gbps</th></tr>` +
    lk.map(l => `<tr class="click" data-dev="${l.a}"><td>${l.link}</td><td>${l.a} ${l.ap}</td><td>${esc(l.b)}${l.bp && l.bp !== "-" ? " " + l.bp : ""}</td><td>${esc(l.kind)}</td><td class="n">${l.gbps}</td></tr>`).join("");
}
function openDeviceTerminal(devId) {   // 랙 안 장비를 누르면 그 장비의 터미널을 새 창으로 연다 (가상)
  if (!DEV[devId]) return;
  const q = new URLSearchParams({ popup: "term", dev: devId });
  const w = window.open(location.pathname + "?" + q.toString(), "term-" + devId, "width=880,height=660");
  if (w) { try { w.focus(); } catch (e) { /* 무시 */ } return; }
  termConnect(devId); showTab("term");   // 팝업이 막히면 같은 화면의 터미널 탭에서 연다
  $("#termTarget").textContent += "  (팝업이 막혀서 이 화면에서 열었습니다)";
}
(function initTerm() {
  fillVendors("juniper");   // 가장 많이 쓰는 Juniper가 기본
  $("#vendorSel").onchange = () => { fillDevices($("#vendorSel").value); termBanner(); };
  $("#devSel").onchange = termBanner;
  ["devTbl", "custTbl", "linkTbl"].forEach(id => $("#" + id).addEventListener("click", ev => { const tr = ev.target.closest("tr.click"); if (tr) { selectDevice(tr.dataset.dev); $("#termIn").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); } }));
  renderDesign();
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

/* ---------- 서버실: 온도 체크 + 육안점검 ---------- */
const ROOM_DEFAULT = { warn: 27, hot: 30, crit: 33, range: 3, step: 12, speed: 1000 };   // 기본 온도 기준은 제가 가정한 값
const cfg = Object.assign({}, ROOM_DEFAULT, store.get("roomCfg", {}));
let TEMP_WARN = cfg.warn, TEMP_HOT = cfg.hot, TEMP_CRIT = cfg.crit;
const RACKS = DATA.racks;
const visibleRacks = () => RACKS.filter(r => inView(r.id));   // 센터 선택에 맞는 랙
const sr = { end: idxOf(parseT("2026-10-22T21:00")) };
const thNow = () => ({ warn: TEMP_WARN, hot: TEMP_HOT, crit: TEMP_CRIT });
const tempCls = t => Lib.tempLevel(t, thNow());
function devState(rack, dv, i) { return Lib.deviceLed(rack.temp[i], dv, msOf(i), thNow()); }
let ROOM_ALERTS = [];
function computeRoomAlerts() { ROOM_ALERTS = Lib.detectRoom(RACKS, thNow()); }
computeRoomAlerts();
function spark(arr, s, e) {
  const w = 160, h = 38, lo = 18, hi = Math.max(36, TEMP_CRIT + 3), X = i => 2 + (i - s) / Math.max(1, e - s) * (w - 4), Y = v => h - 3 - (clamp(v, lo, hi) - lo) / (hi - lo) * (h - 6);
  let d = ""; for (let i = s; i <= e; i++) d += (i === s ? "M" : "L") + X(i).toFixed(1) + "," + Y(arr[i]).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><line x1="0" x2="${w}" y1="${Y(TEMP_HOT)}" y2="${Y(TEMP_HOT)}" stroke="#e5604d" stroke-dasharray="3 3" opacity=".7"/><line x1="0" x2="${w}" y1="${Y(TEMP_WARN)}" y2="${Y(TEMP_WARN)}" stroke="#d9b13b" stroke-dasharray="3 3" opacity=".6"/><path d="${d}" fill="none" stroke="#e5a93d" stroke-width="1.6"/></svg>`;
}
function ledHtml(st) {
  return `<span class="led ${st.power ? "ok" : "off"}" title="전원"></span><span class="led ${st.status} ${st.status === "crit" ? "blink" : ""}" title="상태"></span><span class="led ${st.fan}" title="팬"></span>`;
}
function inspSummary(rack, i) {
  const sts = rack.devices.map(dv => devState(rack, dv, i)), n = k => sts.filter(x => x.status === k).length;
  const off = sts.filter(x => !x.power).length, fan = sts.filter(x => x.fan === "warn").length;
  const parts = [`입구 ${rack.temp[i].toFixed(1)}°C`];
  if (off) parts.push(`전원 꺼짐 ${off}대`);
  if (n("crit") - off > 0) parts.push(`상태 장애 ${n("crit") - off}대`);
  if (n("warn")) parts.push(`상태 주의 ${n("warn")}대`);
  if (fan) parts.push(`팬 주의 ${fan}대`);
  return parts.join(", ");
}
function renderServerRoom() {
  if (!$("#tab-room").classList.contains("on")) return;
  const i = clamp(sr.end, 0, N - 1);
  $("#srTime").value = isoLocal(msOf(i));
  const vr = visibleRacks();
  $("#roomSum").textContent = `${viewLabel()} 서버실 · 랙 ${vr.length}개 · 네트워크 장비 ${vr.reduce((n, r) => n + r.devices.length, 0)}대 (랙 하나에 Cisco 1대 또는 Juniper 최대 2대)`;
  $("#racks").innerHTML = vr.map(r => {
    const t = r.temp[i];
    return `<div class="rack ${tempCls(t)}${HL.has(r.id) ? " hl" : ""}" data-rack="${r.id}"><div class="rhd"><b>${r.id}</b><span class="tmp ${tempCls(t)}">${t.toFixed(1)}°C</span></div>` +
      r.devices.map(dv => `<div class="rdev ${dv.vendor}" data-dev="${dv.id}" role="button" tabindex="0" title="누르면 이 장비의 터미널이 새 창으로 열립니다 (가상)">${ledHtml(devState(r, dv, i))}<span class="sname">${dv.id}</span><span class="role">${dv.vendor === "cisco" ? "Cisco · 랙 전용" : "Juniper"}</span></div>`).join("") +
      spark(r.temp, Math.max(0, i - (cfg.range * 12 - 1)), i) + `<div class="note" style="margin:2px 0 0">최근 ${cfg.range}시간 · 점선 ${TEMP_WARN}/${TEMP_HOT}°C</div></div>`;
  }).join("");
  const visAlerts = ROOM_ALERTS.map((a, k) => ({ a, k })).filter(x => inView(x.a.rack));
  $("#srAlerts").innerHTML = `<tr><th>시각</th><th>랙</th><th class="n">최고 온도</th></tr>` + (visAlerts.length ? visAlerts.map(({ a, k }) =>
    `<tr class="click" data-k="${k}"><td>${md(msOf(a.s))} ~ ${hm(msOf(a.e))}</td><td>${a.rack}</td><td class="n crit-t">${a.max.toFixed(1)}°C</td></tr>`).join("") : `<tr><td colspan="3" class="muted">${viewLabel()}에는 ${TEMP_HOT}°C 이상 기록이 없습니다.</td></tr>`);
  const sel = vr.some(r => r.id === $("#inRack").value) ? $("#inRack").value : vr[0].id;
  $("#inRack").innerHTML = vr.map(r => `<option ${r.id === sel ? "selected" : ""}>${r.id}</option>`).join("");
  const rk = RACKS.find(r => r.id === $("#inRack").value);
  $("#inHint").textContent = `지금 화면 기준: ${inspSummary(rk, i)}`;
  renderInspections();
}
function renderInspections() {
  const v = store.get("inspections", []);
  $("#inspTbl").innerHTML = `<tr><th>화면 시각</th><th>랙</th><th>판정</th><th>점검자</th><th>화면 상태</th><th>메모</th></tr>` + (v.length ?
    v.map(r => `<tr><td>${esc(r.at)}</td><td>${esc(r.rack)}</td><td><span class="tag ${r.result === "이상 없음" ? "ok" : "crit"}">${esc(r.result)}</span></td><td>${esc(r.who)}</td><td>${esc(r.summary)}</td><td>${esc(r.memo)}</td></tr>`).join("") :
    `<tr><td colspan="6" class="muted">아직 점검 기록이 없습니다.</td></tr>`);
}
(function initRoom() {
  $("#srTime").addEventListener("change", e => { if (e.target.value) { sr.end = idxOf(parseT(e.target.value)); renderServerRoom(); } });
  $("#srPrev").onclick = () => { sr.end -= cfg.step; renderServerRoom(); };
  $("#srNext").onclick = () => { sr.end += cfg.step; renderServerRoom(); };
  $$("[data-sr]").forEach(b => b.onclick = () => {
    sr.end = idxOf(parseT(b.dataset.sr));
    if (b.dataset.center && view.center !== "ALL" && view.center !== b.dataset.center) setCenter(b.dataset.center);   // 그 사건이 있는 센터가 안 보이면 센터를 맞춘다
    renderServerRoom();
  });
  $("#srAlerts").addEventListener("click", ev => { const tr = ev.target.closest("tr.click"); if (tr) { sr.end = ROOM_ALERTS[+tr.dataset.k].peak; renderServerRoom(); } });
  $("#inRack").addEventListener("change", renderServerRoom);
  $("#racks").addEventListener("click", ev => { const el = ev.target.closest(".rdev"); if (el) openDeviceTerminal(el.dataset.dev); });
  $("#racks").addEventListener("keydown", ev => { if (ev.key === "Enter") { const el = ev.target.closest(".rdev"); if (el) openDeviceTerminal(el.dataset.dev); } });
  $("#srFrom").min = $("#srTo").min = MIN_DAY; $("#srFrom").max = $("#srTo").max = MAX_DAY;
  $("#srFrom").value = MIN_DAY; $("#srTo").value = MAX_DAY;
  $("#srTempCsv").onclick = () => {
    const a = clamp(idxOf(parseT($("#srFrom").value + "T00:00")), 0, N - 1), b = clamp(idxOf(parseT($("#srTo").value + "T23:55")), a, N - 1);
    const rows = ["time,rack,inlet_c"];
    for (let i = a; i <= b; i++) visibleRacks().forEach(r => rows.push(`${ymdhm(msOf(i))},${r.id},${r.temp[i]}`));
    downloadCsv(`rack_temps_${view.center}_${$("#srFrom").value}_${$("#srTo").value}.csv`, rows.join("\n"));
  };
  $("#srSheetCsv").onclick = () => {
    const i = clamp(sr.end, 0, N - 1), rows = ["time,rack,device,vendor,inlet_c,power,status,fan"];
    const lab = { ok: "정상", warn: "주의", crit: "장애", off: "꺼짐" };
    visibleRacks().forEach(r => r.devices.forEach(dv => { const st = devState(r, dv, i); rows.push(`${ymdhm(msOf(i))},${r.id},${dv.id},${dv.vendor},${r.temp[i]},${st.power ? "켜짐" : "꺼짐"},${lab[st.status]},${lab[st.fan]}`); }));
    downloadCsv(`inspection_sheet_${view.center}_${fileStamp(msOf(i))}.csv`, rows.join("\n"));
  };
  $("#inAdd").onclick = () => {
    const i = clamp(sr.end, 0, N - 1), rack = $("#inRack").value, rk = RACKS.find(r => r.id === rack);
    const rec = { at: ymdhm(msOf(i)), rack, result: $("#inResult").value, who: $("#inWho").value.trim() || "관제 담당", memo: $("#inMemo").value.trim(), summary: inspSummary(rk, i) };
    store.set("inspections", store.get("inspections", []).concat([rec])); $("#inMemo").value = ""; renderInspections(); renderTasks();
  };
  $("#inCsv").onclick = () => {
    const v = store.get("inspections", []), q = x => `"${String(x).replace(/"/g, '""')}"`;
    downloadCsv("inspection_log.csv", ["screen_time,rack,result,inspector,screen_state,memo"].concat(v.map(r => [r.at, r.rack, r.result, r.who, r.summary, r.memo].map(q).join(","))).join("\n"));
  };
})();

/* ---------- 서버실 설정 패널 ---------- */
let playTimer = null;
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } const b = $("#srPlay"); if (b) b.textContent = "▶ 재생"; }
function startPlay() {
  stopPlay(); $("#srPlay").textContent = "⏸ 정지";
  playTimer = setInterval(() => { if (sr.end >= N - 1) { stopPlay(); return; } sr.end += 1; renderServerRoom(); }, cfg.speed);   // 한 번에 5분씩 흐른다
}
const stepLabel = n => ({ 1: "5분", 12: "1시간", 72: "6시간" }[n] || `${n * 5}분`);
function applyRoomCfg(save) {
  TEMP_WARN = cfg.warn; TEMP_HOT = cfg.hot; TEMP_CRIT = cfg.crit; computeRoomAlerts();
  $("#cfgWarn").value = cfg.warn; $("#cfgHot").value = cfg.hot; $("#cfgCrit").value = cfg.crit;
  $("#cfgRange").value = cfg.range; $("#cfgStep").value = cfg.step; $("#cfgSpeed").value = cfg.speed;
  $("#srPrev").textContent = `\u2039 이전 ${stepLabel(cfg.step)}`; $("#srNext").textContent = `다음 ${stepLabel(cfg.step)} \u203A`;
  $("#srHot").textContent = TEMP_HOT;
  if (save) store.set("roomCfg", cfg);
  renderServerRoom(); renderTasks();
}
(function initRoomCfg() {
  $("#cfgToggle").onclick = () => { const p = $("#cfgPanel"); p.hidden = !p.hidden; $("#cfgToggle").textContent = p.hidden ? "⚙ 설정" : "⚙ 설정 닫기"; };
  $("#srPlay").onclick = () => { if (playTimer) stopPlay(); else startPlay(); };
  ["cfgWarn", "cfgHot", "cfgCrit", "cfgRange", "cfgStep", "cfgSpeed"].forEach(id => $("#" + id).addEventListener("change", () => {
    const w = +$("#cfgWarn").value, h = +$("#cfgHot").value, c = +$("#cfgCrit").value;
    if (!(w < h && h < c)) { $("#cfgMsg").textContent = "온도는 주의 < 경고 < 위험 순서로 입력하세요. (반영되지 않았습니다)"; return; }
    $("#cfgMsg").textContent = "";
    Object.assign(cfg, { warn: w, hot: h, crit: c, range: +$("#cfgRange").value, step: +$("#cfgStep").value, speed: +$("#cfgSpeed").value });
    applyRoomCfg(true); if (playTimer) startPlay();
  }));
  $("#cfgReset").onclick = () => { Object.assign(cfg, ROOM_DEFAULT); $("#cfgMsg").textContent = ""; applyRoomCfg(true); if (playTimer) startPlay(); };
  applyRoomCfg(false);
})();

/* ---------- 공통 센터 선택: 모든 화면이 같은 센터로 맞춰진다 ---------- */
const syncHdr = () => document.documentElement.style.setProperty("--hdr", $("header.top").offsetHeight + "px");   // 안내 막대를 헤더 아래에 붙여 두려고
function renderCenterBar() {
  const names = TOPOLOGY.centers, inRoom = $("#tab-room").classList.contains("on") || $("#tab-room3d").classList.contains("on");
  const stat = c => { const rs = RACKS.filter(r => c === "ALL" || codeOf(r.id) === c); return `랙 ${rs.length} · 장비 ${rs.reduce((n, r) => n + r.devices.length, 0)}`; };   // 서버실에서만 보여 준다
  $("#centerBar").innerHTML = `<span class="muted">센터</span>` + ["ALL", ...Object.keys(names)].map(c =>
    `<button class="cbtn${view.center === c ? " on" : ""}" data-center="${c}" title="${c === "ALL" ? "모든 센터" : names[c]}">${c === "ALL" ? "전체" : names[c]}${inRoom ? `<small>${stat(c)}</small>` : ""}</button>`).join("");
  syncHdr();
}
function setCenter(code, persist = true) {
  view.center = code; if (persist) store.set("center", code);
  renderCenterBar(); renderAll(); renderServerRoom(); if (typeof render3d === "function") render3d();
}
$("#centerBar").addEventListener("click", e => { const b = e.target.closest("[data-center]"); if (b) setCenter(b.dataset.center); });
renderCenterBar();

/* ---------- 시나리오: 몇 초 안에 상황이 흘러가고 조치까지 보여 주는 안내 재생 ---------- */
// 현재(가상 10/22 21:00)로 돌아가기: 1시간 창, 전체 고객사, 서버실도 같은 시각
function goNow() {
  state.end = NOW_IDX; state.win = 12; state.ymode = "cap"; state.cust = "all";
  $("#win").value = "12"; $("#ymode").value = "cap"; $("#cust").value = "all";
  HL.clear(); sr.end = NOW_IDX; setCenter("ALL");
}
const SCN_TICK = 180, SCN_HOLD = 8;   // 5분씩 0.18초, 단계가 나오면 약 1.4초 멈춤
const KIND_CLS = { 감지: "crit", 확인: "", 조치: "warn", 결과: "ok" };
const isoIdx = t => idxOf(parseT(t));
const hhmm = i => hm(msOf(i));
const g1 = v => v.toFixed(1);
const outAt = (id, t) => LINK[id].out[isoIdx(t)], inAt = (id, t) => LINK[id].in[isoIdx(t)];
const utilAt = (id, t) => outAt(id, t) / LINK[id].cap * 100;
const prevDay = t => isoLocal(parseT(t) - 86400000);
const runOn = (devId, cmd, down) => {   // down: 이 시나리오에서 Down이라고 가정할 포트 이름들 (실행 뒤 원래대로 되돌린다)
  const d = DEV[devId], saved = [];
  (down || []).forEach(p => { const f = findIf(d, p); if (f) { saved.push([f, f.slice()]); f[5] = "down"; f[3] = -40; f[2] = 0; } });
  try { return `${d.prompt} ${cmd}\n${runCmd(cmd, d)}`; } finally { saved.forEach(([f, o]) => o.forEach((v, k) => { f[k] = v; })); }
};

// 숫자는 전부 데이터에서 읽어 문장을 만든다 (고정 문구 아님)
function buildScenarios() {
  const TD = Lib.TEMP_DEFAULTS;
  const OA = "IDC_B_FS1_UP1", OB = "IDC_B_FS1_UP2", IX = "IDC_B_FS2_IX1", INTL = "IDC_B_FS2_INTL1", EDGE = "IDC_B_FS2";   // 아래에서 새 이름으로 바뀐다

  // 1) 평일 오후 7시: 평소 점검
  const calmFrom = "2026-10-22T18:30", c2 = "2026-10-22T18:45", c3 = "2026-10-22T19:00", c4 = "2026-10-22T19:30";
  const maxU = t => Math.max(...LINKS.map(l => l.out[isoIdx(t)] / l.cap)) * 100;
  const maxT = t => Math.max(...RACKS.map(r => r.temp[isoIdx(t)]));
  const fans = RACKS.flatMap(r => r.devices.filter(dv => dv.fanWarn).map(dv => dv.id));
  const near = ALERTS.filter(a => Math.abs(a.s - isoIdx(c4)) <= 12).length + Lib.detectRoom(RACKS, TD).filter(a => Math.abs(a.s - isoIdx(c4)) <= 12).length;
  const calm = { name: "평일 오후 7시", tab: "monitor", win: 12, from: calmFrom, to: "2026-10-22T19:40", steps: [
    { at: calmFrom, kind: "확인", title: `그래프 8개 확인: 가장 높은 사용률 ${maxU(calmFrom).toFixed(0)}% (경고선 80% 아래)`, focus: LINKS.map(l => l.id) },
    { at: c2, kind: "확인", title: `서버실 확인: 랙 입구 온도 최고 ${g1(maxT(c2))}°C (주의 기준 ${TD.warn}°C 아래), LED 정상${fans.length ? `, 팬 주의 ${fans.join(", ")}(교체 대기)` : ""}` },
    { at: c3, kind: "확인", title: `저녁 피크로 올라가는 중: ${OA} out ${g1(outAt(OA, calmFrom))}G → ${g1(outAt(OA, c3))}G, 평소 범위`, focus: [OA] },
    { at: c4, kind: "결과", title: `이상 없음: 이 시각 전후 새 경고 ${near}건. 점검 기록을 남기고 다음 점검으로`, focus: [] }
  ] };

  const INQUIRY = "\n\n[연동망에 문의할 때 확인할 3가지]\n가. NOC 작업 유/무\n나. 연동 구간(타 부서·타 ISP) 작업 및 이슈 유/무\n다. 보안 관련 이슈 유/무\n* 전화로 내용을 전달받을 때는 통화한 분의 성함을 꼭 확인해서 기록한다.";
  // 2) 트래픽 급감: 국내 연동(IX)
  const dropA = ALERTS.find(a => a.link === IX && a.kind.includes("급감"));
  const dt = m => isoLocal(msOf(dropA.s) + m * 60000);   // 급감이 시작된 시각 기준 분
  const pct = (outAt(IX, dt(0)) / outAt(IX, prevDay(dt(0))) * 100).toFixed(0);
  const ixCust = CUSTOMERS.find(c => c.links.includes(IX)).name;
  const dropMail = `제목: [안내] 국내 연동(IX) 트래픽 감소 확인 중\n\n${ixCust} 담당자님, 안녕하세요.\n${hhmm(dropA.s)}부터 국내 연동(IX) 트래픽이 평소의 ${pct}% 수준으로 줄어든 것을 확인했습니다.\n현재 일부 트래픽은 해외 연동으로 우회되어 서비스는 유지되고 있습니다.\n상대 사업자에 확인을 요청했고, 진행 상황은 다시 안내드리겠습니다. (가상 메일)`;
  const drop = { name: "트래픽 급감", tab: "monitor", win: 12, from: dt(-20), to: dt(60), steps: [
    { at: dt(0), kind: "감지", title: `${IX}(국내 연동) out이 전날 같은 시각 ${g1(outAt(IX, prevDay(dt(0))))}G에서 ${g1(outAt(IX, dt(0)))}G로 급감 (평소의 ${pct}%). 종 알림에 '확인 필요'로 등록`, focus: [IX] },
    { at: dt(5), kind: "확인", title: `같은 시각 ${INTL}(해외 연동) out ${g1(outAt(INTL, dt(-5)))}G → ${g1(outAt(INTL, dt(5)))}G로 증가: 빠진 트래픽 일부가 해외 회선으로 우회 중으로 보임`, focus: [IX, INTL] },
    { at: dt(10), kind: "조치", title: `${EDGE}에서 ${IX} 포트(xe-0/0/2) 광값 확인`, detail: runOn(EDGE, "show interfaces diagnostics optics xe-0/0/2") + "\n\n→ 광 수신값이 정상 범위. 우리 쪽 광 문제는 아님", sum: `광 수신 ${DEV[EDGE].ifs.find(x => x[0] === "xe-0/0/2")[3].toFixed(2)} dBm, 알람 없음 → 정상. 우리 쪽 광 문제는 아님`, detailLabel: "터미널 출력 보기", focus: [IX] },
    { at: dt(15), kind: "조치", title: `상대 IX 사업자에 확인 요청, 영향 고객사(${ixCust})에 상황 안내`, detail: dropMail + INQUIRY, detailLabel: "고객사 안내 메일·연동망 문의 항목 보기" },
    { at: dt(50), kind: "결과", title: `${IX} 회복: out ${g1(outAt(IX, dt(50)))}G (전날 같은 시각 ${g1(outAt(IX, prevDay(dt(50))))}G). 급감 구간 ${hhmm(dropA.s)}~${hhmm(dropA.e)} (${(dropA.e - dropA.s + 1) * 5}분)`, focus: [IX, INTL] },
    { at: dt(55), kind: "결과", title: "복구 안내 메일 발송, 경고 이력에 기록하고 마무리", focus: [IX] }
  ] };

  // 2-2) 업링크 회선 다운: 안산 -> 중앙 백본 (업무 메모의 장애 대응 순서를 일반화한 것)
  const DN = "IDC_A_FS1_UP1", dnA = ALERTS.find(a => a.link === DN && a.kind.includes("급감")), dn = m => isoLocal(msOf(dnA.s) + m * 60000);
  const dlk = TOPOLOGY.links.find(l => l.link === DN), dDev = dlk.a, dPort = dlk.ap, dPeerIp = DEV[dDev].ifs.find(x => x[0] === dPort)[8];
  const dnBefore = outAt(DN, dn(-5)), dnAfter = outAt(DN, dn(5)), dnCust = custOf(DN);
  const dnWin = (dnA.e - dnA.s + 1) * 5;
  const dnSms = `[장애] ${dnCust.join(", ")} 담당자님, ${hhmm(dnA.s)}부터 안산 ↔ 중앙 백본 업링크(${DN})가 끊겨 확인 중입니다. 우회 경로로 서비스는 유지되고 있으며 경과는 다시 안내드리겠습니다. (가상 문자)`;
  const linkDown = { name: "업링크 회선 다운", tab: "monitor", win: 12, from: dn(-20), to: dn(dnWin + 15), steps: [
    { at: dn(0), kind: "감지", title: `${DN} in·out이 거의 0으로 떨어짐 (전날 같은 시각 out ${g1(outAt(DN, prevDay(dn(0))))}G → ${g1(outAt(DN, dn(0)))}G). 종 알림에 '확인 필요'로 등록`, focus: [DN] },
    { at: dn(3), kind: "확인", title: `정확한 장비·회선명 확인: ${dDev} ${dPort}. descriptions로 보면 Admin up / Link down`, detail: runOn(dDev, "show interfaces descriptions", [dPort]) + "\n\n→ Admin = 관리자가 켜 둔 상태, Link = 실제 연결 상태.\n   Admin up + Link down: 누가 일부러 내린 게 아니라 선이나 상대 쪽 문제로 끊긴 것.\n   (Admin down이면 누군가 포트를 일부러 내려 둔 것)\n고객사 이름도 같은 줄에서 같이 보인다.", sum: "Admin up, Link down → 실제 연결이 끊긴 것. 고객사도 확인", detailLabel: "터미널 출력 보기", focus: [DN] },
    { at: dn(5), kind: "확인", title: `트래픽(전/후) 확인: Down이면 5분 전 값만 보고 이후는 0 (OUT 기준)`, detail: `■ 트래픽(전/후)\n${DN} : ${g1(dnBefore)}Gbps / ${dnAfter < 0.5 ? "0" : g1(dnAfter) + "Gbps"}\n\n* 경과 문자가 나가기 전에 트래픽을 먼저 전달해야 하므로 빠르게 확인한다.`, detailLabel: "경과 문자에 넣을 트래픽 보기", focus: [DN] },
    { at: dn(7), kind: "조치", title: `발생 문자 전송, 영향 고객사(${dnCust.join(", ")})에 안내`, detail: dnSms, detailLabel: "발생 문자 보기", focus: [DN] },
    { at: dn(10), kind: "조치", title: "광값·CRC 확인: 빛이 안 들어옴 (광 케이블 접촉 불량이나 SFP 불량이 많음)", detail: runOn(dDev, `show interfaces diagnostics optics ${dPort}`, [dPort]) + "\n\n" + runOn(dDev, `show interfaces extensive ${dPort} | match CRC`, [dPort]) + "\n\n→ 수신 광값이 -40 dBm이면 빛이 안 들어오는 것. 케이블·SFP·상대 장비 쪽을 의심한다.", sum: `광 수신 -40 dBm → 빛이 안 들어옴 (케이블·SFP 의심)`, detailLabel: "터미널 출력 보기", focus: [DN] },
    { at: dn(13), kind: "조치", title: "IP 확인과 ping: ARP가 없고 ping 100% 손실", detail: runOn(dDev, `show arp | match ${dPort}`, [dPort]) + "(출력 없음: 링크가 Down이면 ARP 항목이 없다)\n\n" + runOn(dDev, `ping ${dPeerIp} rapid count 100`, [dPort]) + "\n\n* L2 장비는 IP가 안 나오므로 MAC 주소로 찾는다.", sum: "ARP 없음, ping 100% 손실 → 상대 쪽까지 안 닿음", detailLabel: "터미널 출력 보기", focus: [DN] },
    { at: dn(16), kind: "조치", title: "연동망(상대 센터)에 문의 후 조장에게 전달", detail: "[연동망에 문의할 때 확인할 3가지]\n가. NOC 작업 유/무\n나. 연동 구간(타 부서·타 ISP) 작업 및 이슈 유/무\n다. 보안 관련 이슈 유/무\n\n* 통화한 분의 성함을 확인해서 기록하고, 경과나 원인을 알게 되면 바로바로 전달한다.\n* 확인한 내용(트래픽 전/후, 광값, CRC, ping 결과)은 조장에게 함께 전달한다.", detailLabel: "문의 항목 보기", focus: [DN] },
    { at: dn(dnWin), kind: "결과", title: `${DN} 회복: out ${g1(outAt(DN, dn(dnWin)))}G (다운 구간 ${hhmm(dnA.s)}~${hhmm(dnA.e)}, ${dnWin}분). 경과 문자 발송, 조장에게 결과 전달`, focus: [DN] }
  ] };

  // 3) 트래픽 폭주: 월드컵 8강
  const ev = DATA.events.find(e => e.name.includes("8강")), cc = evCalc(ev);
  const kt = m => isoLocal(parseT(ev.start) + m * 60000);   // 킥오프 기준 분
  const A = cc.rows.find(r => r.l.id === OA), mv = cc.moves.find(m => m.r.l.id === OA);
  let pk = cc.s; for (let i = cc.s; i <= cc.e; i++) if (LINK[OA].out[i] > LINK[OA].out[pk]) pk = i;
  const surge = { name: "트래픽 폭주", tab: "monitor", win: 36, from: kt(-30), to: kt(130), steps: [
    { at: kt(-30), kind: "조치", title: `사전 연락(전날 발송)한 통보문대로 고객사에 '이쪽으로 보내겠습니다' 안내 완료 (${ev.name})`, detail: evNoticeText(ev, cc), detailLabel: "고객사 통보문 보기", focus: ev.links },
    { at: kt(-15), kind: "조치", title: mv ? `분산 시작: ${OA} 예상 ${A.exp.toFixed(0)}G(${(A.util * 100).toFixed(0)}%) → 약 ${Math.max(1, Math.ceil(mv.need))}G를 ${mv.best ? mv.best.c.l.id : "여유 회선"}로 보냄` : "분산이 필요한 링크 없음, 모니터링만", focus: [OA, OB] },
    { at: kt(0), kind: "확인", title: `킥오프: ${OA} ${utilAt(OA, kt(0)).toFixed(0)}%에서 올라가는 중`, focus: ev.links },
    { at: kt(25), kind: "확인", title: `하이드레이션 타임: ${OA} ${g1(outAt(OA, kt(20)))}G → ${g1(outAt(OA, kt(25)))}G로 잠깐 감소. 급감이 아니라 경기 일정으로 설명되는 하락`, focus: [OA] },
    { at: isoLocal(msOf(pk)), kind: "감지", title: `${OA} 최고 ${(LINK[OA].out[pk] / LINK[OA].cap * 100).toFixed(0)}% (${g1(LINK[OA].out[pk])}G): 경고선 80% 도달. 분산 상태와 고객사 영향을 집중 확인`, focus: [OA] },
    { at: kt(115), kind: "확인", title: `경기 종료: 트래픽이 급락하는 것은 정상 (${g1(outAt(OA, kt(110)))}G → ${g1(outAt(OA, kt(120)))}G)`, focus: [OA] },
    { at: kt(125), kind: "결과", title: `사후 정리: ${OA} 예상 ${A.exp.toFixed(0)}G, 실제 최대 ${A.act.toFixed(0)}G (${((A.act / A.exp - 1) * 100).toFixed(0)}%). 다음에는 배율을 ×${(1 + (A.act - A.base) / refPeak(A.l)).toFixed(1)}로`, focus: [] }
  ] };

  // 4) 서버실 온도 변화: IDC_B_R07 냉각 이상
  const COOL = "IDC_B_R07", R3 = RACKS.find(r => r.id === COOL), al = Lib.detectRoom(RACKS, TD).find(a => a.rack === COOL);
  const fc = R3.temp.findIndex((t, i) => i >= al.s && t >= TD.crit), dv = R3.devices.find(x => x.downStart);
  const dMs = parseT(dv.downStart), tAt = i => g1(R3.temp[i]);
  const lk = TOPOLOGY.links.find(l => l.b === dv.id && DEV[l.a]), peer = DEV[lk.a], pif = peer.ifs.find(x => x[0] === lk.ap);   // 꺼진 장비와 이어진 상대 쪽 포트
  const temp = { name: "서버실 온도 변화", tab: "room", center: "B", from: "2026-10-26T14:30", to: "2026-10-26T17:20", steps: [
    { at: isoLocal(msOf(al.s)), kind: "감지", title: `${COOL} 입구 온도 ${TD.hot}°C 이상 (${tAt(al.s)}°C): 온도 경고 등록`, focus: [COOL] },
    { at: isoLocal(msOf(fc)), kind: "감지", title: `${TD.crit}°C 이상 (${tAt(fc)}°C): 장비 LED 상태가 빨강 깜박임`, focus: [COOL] },
    { at: isoLocal(msOf(fc) + 15 * 60000), kind: "조치", title: "냉각기 점검 요청(티켓)과 육안점검 요청", focus: [COOL] },
    { at: isoLocal(dMs), kind: "감지", title: `${dv.id} 과열로 꺼짐 (전원 LED 꺼짐)`, focus: [COOL] },
    { at: isoLocal(dMs + 10 * 60000), kind: "조치", title: `터미널로 ${dv.id}와 이어진 ${peer.id} 포트(${lk.ap}) 확인: 빛이 안 들어와서 ${dv.id}이 꺼진 것으로 확인`, detail: runOn(peer.id, `show interfaces diagnostics optics ${lk.ap}`), sum: `광 수신 ${pif[3].toFixed(2)} dBm, 수신 낮음 알람 켜짐 → 빛이 안 들어옴`, detailLabel: "터미널 출력 보기", focus: [COOL] },
    { at: isoLocal(msOf(al.e) + 5 * 60000), kind: "확인", title: `냉각 복구: ${TD.hot}°C 아래로 내려옴 (${tAt(al.e + 1)}°C)`, focus: [COOL] },
    { at: "2026-10-26T17:15", kind: "결과", title: `복구 완료 (${tAt(isoIdx("2026-10-26T17:15"))}°C). 육안점검 기록 남김: ${COOL} 이상 있음 → 정상 복귀`, focus: [COOL] }
  ] };

  return { calm, drop, linkDown, surge, temp };
}
const SCN_LIST = [["calm", "평일 오후 7시", "저녁 피크 전 평소 점검 (이상 없음)"], ["drop", "트래픽 급감", "국내 연동(IX)이 갑자기 빠짐: 원인 확인과 조치"], ["linkDown", "업링크 회선 다운", "안산 업링크 Down: 회선·트래픽·광값·ping·연동망 문의 순서"], ["surge", "트래픽 폭주", "월드컵 8강: 사전 연락·분산·모니터링"], ["temp", "서버실 온도 변화", "분당 IDC_B_R07 냉각 이상: 육안점검·터미널 확인·복구"]];
let scn = null;
function stopScn() { if (scn && scn.timer) clearInterval(scn.timer); scn = null; HL.clear(); }
function scnSetView() {
  if (scn.def.tab === "monitor") { state.end = scn.idx; renderAll(); } else { sr.end = scn.idx; renderServerRoom(); }
  if (scn.reveal) {   // 강조된 그래프가 막대에 가리거나 화면 밖이면 보이는 곳으로 스크롤
    scn.reveal = false;
    const el = $(scn.def.tab === "monitor" ? ".panel.hl" : ".rack.hl");
    if (el) { const r = el.getBoundingClientRect(), top = $("#scnBar").getBoundingClientRect().bottom; if (r.top < top || r.bottom > innerHeight) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
}
function scnShowDue() {
  const due = scn.steps.filter(st => !st.shown && st.i <= scn.idx);
  due.forEach(st => { st.shown = true; scn.done.push(st); if (st.focus) { HL.clear(); st.focus.forEach(f => HL.add(f)); scn.reveal = true; } });
  if (due.length) { scn.hold = SCN_HOLD; scnRenderSteps(); }
}
function scnProgress() {
  $("#scnTime").textContent = ymdhm(msOf(scn.idx));
  $("#scnProg").style.width = (scn.finished ? 100 : (scn.idx - scn.i0) / Math.max(1, scn.i1 - scn.i0) * 100) + "%";
  $("#scnTitle").textContent = `시나리오 · ${scn.def.name}${scn.finished ? " (끝)" : ""}`;
  $("#scnPause").textContent = scn.paused ? "계속" : "일시정지"; $("#scnPause").disabled = scn.finished;
}
function scnRenderSteps() {
  const last = scn.done.length - 1;
  $("#scnSteps").innerHTML = scn.done.map((st, k) => `<li class="${k === last && !scn.finished ? "cur" : ""}"><span class="tag ${KIND_CLS[st.kind]}">${st.kind}</span> <b class="mono">${hhmm(st.i)}</b> ${esc(st.title)}${st.sum ? `<span class="muted"> → ${esc(st.sum)}</span>` : ""}${st.detail ? `<details><summary>${esc(st.detailLabel || "자세히")}</summary><pre>${esc(st.detail)}</pre></details>` : ""}</li>`).join("");
  const ul = $("#scnSteps"); ul.scrollTop = ul.scrollHeight;
}
function scnFinish() { scn.finished = true; clearInterval(scn.timer); scn.timer = null; scnProgress(); scnRenderSteps(); }
function scnTick() {
  if (!scn || scn.paused || scn.finished) return;
  if (scn.hold > 0) { scn.hold--; return; }
  if (scn.idx >= scn.i1) { scnFinish(); return; }
  scn.idx++; scnShowDue(); scnSetView(); scnProgress();
}
function startScn(id) {
  stopScn();
  const def = buildScenarios()[id];
  const steps = def.steps.map(st => Object.assign({ i: isoIdx(st.at), shown: false }, st)).sort((a, b) => a.i - b.i);
  scn = { def, steps, i0: isoIdx(def.from), i1: isoIdx(def.to), idx: isoIdx(def.from), done: [], hold: 0, paused: false, finished: false, timer: null };
  state.cust = "all"; $("#cust").value = "all"; state.ymode = "cap"; $("#ymode").value = "cap";
  setCenter(def.center || "ALL", false);   // 시나리오가 보여 줄 센터 (선택값은 저장하지 않음)
  if (def.win) { state.win = def.win; $("#win").value = String(def.win); }
  showTab(def.tab);
  $("#scnBar").hidden = false; $("#scnSteps").innerHTML = "";
  scnShowDue(); scnSetView(); scnProgress();
  scn.timer = setInterval(scnTick, SCN_TICK);
}
(function initScn() {
  const menu = $("#scnMenu"), btn = $("#scnBtn");
  menu.innerHTML = SCN_LIST.map(([id, name, desc]) => `<button data-scn="${id}">${name}<small>${desc}</small></button>`).join("");
  const closeMenu = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", e => { e.stopPropagation(); if (menu.hidden) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); } else closeMenu(); });
  menu.addEventListener("click", e => { const b = e.target.closest("[data-scn]"); if (b) { closeMenu(); startScn(b.dataset.scn); } });
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  $("#scnPause").onclick = () => { if (scn && !scn.finished) { scn.paused = !scn.paused; scnProgress(); } };
  $("#scnSkip").onclick = () => { if (!scn || scn.finished) return; scn.idx = scn.i1; scn.hold = 0; scnShowDue(); scnSetView(); scnFinish(); };
  $("#scnClose").onclick = () => { stopScn(); $("#scnBar").hidden = true; showTab("monitor"); goNow(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  syncHdr(); window.addEventListener("resize", syncHdr);
})();

/* ---------- 서버실-3D 공용: 포트 배치, 장비 상세(포트·광케이블). 3D 화면 자체는 room3d.js ---------- */
// 랙·장비의 크기(Cisco 21U, Juniper 6U, Huawei 2U)와 포트 배치는 제가 만든 가상 그림입니다.
const R3 = { dev: null, port: null };   // 장비 상세(포트·광케이블) 창의 상태
const RACK_U = 42, DEV_U = { cisco: 21, juniper: 6, huawei: 2 }, ROW_N = 8;   // 장비 높이는 제가 만든 가정
const portIdx = (d, name) => { const m = String(name).match(/(\d+)\/(\d+)\/(\d+)$/); return m ? (+m[2] - (d.vendor === "huawei" ? 1 : 0)) * 48 + (+m[3]) : -1; };
const portBad = f => f[2] > 50 || f[3] < -9;
function portPlan(d) {   // 포트 번호 -> 연결 정보. 포트는 위아래 2줄, 왼쪽부터 번호순으로 배치
  const mx = Math.max(0, ...d.ifs.map(f => portIdx(d, f[0])));
  const total = d.vendor === "cisco" ? Math.max(48, Math.ceil((mx + 1) / 12) * 12) : (mx > 23 ? 48 : 24);
  return { total, cols: total / 2, map: new Map(d.ifs.map(f => [portIdx(d, f[0]), f])) };
}
/* 장비 상세: 포트 배치와 꽂혀 있는 광케이블 (위줄 포트의 케이블은 위로, 아래줄은 아래로) */
function r3Detail() {
  const d = DEV[R3.dev], rack = RACKS.find(r => r.id === d.rack), i = clamp(sr.end, 0, N - 1), dv = rack.devices.find(x => x.id === d.id), st = devState(rack, dv, i);
  const pl = portPlan(d), PX = 26, PAD = 20, CARD = d.vendor === "cisco" ? 6 : 0, GAPW = 16, ZONE = 150, HEAD = 26;
  const colX = c => PAD + c * PX + (CARD ? Math.floor(c / CARD) * GAPW : 0);
  const W = colX(pl.cols - 1) + PX + PAD, plateH = HEAD + 2 * 30 + PAD, H = ZONE * 2 + plateH;
  const pos = k => ({ x: colX(Math.floor(k / 2)) + 10, row: k % 2, y: ZONE + HEAD + (k % 2) * 30 });
  const used = [...pl.map.keys()].sort((a, b) => a - b);
  const sel = R3.port != null && pl.map.has(R3.port) ? R3.port : null;
  const peerOf = f => { const lk = f[4]; return { dev: f[1], port: lk ? (lk.a === d.id ? lk.bp : lk.ap) : "", kind: lk ? lk.kind : "", gbps: lk ? lk.gbps : "" }; };
  let svg = "", tags = "", plate = "";
  for (let k = 0; k < pl.total; k++) { const p = pos(k), f = pl.map.get(k);
    plate += `<button class="pt${f ? (portBad(f) ? " x" : " u") : ""}${k === sel ? " sel" : ""}" data-i="${k}" style="left:${p.x - 10}px;top:${p.y}px" title="포트 ${k}${f ? " → " + f[1] : " (비어 있음)"}">${k}</button>`; }
  [0, 1].forEach(rw => {   // rw 0 = 위줄(케이블 위로), 1 = 아래줄(케이블 아래로)
    const mine = used.filter(k => k % 2 === rw);
    const want = mine.filter(k => k === sel || portBad(pl.map.get(k)));
    (mine.length <= 6 ? mine : want).forEach(k => { if (!want.includes(k)) want.push(k); });
    const tagged = [...new Set(want)].slice(0, 7).sort((a, b) => a - b);
    mine.forEach(k => { const f = pl.map.get(k), p = pos(k), up = rw === 0, y0 = up ? p.y : p.y + 20, yEdge = up ? ZONE - 6 : ZONE + plateH + 6;
      const bad = portBad(f), col = bad ? "#e5604d" : "#e3c34a", sw = k === sel ? 3.2 : 1.8, ti = tagged.indexOf(k);
      if (ti < 0) { svg += `<path d="M${p.x},${y0} L${p.x},${up ? yEdge - 40 : yEdge + 40}" stroke="${col}" stroke-width="1.6" opacity=".45" fill="none"/>`; return; }
      const slot = (W - 40) / tagged.length, tx = 20 + slot * (ti + 0.5), ty = up ? ZONE - 54 : ZONE + plateH + 54;
      svg += `<path d="M${p.x},${y0} C${p.x},${up ? y0 - 50 : y0 + 50} ${tx},${up ? ty + 50 : ty - 50} ${tx},${ty}" stroke="${col}" stroke-width="${sw}" fill="none"/>`;
      const pe = peerOf(f);
      tags += `<div class="ctag${bad ? " x" : ""}${k === sel ? " sel" : ""}" style="left:${tx - 72}px;top:${up ? ty - 46 : ty + 2}px"><b>${esc(pe.dev)}</b> ${esc(pe.port === "-" ? "" : pe.port)}<br><span>${esc(pe.kind || "외부 연결")}${pe.gbps ? " · " + pe.gbps + "G" : ""} · 수신 ${f[3].toFixed(1)} dBm${f[2] ? " · CRC " + f[2] : ""}</span></div>`;
    });
  });
  const rows = used.map(k => { const f = pl.map.get(k), pe = peerOf(f);
    return `<tr class="click${k === sel ? " on" : ""}" data-i="${k}"><td>${f[0]}</td><td>${esc(pe.dev)}${pe.port && pe.port !== "-" ? " " + esc(pe.port) : ""}</td><td>${esc(pe.kind || "외부 연결")}</td><td class="n">${pe.gbps}</td><td class="n ${f[3] < -9 ? "crit-t" : ""}">${f[3].toFixed(2)}</td><td class="n ${f[2] > 50 ? "crit-t" : ""}">${f[2]}</td></tr>`; }).join("");
  const label = { ok: "정상", warn: "주의", crit: "장애", off: "꺼짐" };
  $("#r3Detail").hidden = false;
  $("#r3DBody").innerHTML = `<div class="dhd"><b>${d.id}</b><span class="tag">${{ juniper: "Juniper", cisco: "Cisco", huawei: "Huawei" }[d.vendor]}</span><span class="muted">${esc(d.role)} · ${d.rack} · 입구 ${rack.temp[i].toFixed(1)}°C</span>${ledHtml(st)}<span class="muted">전원 ${st.power ? "켜짐" : "꺼짐"} · 상태 ${label[st.status]} · 팬 ${label[st.fan]}</span><span class="sp"></span><button class="btn" id="r3DTerm">이 장비 터미널 열기</button><button class="btn" id="r3DClose">닫기</button></div>` +
    `<p class="note">노란 선이 꽂혀 있는 광케이블(가상, 단일모드로 가정)이고 빨간 선은 광 수신이 약하거나 CRC 오류가 많은 포트입니다. 위줄 포트의 케이블은 위로, 아래줄은 아래로 나갑니다. 포트를 누르면 표시됩니다.</p>` +
    `<div class="dscroll"><div class="dwrap" style="width:${W}px;height:${H}px"><svg width="${W}" height="${H}">${svg}</svg>` +
    `<div class="plate ${d.vendor}" style="left:0;top:${ZONE}px;width:${W}px;height:${plateH}px"><span class="pl">${d.id} · ${d.vendor === "cisco" ? "Cisco 대형 섀시" : d.vendor === "juniper" ? "Juniper" : "Huawei"}</span></div>${plate}${tags}</div></div>` +
    `<div class="card" style="padding:0;margin-top:10px;max-height:240px;overflow:auto"><table><tr><th>포트</th><th>연결 상대</th><th>종류</th><th class="n">Gbps</th><th class="n">수신 dBm</th><th class="n">CRC</th></tr>${rows || `<tr><td colspan="6" class="muted">연결된 포트가 없습니다.</td></tr>`}</table></div>`;
}
function r3Open(id) { R3.dev = id; R3.port = null; r3Detail(); }
function r3Close() { R3.dev = null; $("#r3Detail").hidden = true; }
(function initDetailModal() {   // 장비 상세(포트·광케이블) 창의 버튼
  $("#r3Detail").addEventListener("click", ev => {
    if (ev.target.id === "r3Detail" || ev.target.id === "r3DClose") { r3Close(); return; }
    if (ev.target.id === "r3DTerm") { openDeviceTerminal(R3.dev); return; }
    const pt = ev.target.closest("[data-i]"); if (pt) { R3.port = +pt.dataset.i; r3Detail(); }
  });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && R3.dev) r3Close(); });
})();

/* ---------- 시작 ---------- */
$("#homeLink").addEventListener("click", e => {   // 제목을 누르면 관제(홈)로
  if (document.body.classList.contains("popup")) return;
  e.preventDefault(); showTab("monitor"); window.scrollTo({ top: 0, behavior: "smooth" });
});
const qs = new URLSearchParams(location.search), h0 = location.hash.slice(1);
if (qs.get("popup") === "term") {
  document.body.classList.add("popup");
  showTab("term"); termConnect(qs.get("dev"));
  document.title = `${qs.get("dev")} 터미널 (가상)`;
  $("#termIn").focus();
} else {
  showTab(["monitor", "monthly", "event", "room", "room3d", "visit", "term"].includes(h0) ? h0 : "monitor");
}
