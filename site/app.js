"use strict";
/* 백본 트래픽 관제 (전부 가상 데이터) */

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
// 자료를 정기적으로 보내는 고객사(사용자가 정한 값, 전부 가상). 고객사가 30곳이어도 예민한 곳에만 보낸다.
const SEND_PLAN = [
  { id: "start", title: "월초 발송", note: "매달 초에 지난달 자료를 보냅니다.", names: ["예시미디어", "샘플게임즈"] },
  { id: "end", title: "월말 발송", note: "매달 말에 이번 달 자료를 보냅니다.", names: ["가상은행", "예시금융"] },
  { id: "weekly", title: "매주 발송 (월요일)", note: "매주 월요일에 지난주 자료를 보냅니다. 칸은 이번 달 월요일입니다.", names: ["데모스트리밍"] }
];
function monthMondays() {   // 가상 현재가 속한 달의 월요일들 [날짜 문자열]
  const [y, m] = ymdhm(msOf(NOW_IDX)).slice(0, 7).split("-").map(Number), out = [];
  for (let d = 1; d <= 31; d++) { const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) break; if (dt.getUTCDay() === 1) out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`); }
  return out;
}
const sendKeys = g => g.names.flatMap(n => g.id === "weekly" ? monthMondays().filter(d => d <= ymdhm(msOf(NOW_IDX)).slice(0, 10)).map(d => `${n}:w:${d}`) : [`${n}:${g.id}`]);   // 지금까지 보냈어야 하는 칸
const sendProgress = () => { const keys = SEND_PLAN.flatMap(sendKeys); return { done: keys.filter(k => store.get("sent:" + k, false)).length, total: keys.length }; };
const COMPANY = "TEP IDC";
/* 장애 전파 문자 양식 (사용자가 알려 준 양식). 단계는 발생 → 경과 → 완료 순서이고, 완료 전에는 항상 '경과'로 보낸다. 완료는 정말 다 끝났을 때만 쓴다.
   stage: 발생·경과·완료, actions: [{ t: "16:17", txt: "...", sub: ["..."] }], attack: DDoS일 때 공격량. 일시의 끝(to)은 완료일 때만 채운다. */
function smsNotice(o) {
  if (!["발생", "경과", "완료"].includes(o.stage)) throw new Error("문자 단계는 발생·경과·완료 중 하나여야 합니다");
  const L = [`[${COMPANY}]`, "[Web발신]", `[주의_${o.center}_${o.stage}] ${o.title}`, "", `■ 대상 : ${o.target}`, `■ 일시 : ${o.from} ~${o.stage === "완료" && o.to ? " " + o.to : ""}`, `■ 원인 : ${o.cause}`];
  if (o.attack) L.push(`■ 공격량 : ${o.attack}`);
  if (o.actions && o.actions.length) { L.push("■ 조치 :"); o.actions.forEach(x => { L.push(`${x.t} ${x.txt}`); (x.sub || []).forEach(s => L.push(` - ${s}`)); }); }
  L.push(`■ 서비스영향 : ${o.impact}`, `■ VOC : ${o.voc}`);
  if (o.spread) L.push(`■ 전파 : ${o.spread}`);
  return L.join("\n");
}   // 우리 회사 이름(가상). 메일·문자 제목에 [TEP IDC]를 붙여서 받는 쪽이 어디서 온 것인지 바로 알게 한다
const CUSTOMERS = TOPOLOGY.customers;   // 전부 가상 고객사. 설계도(topology.js)에서 읽는다 (회선 배정은 제가 임의로 정한 것)
const CENTER_NAME = TOPOLOGY.centers;   // 이름의 센터 코드: IDC_<코드>_... (센터 목록은 설계도에서)
const CENTER = id => /_(IX|INTL)\d/.test(id) ? "연동" : (CENTER_NAME[id.split("_")[1]] || "연동");

/* ---------- 경고 탐지: 규칙은 lib.js에 있다 (터미널에서도 시험할 수 있게 분리) ---------- */
const { runs, median } = Lib;
const DROP = {};   // 링크별 급감 여부 (그래프 패널 표시용)
const ALERTS = (() => { const r = Lib.detectTraffic(DATA); Object.assign(DROP, r.drop); return r.alerts; })();

/* ---------- 탭 ---------- */
function showTab(name) {
  $$("#tabs button[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $$("#tabs .tabgrp").forEach(g => g.classList.toggle("on", [...g.querySelectorAll(".submenu button")].some(b => b.dataset.tab === name)));
  $$("section.tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  if (typeof renderCenterBar === "function") {   // 센터 선택은 관제와 서버실에서만 보인다
    $("#centerBar").hidden = !(name === "monitor" || name === "room" || name === "room3d");
    if ($("#centerBar").hidden) syncHdr(); else renderCenterBar();
  }
  if (name === "monitor") { renderAll(); renderTasks(); }
  if (name === "event") renderEvReport();
  if (name !== "room" && typeof stopPlay === "function") stopPlay();
  if (name === "room") renderServerRoom();
  if (name === "room3d" && typeof render3d === "function") render3d();
  if (name === "term" && typeof termSync === "function") termSync();
  try { history.replaceState(null, "", "#" + name); } catch (e) { /* 무시 */ }
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { showTab(b.dataset.tab); if (document.activeElement) document.activeElement.blur(); } });

/* ---------- 1. 관제 ---------- */
const NOW_IDX = idxOf(parseT("2026-10-22T21:00"));   // 가상 "현재" 시각: 평소 저녁
const HL = new Set();   // 시나리오가 강조 표시하는 링크·랙
const state = { end: NOW_IDX, win: 12, ymode: "cap", cust: "all" };
// 공통 센터 선택: 관제 그래프·서버실 랙·터미널 장비·설계도가 모두 이 선택에 맞춰 보인다. "ALL" 또는 센터 코드(B/S/G/A).
// 회선·랙·장비 이름이 모두 IDC_<센터 코드>_... 라서 이름의 두 번째 칸으로 센터를 알 수 있다.
const codeOf = id => id.split("_")[1];
const view = { center: ["ALL", ...Object.keys(TOPOLOGY.centers)].includes(store.get("center", "ALL")) ? store.get("center", "ALL") : "ALL" };
const FEEDS = Object.fromEntries(TOPOLOGY.links.filter(l => l.feeds).map(l => [l.link, l.feeds]));   // 다른 센터에서 들어오는 회선: 들어가는 센터 관제에서도 보인다
const inView = id => view.center === "ALL" || codeOf(id) === view.center || FEEDS[id] === view.center;
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

// 기준 시각 입력: 데이터 범위를 벗어나면 가까운 시각으로 옮기고 이유를 입력칸 옆에 알려 준다
function timeNote(inp, ms) {
  let el = inp.parentNode.querySelector(".timenote");
  if (!el) { el = document.createElement("span"); el.className = "timenote muted"; inp.parentNode.appendChild(el); }
  const i = idxOf(ms), out = i < 0 || i > N - 1;
  el.textContent = out ? ` 이 날짜는 데이터가 없어 ${ymdhm(msOf(clamp(i, 0, N - 1))).slice(5)}로 옮겼습니다 (데이터 ${ymdhm(T0).slice(5, 10)} ~ ${ymdhm(msOf(N - 1)).slice(5, 10)})` : ` 데이터 ${ymdhm(T0).slice(5, 10)} ~ ${ymdhm(msOf(N - 1)).slice(5, 10)}`;
  el.style.color = out ? "var(--warn,#e8a23b)" : "";
}
(function initMonitor() {
  buildGrid();
  const et = $("#endTime"); et.min = isoLocal(T0); et.max = isoLocal(msOf(N - 1));
  timeNote(et, parseT(et.value || DATA.start));
  et.addEventListener("change", () => { if (et.value) { timeNote(et, parseT(et.value)); state.end = idxOf(parseT(et.value)); renderAll(); } });
  $("#prev").onclick = () => { state.end -= state.win; renderAll(); };
  $("#next").onclick = () => { state.end += state.win; renderAll(); };
  $("#goNow").onclick = () => { stopScn(); goNow(); };
  $("#csvAll").onclick = () => { const [s, e] = viewRange(); downloadCsv(`traffic_all_${fileStamp(msOf(s))}_${fileStamp(msOf(e))}.csv`, csvOf(LINKS.filter(l => $("#p-" + l.id).style.display !== "none").map(l => l.id), s, e)); };
  $("#grid").addEventListener("click", ev => {
    const b = ev.target.closest(".csv"); if (!b) return;
    const [s, e] = viewRange(); downloadCsv(`traffic_${b.dataset.link}_${fileStamp(msOf(s))}_${fileStamp(msOf(e))}.csv`, csvOf([b.dataset.link], s, e));
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderAll, 120); });
})();

function renderTasksTable() {
  const sp = sendProgress();
  const checks = DATA.events.map(ev => (store.get("chk:" + ev.id, []) || []).length);
  const visits = store.get("visits", []).length;
  const spikes = ALERTS.filter(a => a.kind === "in 급증 의심" && !a.evName).length;
  const drops = ALERTS.filter(a => a.kind.includes("급감") && !a.evName).length;
  const rows = [
    ["월간·주간 자료 발송", `${sp.done}/${sp.total} 완료 (월초·월말·매주)`, sp.done === sp.total ? "ok" : "warn", "monthly"],
    ["이벤트 대비", `아시안게임 ${checks.filter(c => c === CHECK_ITEMS.length).length}/${DATA.events.length}이벤트 체크 완료`, "warn", "event"],
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
const DAY = 86400000, HIST_DAYS = 190;       // 9/10 이전은 이 일수까지 즉석에서 만들어 준다 (가상)
const MIN_PICK = ymd(T0 - HIST_DAYS * DAY);
function p95(a) { const b = Float64Array.from(a).sort(); return b[Math.floor(0.95 * (b.length - 1))]; }

/* 9/10 이전: 생성해 둔 데이터가 없으므로 같은 규칙(평소 하루 모양 + 작은 잡음)으로 그때그때 만든다.
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
  return { max: a[mxi], at: from + mxi * STEP, min: mn, avg: sum / a.length, p95: p95(a), totalGb: sum * 300 / 8 };   // 총 전송량(GB) = Σ(Gbps × 300초) ÷ 8, 1GB = 10^9 바이트
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
  return m.ids.map(id => { const sr = seriesFor(LINK[id], m.from, m.to); const cap = LINK[id].cap; return { id, sr, cap, st: { out: statsArr(sr.out, m.from), in: statsArr(sr.inn, m.from) } }; });   // cap: 회선 용량(Gbps), 사용률(%) = 값 ÷ 용량 × 100
}
function seriesCsv(id, sr) {
  const l = LINK[id], rows = ["time,link,in_gbps,out_gbps,out_util_pct"];
  for (let k = 0; k < sr.out.length; k++) rows.push(`${ymdhm(sr.from + k * STEP)},${id},${sr.inn[k]},${sr.out[k]},${(sr.out[k] / l.cap * 100).toFixed(1)}`);
  return rows.join("\n");
}
function summaryCsv(data, m) {
  const rows = ["from,to,link,direction,max_gbps,max_time,min_gbps,avg_gbps,p95_gbps,cap_gbps,util_avg_pct,util_max_pct,util_p95_pct,total_gb"];
  data.forEach(x => ["out", "in"].forEach(d => { const t = x.st[d], u = v => (v / x.cap * 100).toFixed(1); rows.push(`${m.fromStr},${m.toStr},${x.id},${d},${t.max.toFixed(2)},${ymdhm(t.at)},${t.min.toFixed(2)},${t.avg.toFixed(2)},${t.p95.toFixed(2)},${x.cap},${u(t.avg)},${u(t.max)},${u(t.p95)},${t.totalGb.toFixed(1)}`); }));
  return rows.join("\n");
}
function renderMonthly() {
  const m = mState();
  const msg = m.bad ? "시작일이 끝나는 날보다 늦습니다. 날짜를 확인하세요." : !m.ids.length ? "회선을 선택하세요." : "";
  const data = msg ? [] : mCompute(m);
  $("#mSum").innerHTML = `<tr><th>회선</th><th>방향</th><th class="n">최대</th><th>최대 시각</th><th class="n">최소</th><th class="n">평균</th><th class="n">95%값</th><th class="n">평균 사용률</th><th class="n">최대 사용률</th><th class="n">총 전송량(GB)</th></tr>` +
    (msg ? `<tr><td colspan="10" class="${m.bad ? "crit-t" : "muted"}">${msg}</td></tr>` : data.map(x => ["out", "in"].map(d => { const t = x.st[d]; return `<tr><td>${x.id}</td><td>${d.toUpperCase()}</td><td class="n">${t.max.toFixed(2)}</td><td>${md(t.at)}</td><td class="n">${t.min.toFixed(2)}</td><td class="n">${t.avg.toFixed(2)}</td><td class="n">${t.p95.toFixed(2)}</td><td class="n">${(t.avg / x.cap * 100).toFixed(1)}%</td><td class="n">${(t.max / x.cap * 100).toFixed(1)}%</td><td class="n">${t.totalGb.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td></tr>`; }).join("")).join(""));
  $("#mNote").textContent = [
    !m.bad && m.from < T0 ? `※ ${MIN_DAY} 이전 구간은 생성해 둔 데이터가 없어서, 같은 규칙(평소 하루 모양)으로 즉석에서 만든 가상 값입니다. 경기·사고는 없는 평소 기록입니다.` : "",
    !m.bad && m.clamped ? `※ 데이터는 ${MAX_DAY}까지만 있어서 거기까지 보냅니다.` : ""].filter(Boolean).join(" ");
  $("#mNote2").textContent = !m.bad && (m.to - m.from) > 60 * DAY ? "긴 기간은 파일이 큽니다 (6개월이면 회선당 약 3MB, 압축하지 않고 묶습니다)." : "";
  $("#mMail").value =
`제목: [${COMPANY}] ${m.c.name} ${m.fromStr} ~ ${m.toStr} 회선별 5분 단위 트래픽 자료 송부

${m.c.name} 담당자님, 안녕하세요.
요청하신 회선별 5분 단위 트래픽 자료를 보내드립니다.

- 대상 회선: ${m.ids.join(", ") || "(선택 없음)"}
- 기간: ${m.fromStr} ~ ${m.toStr}
- 첨부: 회선별 5분 단위 CSV, 요약 CSV(최대·최소·평균·95%값, 사용률, 총 전송량)
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
  function renderSendPlan() {
    const open = new Set($$("#sendPlan details[open]").map(d => d.dataset.plan)), now = ymdhm(msOf(NOW_IDX)).slice(0, 10), mons = monthMondays();
    $("#sendPlan").innerHTML = SEND_PLAN.map(g => {
      const keys = sendKeys(g), done = keys.filter(k => store.get("sent:" + k, false)).length;
      const rows = g.names.map(n => { const c = CUSTOMERS.find(x => x.name === n);
        const cells = g.id === "weekly" ? mons.map(d => `<label class="chk" title="${d <= now ? "" : "아직 오지 않은 월요일"}"><input type="checkbox" data-sent="${n}:w:${d}" ${store.get("sent:" + n + ":w:" + d, false) ? "checked" : ""}> ${d.slice(5)}${d > now ? " (예정)" : ""}</label>`).join(" ")
          : `<label class="chk"><input type="checkbox" data-sent="${n}:${g.id}" ${store.get("sent:" + n + ":" + g.id, false) ? "checked" : ""}> 발송 완료</label>`;
        return `<tr><td>${n}</td><td class="muted">${c.links.join(", ")}</td><td>${cells}</td></tr>`; }).join("");
      return `<details class="fold sub" data-plan="${g.id}" ${open.has(g.id) ? "open" : ""}><summary><b>${g.title}</b> <span class="muted">${g.names.length}곳 · 완료 ${done}/${keys.length}</span></summary><p class="note">${g.note}</p><table>${rows}</table></details>`;
    }).join("");
  }
  renderSendPlan();
  $("#sendPlan").addEventListener("change", e => { if (e.target.dataset.sent) { store.set("sent:" + e.target.dataset.sent, e.target.checked); renderTasks(); renderSendPlan(); } });
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
  const evDay = Math.floor(s / PER_DAY);   // 그때(이벤트 전날)까지 가진 데이터만 쓴다: 이벤트 이후 날짜는 그때는 몰랐던 값이라 뺀다
  for (let d = 0; d * PER_DAY + off + len < N && d < evDay; d++) {
    if (evDays.has(d)) continue;
    let m = 0; for (let k = 0; k <= len; k++) m = Math.max(m, l.out[d * PER_DAY + off + k]);
    vals.push(m);
  }
  return vals.length ? median(vals) : evBaselineAll(l, ev);
}
function evBaselineAll(l, ev) {   // 이벤트 앞에 쓸 날이 없을 때만: 전체 데이터에서 계산 (이전 방식)
  const s = idxOf(parseT(ev.start)), e = idxOf(parseT(ev.end)), len = e - s, off = s % PER_DAY, vals = [];
  const evDays = new Set(DATA.events.flatMap(x => [Math.floor(idxOf(parseT(x.start)) / PER_DAY), Math.floor(idxOf(parseT(x.end)) / PER_DAY)]));
  for (let d = 0; d * PER_DAY + off + len < N; d++) { if (evDays.has(d)) continue; let m = 0; for (let k = 0; k <= len; k++) m = Math.max(m, l.out[d * PER_DAY + off + k]); vals.push(m); }
  return median(vals);
}
function refPeak(l, until) {   // 평소 하루 최대 out의 중앙값 (이벤트 있는 날 제외). until이 있으면 그 날짜(0부터 센 날 번호) 전날까지만
  const key = until == null ? l.id : `${l.id}|${until}`;
  if (!REF[key]) {
    const evDays = new Set(DATA.events.flatMap(x => [Math.floor(idxOf(parseT(x.start)) / PER_DAY), Math.floor(idxOf(parseT(x.end)) / PER_DAY)]));
    const v = [];
    for (let d = 0; (d + 1) * PER_DAY <= N && (until == null || d < until); d++) { if (evDays.has(d)) continue; let m = 0; for (let k = 0; k < PER_DAY; k++) m = Math.max(m, l.out[d * PER_DAY + k]); v.push(m); }
    REF[key] = v.length ? median(v) : refPeak(l);
  }
  return REF[key];
}
function evCalc(ev) {
  const s = idxOf(parseT(ev.start)), e = idxOf(parseT(ev.end));
  const rows = LINKS.map(l => {
    const base = evBaseline(l, ev), f = ev.links.includes(l.id) ? ev.expected : 1;
    const exp = base + (f > 1 ? refPeak(l, Math.floor(s / PER_DAY)) * (f - 1) : 0), util = exp / l.cap;
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
function renderEvReport() {   // 이벤트 보고 문자: 장비·고객 데이터가 준비된 뒤에만 만들 수 있어서, 준비 전(시작할 때)에는 건너뛰고 탭을 열 때 다시 만든다
  try { $("#evReport").value = REPORT.event(DATA.events[$("#evSel").selectedIndex]); } catch (e) { /* 준비 전 */ }
}
const euro = w => { const c = w.charCodeAt(w.length - 1) - 0xAC00; if (c < 0 || c > 11171) return "로"; const f = c % 28; return f === 0 || f === 8 ? "로" : "으로"; };   // 받침이 있으면 "으로" (ㄹ 받침과 받침 없음은 "로")
function evNoticeText(ev, calc) {
  const when = `${md(msOf(calc.s)).split(" ")[0]} ${hm(msOf(calc.s))}~${hm(msOf(calc.e))}`;
  if (!calc.moves.length) return `분산이 필요한 링크가 없습니다. (예상 사용률 ${Math.round(MOVE_LIMIT * 100)}% 미만)\n사전 통보는 필요 없고, 당일 모니터링만 진행합니다.`;
  const blocks = CUSTOMERS.map(c => {
    const mine = calc.moves.filter(m => c.links.includes(m.r.l.id)); if (!mine.length) return null;
    const lines = mine.map(m => {
      const to = m.best ? `${m.best.c.l.id}${CENTER(m.best.c.l.id) !== CENTER(m.r.l.id) ? " (" + CENTER(m.best.c.l.id) + ", 협의 후 진행)" : ""}` : "(여유 회선 없음, 별도 협의)";
      return `- ${m.r.l.id}: 예상 최대 ${m.r.exp.toFixed(0)}Gbps (용량 대비 ${(m.r.util * 100).toFixed(0)}%)\n  조치: 해당 시간대 일부(약 ${Math.max(1, Math.ceil(m.need))}Gbps)를 ${to}로 보내겠습니다.`;
    }).join("\n");
    return `제목: [${COMPANY}] ${when} ${ev.name} 대비 트래픽 분산 안내\n\n${c.name} 담당자님, 안녕하세요.\n${when} ${ev.name}${euro(ev.name)} 트래픽 증가가 예상되어 미리 안내드립니다.\n\n${lines}\n\n서비스 중단 없이 진행할 예정이며, 종료 후 원복하고 결과를 안내드리겠습니다.\n문의는 관제 담당에게 연락 주세요. (가상 고객사 · 가상 센터)`;
  }).filter(Boolean);
  return blocks.join("\n\n--------------------------------\n\n");
}
function renderEvList() {
  const sel = $("#evSel").selectedIndex;
  $("#evList").innerHTML = `<tr><th>이벤트</th><th>시작</th><th>시간대</th><th class="n">예상 배율</th><th>분산 필요 링크</th><th class="n">실제 최대 사용률</th><th>사후 판정</th></tr>` +
    DATA.events.map((ev, i) => {
      const c = evCalc(ev), top = c.rows.filter(r => r.f !== 1).sort((a, b) => b.act / b.l.cap - a.act / a.l.cap)[0], u = top.act / top.l.cap * 100;
      const hr = +hm(msOf(c.s)).slice(0, 2), slot = hr < 6 ? "새벽" : "저녁";
      return `<tr class="click ${i === sel ? "sel" : ""}" data-i="${i}"><td>${esc(ev.name)}</td><td>${md(msOf(c.s))}</td><td>${slot}</td><td class="n">×${ev.expected}</td><td>${c.moves.map(m => m.r.l.id).join(", ") || "-"}</td><td class="n">${u.toFixed(0)}% (${top.l.id})</td><td>${u >= 80 ? '<span class="tag crit">경고선 초과</span>' : u >= 70 ? '<span class="tag warn">주의</span>' : '<span class="tag ok">여유</span>'}</td></tr>`;
    }).join("");
}
function renderEvent() {
  const ev = DATA.events[$("#evSel").selectedIndex], calc = evCalc(ev);
  const evDay = Math.floor(calc.s / PER_DAY);
  $("#evInfo").textContent = `${md(msOf(calc.s))} ~ ${hm(msOf(calc.e))} · 예상 배율 ×${ev.expected} (${ev.links.join(", ")}) · 그때 가진 데이터: ${ymdhm(T0).slice(5, 10).replace("-", "/")} ~ ${ymdhm(msOf(evDay * PER_DAY - 1)).slice(5, 10).replace("-", "/")} (${evDay}일치, 이 이벤트 전날까지만 사용)`;
  const lv = { crit: ["분산 필요", "crit"], warn: ["주의", "warn"], ok: ["정상", "ok"] };
  $("#evPlan").innerHTML = `<tr><th>링크</th><th class="n">평소 최대</th><th class="n">배율</th><th class="n">예상 최대</th><th class="n">용량</th><th class="n">예상 사용률</th><th>판정</th></tr>` +
    calc.rows.map(r => `<tr><td>${r.l.id} <span class="muted">${esc(r.l.desc)}</span></td><td class="n">${r.base.toFixed(1)}</td><td class="n">${r.f === 1 ? "-" : "×" + r.f}</td><td class="n">${r.exp.toFixed(1)}</td><td class="n">${r.l.cap}</td><td class="n">${(r.util * 100).toFixed(0)}%</td><td><span class="tag ${lv[r.level][1]}">${lv[r.level][0]}</span></td></tr>`).join("");
  $("#evMove").innerHTML = `<div class="note">기준: 예상 사용률 ${Math.round(MOVE_LIMIT * 100)}% 이상이면 미리 분산 (경고선 80%에 여유를 둠). 분산 후 목표 ${Math.round(TARGET * 100)}% 이하.</div>` +
    (calc.moves.length ? calc.moves.map(m => `<p><b>${m.r.l.id}</b>: 예상 ${m.r.exp.toFixed(0)}G → 약 <b>${Math.max(1, Math.ceil(m.need))}G</b> 덜어내기. ` +
      (m.best ? `후보 <b>${m.best.c.l.id}</b> (${CENTER(m.best.c.l.id)}, 여유 약 ${m.best.spare.toFixed(0)}G) ${m.ok ? '<span class="tag ok">가능</span>' : '<span class="tag warn">여유 부족</span>'}${CENTER(m.best.c.l.id) !== CENTER(m.r.l.id) ? ' <span class="muted">다른 센터라 협의 필요</span>' : ""}` : '<span class="tag crit">후보 없음</span> 증설·서비스 협의 필요') + "</p>").join("") : "<p>분산이 필요한 링크가 없습니다.</p>");
  $("#evNotice").value = evNoticeText(ev, calc);
  renderEvReport();
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
  $("#evReportPhone").onclick = () => { const ev = DATA.events[$("#evSel").selectedIndex]; openPhone($("#evReport").value, hm(parseT(ev.end) + 40 * 60000)); };
  $("#evReportCopy").onclick = async () => { try { await navigator.clipboard.writeText($("#evReport").value); $("#evReportMsg").textContent = "복사했습니다"; } catch (e) { $("#evReport").select(); $("#evReportMsg").textContent = "선택했습니다. Ctrl+C로 복사하세요"; } };
  $("#evCopy").onclick = () => copyText($("#evNotice").value, $("#evCopy"));
  $("#evGo").onclick = () => { const ev = DATA.events[$("#evSel").selectedIndex]; state.win = 36; state.end = idxOf(parseT(ev.start)) + 25; showTab("monitor"); };
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
  return `제목: [${COMPANY}] 방문 등록 완료 - ${r.name}님 ${r.when.slice(0, 10)}\n\n${r.org} ${r.name}님, 안녕하세요.\n요청하신 방문이 아래와 같이 등록되었습니다.\n\n- 방문예정일시: ${r.when.replace("T", " ")}\n- 방문센터: ${r.center}\n- 방문장소: ${r.place}\n- 방문목적: ${r.purpose}\n- 주차: ${r.park ? "등록 완료" : "해당 없음"}\n- 서버실 출입키: ${r.key ? "사전 준비 완료 (방문 시 수령)" : "해당 없음"}\n\n방문 당일 신분증을 지참해 주세요.\n감사합니다. (가상 메일)`;
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
// 고객 회선(1G·10G): 장비마다 한 줄씩. [.., 속도(G), {홈 장비, 고객사}] 가 뒤에 붙는다. 짝 장비도 같은 목록을 가진다.
DEVICES.forEach(d => (d.lines || []).forEach((ln, k) => {
  const f = TOPOLOGY.faults[`${d.id}|${ln.port}`] || {}, name = CUSTOMERS.find(c => c.key === ln.customer).name;
  const idle = ln.state !== "up";   // 아직 쓰지 않는 회선: Link down(unused) 또는 Admin down(off), 빛이 안 들어옴
  d.ifs.push([ln.port, name, f.crc || 0, f.rx != null ? f.rx : idle ? -40 : (ln.speed === 10 ? -2.6 : -4.1) - (k % 5) * 0.12, null, idle ? "down" : "up", ln.state === "off" ? "down" : "up", "", "", ln.speed, { home: ln.home, customer: name }, idle ? ln.state : ""]);
}));

/* 업무 메모에서 일반화한 명령들: 회선 설명(Up/Down·Admin/Link·고객사), ARP·ping, 로그, BGP, 설정. 출력은 전부 가상입니다. */
const custNames = keys => keys.map(k => CUSTOMERS.find(c => c.key === k).name);
function descOf(d, f) {   // 회선 설명. 고객 회선: "홈장비 고객사 속도", 장비 간 회선: "회선이름 -> 상대 속도"
  if (f[10]) return `${f[10].home} ${f[10].customer} ${f[9]}G`;
  const l = f[4]; if (!l) return "";
  return `${l.link} -> ${f[1]} ${l.gbps}G`;
}
const portKey = f => { const m = String(f[0]).match(/(\d+)\/(\d+)\/(\d+)$/); return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : 0; };
const sortedIfs = d => [...d.ifs].sort((x, y) => portKey(x) - portKey(y));   // 슬롯·포트 번호 순서로 보여 준다
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
  return "Interface       Admin Link Description\n" + sortedIfs(d).map(f => `${f[0].padEnd(15)} ${f[6].padEnd(5)} ${f[5].padEnd(4)} ${descOf(d, f)}`).join("\n");
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
  d.ifs.filter(f => !f[11]).forEach(f => {
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
    [/^show interfaces? descriptions?$/i, d => "Interface                      Status         Protocol Description\n" + sortedIfs(d).map(f => `${f[0].padEnd(30)} ${(f[6] === "down" ? "admin-down" : f[5]).padEnd(14)} ${(f[6] === "down" ? "down" : f[5]).padEnd(8)} ${descOf(d, f)}`).join("\n")],
    [/^show interfaces? brief$/i, d => "Intf       Intf        LineP           Encap  MTU    BW\nName       State       State           Type   (byte) (Kbps)\n" + sortedIfs(d).map(f => `${f[0].padEnd(10)} ${(f[6] === "down" ? "admin-down" : f[5]).padEnd(11)} ${(f[6] === "down" ? "down" : f[5]).padEnd(15)} ARPA   1514   ${String((f[9] || (f[4] && f[4].gbps) || 10) * 1000000)}`).join("\n")],
    [/^show logging(?: last (\d+))?$/i, d => logLines(d, "c")],
    [/^show running-config interface (\S+)$/i, (d, m) => { const f = findIf(d, m[1]); if (!f) return `% Invalid input detected at '^' marker.`; return `interface ${f[0].replace("Te", "TenGigE")}\n description ${descOf(d, f)}\n` + (f[8] ? ` ipv4 address ${f[7]} 255.255.255.252\n` : "") + (f[6] === "down" ? " shutdown\n" : "") + "!"; }],
    [/^ping (\S+) repeat (\d+)$/i, (d, m) => iosPing(d, m[1], Math.min(+m[2], 200))],
    [/^show bgp summary$/i, d => { const r = bgpRows(d); return `BGP router identifier ${d.id}, local AS number ${asOf(d.id)}\n\nNeighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd\n` + r.map(x => `${x.ip.padEnd(15)}   0 ${String(x.as).padEnd(5)}  ${x.down ? "    12       9" : "  5148   23139"}      100    0    0 ${x.down ? "00:12:01 Active" : "1d16h           37"}`).join("\n"); }],
    [/^show route (\S+)$/i, (d, m) => { const f = d.ifs.find(x => x[8] === m[1] || x[7] === m[1]); if (!f || !f[7]) return "% Network not in table"; const net = f[7].replace(/\.\d+$/, ".0"); return `Routing entry for ${net}/30\n  Known via "connected", distance 0, metric 0 (connected)\n    directly connected, via ${f[0].replace("Te", "TenGigE")}`; }],
    [/^show interfaces? (\S+) \| include CRC$/i, (d, m) => { const f = findIf(d, m[1]); return f ? `     ${f[2]} input errors, ${f[2]} CRC, 0 frame, 0 overrun, 0 ignored` : `% Invalid input detected at '^' marker.`; }]
  ],
  huawei: [
    [/^display interface description$/i, d => "PHY: Physical\n*down: administratively down\nInterface                     PHY      Protocol Description\n" + sortedIfs(d).map(f => `${(f[6] === "down" ? "*" : "") + shortPort(f[0])}`.padEnd(29) + ` ${f[5].padEnd(8)} ${f[5].padEnd(8)} ${descOf(d, f)}`).join("\n")],
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
/* 장비가 꺼진 시간대(데이터의 downStart~downEnd). 그 시각의 터미널·3D 상세는 꺼진 상태를 반영한다:
   꺼진 장비는 접속이 안 되고(전 포트 Down), 그 장비와 이어진 옆 장비의 포트는 Down·빛 없음으로 보인다. */
const OUTAGES = DATA.racks.flatMap(r => r.devices.filter(x => x.downStart).map(x => ({ dev: x.id, s: parseT(x.downStart), e: parseT(x.downEnd), why: x.downWhy || "" })));
const outageAt = (id, ms) => OUTAGES.find(o => o.dev === id && ms >= o.s && ms < o.e);
const TERM = { at: null, shown: null };   // at: 팝업이 열릴 때 받은 가상 시각. 없으면 서버실 기준 시각
const termMs = () => { if (TERM.at != null) return TERM.at; try { return msOf(clamp(sr.end, 0, N - 1)); } catch (e) { return msOf(NOW_IDX); } };
function withTime(ms, fn) {   // 그 시각의 꺼짐 상태를 잠깐 덧씌워 fn을 실행하고 원래대로 되돌린다
  const act = OUTAGES.filter(o => ms >= o.s && ms < o.e).map(o => o.dev), saved = [], off = [];
  if (act.length) DEVICES.forEach(d => {
    if (act.includes(d.id)) { d.offline = true; off.push(d); }
    d.ifs.forEach(f => { if (act.includes(d.id) || act.includes(f[1])) { saved.push([f, f[5], f[3]]); f[5] = "down"; f[3] = -40; } });
  });
  try { return fn(); } finally { saved.forEach(([f, s, r]) => { f[5] = s; f[3] = r; }); off.forEach(d => { d.offline = false; }); }
}
const offlineMsg = (d, ms) => { const o = outageAt(d.id, ms); return `ssh: connect to host ${d.id} port 22: Connection timed out\n→ ${d.id}은(는) ${hm(ms)} 현재 전원이 꺼져 응답이 없습니다${o && o.why ? ` (${o.why})` : ""}.\n   이 장비의 터미널은 쓸 수 없습니다. 옆 장비(허브·짝 장비)에서 이 장비와 이어진 포트가 Down인지 확인하세요.`; };
function runCmd(raw, dev, ms) {
  const t = ms != null ? ms : termMs();
  return withTime(t, () => runCmdNow(raw, dev, t));
}
function runCmdNow(raw, dev, t) {
  const d = dev || devNow(), cmd = raw.trim().replace(/\s+/g, " ");
  if (!cmd) return "";
  if (d.offline) return offlineMsg(d, t);
  if (cmd === "?" || /^help$/i.test(cmd)) return "오른쪽의 '자주 쓰던 명령'을 참고하세요. 장비 종류에 맞는 명령만 동작합니다.";
  for (const [re, fn] of DEV_CMDS[d.vendor]) { const m = cmd.match(re); if (m) return fn(d, m); }
  return VENDOR_ERR[d.vendor];
}
/* 자주 쓰던 명령: 무엇을 위해 치는지 목적별로 묶고, 마우스를 올리면(터치는 아래 한 줄) 설명이 보인다 */
const CMD_GROUPS = [
  ["1. 회선 상태 확인", "장애가 나면 가장 먼저 칩니다. 어떤 회선이 Up인지 Down인지, 어느 고객사 회선인지 봅니다."],
  ["2. 광값·CRC 확인", "회선이 이상할 때 광 케이블 접촉 불량이나 SFP 불량인지 확인합니다."],
  ["3. 로그 확인", "언제 어떤 포트가 내려갔다 올라왔는지 시간 순서로 봅니다."],
  ["4. IP·연결 확인", "상대 장비까지 실제로 닿는지, 이 IP가 어느 회선으로 가는지 확인합니다."],
  ["5. 설정 확인", "포트에 어떤 설명과 IP가 설정되어 있는지 확인합니다."]
];
const CMD_INFO = [   // [명령에 들어 있는 말, 묶음 번호, 한 줄 설명, 무엇을 위해, 읽는 법]
  [/descriptions?$|interfaces? brief$|interface description$/i, 0, "Up/Down과 고객사를 한눈에", "전체 인터페이스의 상태와 설명(어느 회선·어느 고객사인지)을 한 번에 봅니다.", "Admin = 관리자가 켜 둔 상태, Link = 실제 연결 상태입니다. Admin up + Link down = 일부러 내린 게 아니라 끊긴 것(선·상대 장비 문제). Admin down = 누가 일부러 내린 것(아직 안 쓰는 회선일 수 있음). 장비에 따라 descriptions로 up/down이 안 보이면 brief로 봅니다."],
  [/optics|transceiver/i, 1, "빛이 들어오는지(수신 광값)", "광 모듈이 보내고 받는 빛의 세기를 봅니다. 케이블 접촉 불량이나 SFP 불량이 의심될 때 칩니다.", "10G LR 기준 수신 광값이 약 -14.4 ~ +0.5 dBm 안이면 정상 범위이고 이 사이트의 평소값은 -3 dBm 안팎입니다. -9 dBm 아래는 약한 것(이 사이트의 경고선), -14.4 아래는 수신 한계 아래, -40은 빛이 전혀 안 들어오는 것(끊김이나 상대 장비 꺼짐)입니다."],
  [/CRC\|physical interface|CRC\|xe/i, 1, "전 회선 CRC를 회선 이름과 함께", "모든 회선의 CRC 오류를 한 번에 훑어서 어느 회선에 오류가 있는지 찾습니다.", "숫자가 0이 아닌 회선이 의심 대상입니다. 같은 명령을 시간을 두고 다시 쳐서 숫자가 계속 늘어나는지도 봅니다."],
  [/CRC/i, 1, "이 회선의 CRC 오류 수", "선로에서 깨진 패킷이 들어오는지 봅니다. 광 케이블 접촉 불량이나 SFP 불량이면 늘어납니다.", "0이면 정상입니다. 0이 아니고 계속 늘어나면 케이블·SFP를 의심합니다. 광값(수신)과 같이 봅니다."],
  [/log/i, 2, "언제 무슨 일이 있었는지", "포트가 내려가거나 올라간 시각, 광 경고 같은 기록을 시간순으로 봅니다.", "Down 기록의 시각이 장애 시작 시각입니다. 같은 포트가 반복해서 내려갔다 올라가면 접촉 불량을 의심합니다."],
  [/arp/i, 3, "상대 IP·MAC 주소 확인", "이 포트에 연결된 상대의 IP와 MAC 주소를 찾습니다.", "링크가 Down이면 아무것도 안 나옵니다. L2 장비(Huawei)는 IP가 없어서 MAC 주소로 찾습니다."],
  [/ping/i, 3, "상대까지 실제로 닿는지", "상대 장비까지 통신이 되는지, 얼마나 손실이 나는지 100번 보내 봅니다.", "손실 0%가 정상입니다. 일부 손실이면 회선 품질 문제, 100%면 상대까지 안 닿는 것입니다."],
  [/bgp/i, 3, "BGP 상대(피어)가 살아 있는지", "BGP로 연결된 상대들의 상태를 봅니다. 장애 때 죽었다 살아난 회선을 추릴 때 씁니다.", "시간이 길고 숫자가 보이면 정상, Active는 연결이 끊긴 것입니다."],
  [/route/i, 3, "이 IP가 어느 회선으로 가는지", "특정 IP로 가는 경로(via 회선)를 찾습니다. 고객사 IP가 어느 회선인지 찾을 때 씁니다.", "via 뒤에 나오는 포트가 그 IP가 지나는 회선입니다. 그 포트를 descriptions로 보면 고객사를 알 수 있습니다."],
  [/configuration|running-config/i, 4, "포트 설정(설명·IP·내림 여부)", "이 포트에 설정된 설명(회선·고객사), IP, 포트를 내렸는지 여부를 봅니다.", "disable·shutdown이 있으면 관리자가 내려 둔 포트입니다. IP는 ping과 ARP로 확인할 때 씁니다."]
];
const cmdInfo = c => CMD_INFO.find(x => x[0].test(c)) || [null, 4, "", "", ""];
function quickCmds() {
  const d = devNow(), bad = d.ifs.find(f => !f[11] && (f[2] > 50 || f[3] < -9)) || d.ifs.find(f => !f[11]) || d.ifs[0];
  const pp = d.ifs.find(f => f[8] && f[5] === "up"), ip = pp ? pp[8] : "", hw = bad[0].replace("XGigabitEthernet", "XGigabitEthernet ");
  const list = {
    juniper: [`show interfaces descriptions`, `show interfaces diagnostics optics ${bad[0]}`, `show interfaces extensive ${bad[0]} | match CRC`, `show interfaces extensive | match "CRC|physical interface"`, `show log messages | last 20`, ...(ip ? [`show arp | match ${pp[0]}`, `ping ${ip} rapid count 100`, `show route ${ip}`] : []), `show bgp summary`, `show configuration interfaces ${bad[0]} | display set`],
    cisco: [`show interfaces description`, `show interfaces brief`, `show interface ${bad[0]} | include CRC`, `show logging last 100`, ...(ip ? [`ping ${ip} repeat 100`, `show route ${ip}`] : []), `show bgp summary`, `show running-config interface ${bad[0]}`],
    huawei: [`display interface description`, `display transceiver interface ${hw} verbose`, `display interface ${hw} | include CRC`, `display logbuffer`, `display current-configuration interface ${bad[0]}`]
  }[d.vendor];
  const cmds = [...new Set(list)];   // 포트가 하나뿐인 장비는 같은 명령이 두 번 나오지 않게
  $("#qcmd").innerHTML = CMD_GROUPS.map(([title, desc], g) => {
    const mine = cmds.filter(c => cmdInfo(c)[1] === g); if (!mine.length) return "";
    return `<div class="qgrp"><h4 title="${esc(desc)}">${title} <i class="help" aria-hidden="true">?</i></h4><p class="gdesc">${esc(desc)}</p>` + mine.map(c => { const x = cmdInfo(c); return `<button data-c="${esc(c)}" title="${esc(`무엇을 위해: ${x[3]}\n읽는 법: ${x[4]}`)}"><code>${esc(c)}</code><span class="why">${esc(x[2])}</span></button>`; }).join("") + "</div>";
  }).join("");
}
const termHist = []; let hp = 0;
function termPrint(html) { const t = $("#termOut"); t.insertAdjacentHTML("beforeend", html); t.scrollTop = t.scrollHeight; }
function termBanner() {
  const d = devNow(), ms = termMs(), off = withTime(ms, () => d.offline);
  TERM.shown = ms;
  $("#termOut").innerHTML = off ? `<span class="e">${esc(offlineMsg(d, ms))}</span>\n` : `<span class="muted">가상 장비 ${d.id} (${d.vendor} · ${d.role}) 에 연결됨. 실제 장비가 아닙니다.</span>\n`;
  $("#termPrompt").textContent = off ? `${d.id} (응답 없음)>` : d.prompt;
  $("#termTarget").textContent = `${d.id} · ${d.rack} · 가상 시각 ${ymdhm(ms)}${off ? " · 전원 꺼짐" : ""}`;
  quickCmds();
}
function termSync() { if (TERM.shown !== termMs()) termBanner(); }   // 서버실에서 시각을 바꾸고 터미널로 오면 장비 상태를 다시 반영
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
  const q = new URLSearchParams({ popup: "term", dev: devId, t: isoLocal(termMs()) });   // 지금 보고 있는 가상 시각도 같이 넘긴다 (꺼진 장비 반영)
  const w = window.open(location.pathname + "?" + q.toString(), "term-" + devId, "width=880,height=660");
  if (w) { try { w.focus(); } catch (e) { /* 무시 */ } return; }
  termConnect(devId); showTab("term");   // 팝업이 막히면 같은 화면의 터미널 탭에서 연다
  $("#termTarget").textContent += "  (팝업이 막혀서 이 화면에서 열었습니다)";
}
(function initTerm() {
  fillVendors("juniper");   // 가장 많이 쓰는 Juniper가 기본
  $("#vendorSel").onchange = () => { fillDevices($("#vendorSel").value); termBanner(); };
  $("#devSel").onchange = termBanner;
  ["devTbl", "custTbl", "linkTbl"].forEach(id => $("#" + id).addEventListener("click", ev => { const tr = ev.target.closest("tr.click"); if (tr) { showTermPane("term"); selectDevice(tr.dataset.dev); $("#termIn").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); } }));
  renderDesign();
  $("#termClear").onclick = termBanner;
  // 터미널 탭 안의 보조 메뉴: 터미널 / 장애 매뉴얼 / 설계도 (한 번에 하나만 보인다)
  window.showTermPane = p => { $("#termPane").style.display = p === "term" ? "" : "none"; $("#runbook").open = p === "runbook"; $("#designBox").open = p === "design"; $("#runbookBtn").textContent = p === "runbook" ? "장애 매뉴얼 접기" : "장애 매뉴얼 열기"; $$("#termNav button").forEach(b => b.classList.toggle("on", b.dataset.pane === p)); };
  $("#termNav").addEventListener("click", e => { const b = e.target.closest("button"); if (b) showTermPane(b.dataset.pane); });
  $("#runbookBtn").onclick = () => showTermPane($("#runbook").open ? "term" : "runbook");
  $("#runbook").addEventListener("toggle", () => { $("#runbookBtn").textContent = $("#runbook").open ? "장애 매뉴얼 접기" : "장애 매뉴얼 열기"; });
  $("#qcmd").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { $("#termIn").value = b.dataset.c; $("#termIn").focus(); } });
  $("#termIn").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const v = e.target.value; termHist.push(v); hp = termHist.length;
      const out = runCmd(v);
      termPrint(`<span class="p">${esc(devNow().prompt)}</span> <span class="c">${esc(v)}</span>\n${/^(error|%|Error|ssh:|\s+\^)/.test(out) ? `<span class="e">${esc(out)}</span>` : esc(out)}\n`);
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
const CENTER_ORDER = Object.keys(TOPOLOGY.centers);
const RACKS = [...DATA.racks].sort((x, y) => CENTER_ORDER.indexOf(codeOf(x.id)) - CENTER_ORDER.indexOf(codeOf(y.id)));   // 센터 순서(서초, 분당, 구로, 안산)대로
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
  $("#srTime").addEventListener("change", e => { if (e.target.value) { timeNote(e.target, parseT(e.target.value)); sr.end = idxOf(parseT(e.target.value)); renderServerRoom(); } });
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
  HL.clear(); sr.end = NOW_IDX; setCenter("ALL");
}
const SCN_TICK = 450;   // 가상 5분이 0.45초. 단계가 나오면 팝업이 뜨고, '다음 단계'를 누를 때까지 멈춘다
const KIND_CLS = { 감지: "crit", 확인: "", 조치: "warn", 결과: "ok" };
const isoIdx = t => idxOf(parseT(t));
const hhmm = i => hm(msOf(i));
const g1 = v => v.toFixed(1);
const outAt = (id, t) => LINK[id].out[isoIdx(t)], inAt = (id, t) => LINK[id].in[isoIdx(t)];
const utilAt = (id, t) => outAt(id, t) / LINK[id].cap * 100;
const prevDay = t => isoLocal(parseT(t) - 86400000);
const runOn = (devId, cmd, down, atIso) => {   // down: 이 시나리오에서 Down이라고 가정할 포트 이름들 (실행 뒤 원래대로 되돌린다)
  const d = DEV[devId], saved = [];
  (down || []).forEach(p => { const f = findIf(d, p); if (f) { saved.push([f, f.slice()]); f[5] = "down"; f[3] = -40; f[2] = 0; } });
  try { return `${d.prompt} ${cmd}\n${runCmd(cmd, d, atIso ? parseT(atIso) : undefined)}`; } finally { saved.forEach(([f, o]) => o.forEach((v, k) => { f[k] = v; })); }
};

// 숫자는 전부 데이터에서 읽어 문장을 만든다 (고정 문구 아님)
const addExplain = (def, texts, devs, lesson) => { def.steps.forEach((st, k) => { if (texts[k]) st.explain = texts[k]; if (devs && devs[k]) st.devs = devs[k]; }); if (lesson) def.lesson = lesson; };
// 수신 광값 읽는 법: 10G LR(SFP+) 모듈 데이터시트의 수신 범위(약 -14.4 ~ +0.5 dBm)는 판매처 자료 기준이고 모듈마다 조금씩 다릅니다. -9 dBm 경고선과 평소값 -3 dBm 안팎은 이 사이트에서 제가 정한 값입니다.
const OPTIC_GUIDE = "[수신 광값 읽는 법 - 10G LR(SFP+) 기준, 모듈마다 조금씩 다름]\n  +0.5 ~ -9 dBm   : 정상 (이 사이트의 평소값은 -3 dBm 안팎)\n  -9 ~ -14.4 dBm  : 약함 - 아직 동작하지만 케이블·SFP 점검 대상 (-9 dBm 경고선은 이 사이트가 정한 값)\n  -14.4 dBm 아래  : 수신 한계 아래 - 끊기거나 오류가 남\n  -40 dBm         : 빛이 전혀 안 들어옴 (끊김, 상대 장비 꺼짐)\n  +0.5 dBm 위     : 너무 강함 (과입력)\n  * 평소값보다 3 dBm 이상 떨어졌다면 범위 안이라도 변화가 있다는 신호입니다.";
function buildScenarios(opts) {   // opts.cause: 업링크 회선 다운의 복구 원인 (work·transient·fiber)
  const TD = Lib.TEMP_DEFAULTS;
  const OA = "IDC_B_FS1_UP1", OB = "IDC_B_FS1_UP2", IX = "IDC_B_FS2_IX1", INTL = "IDC_B_FS2_INTL1", EDGE = "IDC_B_FS2";   // 아래에서 새 이름으로 바뀐다

  // 1) 평일 오후 7시: 평소 점검
  const calmFrom = "2026-10-22T18:30", c2 = "2026-10-22T18:45", c3 = "2026-10-22T19:00", c4 = "2026-10-22T19:30";
  const maxU = t => Math.max(...LINKS.map(l => l.out[isoIdx(t)] / l.cap)) * 100;
  const maxT = t => Math.max(...RACKS.map(r => r.temp[isoIdx(t)]));
  const fans = RACKS.flatMap(r => r.devices.filter(dv => dv.fanWarn).map(dv => dv.id));
  const near = ALERTS.filter(a => Math.abs(a.s - isoIdx(c4)) <= 12).length + Lib.detectRoom(RACKS, TD).filter(a => Math.abs(a.s - isoIdx(c4)) <= 12).length;
  const calm = { name: "평일 오후 7시", tab: "monitor", win: 12, from: calmFrom, to: "2026-10-22T19:40", steps: [
    { at: calmFrom, kind: "확인", title: `그래프 ${LINKS.length}개 확인: 가장 높은 사용률 ${maxU(calmFrom).toFixed(0)}% (경고선 80% 아래)`, focus: LINKS.map(l => l.id) },
    { at: c2, kind: "확인", title: `서버실 확인: 랙 입구 온도 최고 ${g1(maxT(c2))}°C (주의 기준 ${TD.warn}°C 아래), LED 정상${fans.length ? `, 팬 주의 ${fans.join(", ")}(교체 대기)` : ""}` },
    { at: c3, kind: "확인", title: `저녁 피크로 올라가는 중: ${OA} out ${g1(outAt(OA, calmFrom))}G → ${g1(outAt(OA, c3))}G, 평소 범위`, focus: [OA] },
    { at: c4, kind: "결과", title: `이상 없음: 이 시각 전후 새 경고 ${near}건. 점검 기록을 남기고 다음 점검으로`, focus: [] }
  ] };

  const INQUIRY = "\n\n[연동망에 문의할 때 확인할 3가지]\n가. NOC 작업 유/무\n나. 연동 구간(타 부서·타 ISP) 작업 및 이슈 유/무\n다. 보안 관련 이슈 유/무\n* 전화로 내용을 전달받을 때는 통화한 분의 성함을 꼭 확인해서 기록한다.";
  addExplain(calm, [
    "평일 저녁 피크 직전의 평소 점검입니다. 관제 화면의 그래프를 훑어보면서 사용률이 경고선(80%)에 가까운 회선이 없는지 봅니다. 이 시각에는 어느 회선도 경고선 근처가 아닙니다.",
    "서버실 점검입니다. 랙 입구 온도와 장비 LED를 봅니다. 모든 랙이 주의 기준 아래이고 LED도 정상입니다. 팬 경고가 계속 켜져 있는 장비는 교체 대기 중이라 '알려진 상태'로 기록해 둡니다.",
    "저녁 피크로 올라가는 중입니다. 지금 값을 같은 시각의 평소 곡선과 비교하고, 평소 범위 안에서 오르고 있으므로 이상으로 보지 않습니다.",
    "점검을 마칩니다. 이 시각 전후에 새 경고가 없었으므로 '이상 없음' 점검 기록을 남기고 다음 점검 시각으로 넘어갑니다."
  ], [null, fans.slice(0, 2), null, null], "평소 점검은 '경고선 근처인 회선이 있나, 온도·LED가 평소와 같은가'를 같은 순서로 보는 일입니다. 평소 값을 알고 있어야 이상이 눈에 띕니다.");

  // 2) 트래픽 급감: 국내 연동(IX)
  const dropA = ALERTS.find(a => a.link === IX && a.kind.includes("급감"));
  const dt = m => isoLocal(msOf(dropA.s) + m * 60000);   // 급감이 시작된 시각 기준 분
  const pct = (outAt(IX, dt(0)) / outAt(IX, prevDay(dt(0))) * 100).toFixed(0);
  const ixCust = CUSTOMERS.find(c => c.links.includes(IX)).name;
  const dropMail = `제목: [${COMPANY}] 국내 연동(IX) 트래픽 감소 확인 중\n\n${ixCust} 담당자님, 안녕하세요. ${COMPANY} 관제입니다.\n${hhmm(dropA.s)}부터 국내 연동(IX) 트래픽이 평소의 ${pct}% 수준으로 줄어든 것을 확인했습니다.\n현재 일부 트래픽은 해외 연동으로 우회되어 서비스는 유지되고 있습니다.\n상대 사업자에 확인을 요청했고, 진행 상황은 다시 안내드리겠습니다. (가상 메일)`;
  const dropRecover = `제목: [${COMPANY}] 국내 연동(IX) 트래픽 감소 건 복구 완료 안내\n\n${ixCust} 담당자님, 안녕하세요. ${COMPANY} 관제입니다.\n앞서 안내드린 국내 연동(IX) 트래픽 감소 건이 복구되어 안내드립니다.\n\n- 발생: ${hhmm(dropA.s)}\n- 복구: ${hhmm(dropA.e + 1)} (약 ${(dropA.e - dropA.s + 1) * 5}분)\n- 현재: 국내 연동(IX) 트래픽이 평소 수준(전날 같은 시각 ${g1(outAt(IX, prevDay(dt(50))))}G, 현재 ${g1(outAt(IX, dt(50)))}G)으로 돌아왔고, 우회되던 해외 연동 트래픽도 평소로 돌아왔습니다.\n- 원인: 연동 상대 구간 이슈로 확인했습니다. (가상)\n\n서비스 이용에 불편을 드려 죄송합니다. 이후에도 이상이 있으면 관제(${COMPANY})로 연락 주세요. 감사합니다. (가상 메일)`;
  const drop = { name: "트래픽 급감", tab: "monitor", win: 12, from: dt(-20), to: dt(60), steps: [
    { at: dt(0), kind: "감지", title: `${IX}(국내 연동) out이 전날 같은 시각 ${g1(outAt(IX, prevDay(dt(0))))}G에서 ${g1(outAt(IX, dt(0)))}G로 급감 (평소의 ${pct}%). 종 알림에 '확인 필요'로 등록`, focus: [IX] },
    { at: dt(5), kind: "확인", title: `같은 시각 ${INTL}(해외 연동) out ${g1(outAt(INTL, dt(-5)))}G → ${g1(outAt(INTL, dt(5)))}G로 증가: 빠진 트래픽 일부가 해외 회선으로 우회 중으로 보임`, focus: [IX, INTL] },
    { at: dt(10), kind: "조치", title: `${EDGE}에서 ${IX} 포트(xe-0/0/2) 광값 확인`, detail: runOn(EDGE, "show interfaces diagnostics optics xe-0/0/2") + `\n\n→ 광 수신값 ${DEV[EDGE].ifs.find(x => x[0] === "xe-0/0/2")[3].toFixed(2)} dBm: 정상 범위입니다. 우리 쪽 광 문제는 아님\n\n` + OPTIC_GUIDE, sum: `광 수신 ${DEV[EDGE].ifs.find(x => x[0] === "xe-0/0/2")[3].toFixed(2)} dBm: 정상 범위(10G LR 기준 약 -14.4 ~ +0.5 dBm, 평소값 -3 dBm 안팎), 알람 없음 → 우리 쪽 광 문제는 아님`, detailLabel: "터미널 출력 보기", focus: [IX] },
    { at: dt(15), kind: "조치", title: `상대 IX 사업자에 확인 요청, 영향 고객사(${ixCust})에 상황 안내`, detail: dropMail + INQUIRY, detailLabel: "고객사 안내 메일·연동망 문의 항목 보기" },
    { at: dt(50), kind: "결과", title: `${IX} 회복: out ${g1(outAt(IX, dt(50)))}G (전날 같은 시각 ${g1(outAt(IX, prevDay(dt(50))))}G). 급감 구간 ${hhmm(dropA.s)}~${hhmm(dropA.e)} (${(dropA.e - dropA.s + 1) * 5}분)`, focus: [IX, INTL] },
    { at: dt(55), kind: "결과", title: "복구 안내 메일 발송, 경고 이력에 기록하고 마무리", detail: dropRecover, detailLabel: "복구 안내 메일 보기", focus: [IX] }
  ] };

  addExplain(drop, [
    `국내 연동(IX) 회선 ${IX}의 out 트래픽이 전날 같은 시각의 약 ${pct}% 수준으로 갑자기 떨어졌습니다. 같은 시각의 다른 회선은 그대로라서, 센터 전체가 아니라 이 연동 회선 쪽 문제로 좁혀집니다. 종 알림에는 '확인 필요'로 등록됩니다.`,
    `IX에서 빠진 트래픽이 해외 연동(${INTL})으로 돌아서 들어오고 있습니다. 한쪽이 빠지면 다른 쪽이 오르는 모양이라 서비스는 끊기지 않았지만, 해외 회선의 사용률이 평소보다 높아졌는지 같이 봐야 합니다.`,
    "우리 쪽 문제인지 확인하는 단계입니다. 광 수신값이 정상 범위(10G LR 기준 약 -14.4 ~ +0.5 dBm 안, 이 사이트의 평소값은 -3 dBm 안팎)이고 CRC 오류도 없으니 우리 쪽 케이블·SFP 문제는 아닙니다. 그래서 상대 구간(연동 상대)을 의심합니다. 아래 출력 끝에 수신 광값을 읽는 기준표가 있습니다.",
    "원인이 우리 쪽이 아니므로 상대 IX 사업자에 확인을 요청하고, 영향이 있는 고객사에는 상황을 알립니다. 연동망에 문의할 때는 NOC 작업, 연동 구간 이슈, 보안 이슈 세 가지를 꼭 묻고 통화한 분의 성함을 기록합니다.",
    "트래픽이 돌아왔습니다. 회복 시각을 기록하고, 다운 구간의 길이와 전날 값과의 차이를 확인합니다.",
    "복구 안내 메일을 보내고 경고 이력에 기록해 마무리합니다."
  ], [null, null, [EDGE], null, null, null], "트래픽이 갑자기 빠지면 '우리 쪽(광값·CRC)인가, 상대 쪽인가'를 먼저 가르고, 상대 쪽이면 연동망에 3가지(NOC 작업·연동 구간 이슈·보안 이슈)를 묻습니다.");

  // 2-2) 업링크 회선 다운: 안산 -> 중앙 백본 (업무 메모의 장애 대응 순서를 일반화한 것)
  const DN = "IDC_A_FS1_UP1", dnA = ALERTS.find(a => a.link === DN && a.kind.includes("급감")), dn = m => isoLocal(msOf(dnA.s) + m * 60000);
  const dlk = TOPOLOGY.links.find(l => l.link === DN), dDev = dlk.a, dPort = dlk.ap, dPeerIp = DEV[dDev].ifs.find(x => x[0] === dPort)[8];
  const dnBefore = outAt(DN, dn(-5)), dnAfter = outAt(DN, dn(5)), dnCust = custOf(DN);
  const dnWin = (dnA.e - dnA.s + 1) * 5;
  const hhAt = m => hm(parseT(dn(m))), dnIp = DEV[dDev].ifs.find(x => x[0] === dPort)[7], dnCenter = TOPOLOGY.centers[dDev.split("_")[1]].replace(" 센터", "");
  const dnBase = { center: dnCenter, title: `${dnCust.join(", ")} 고객사 중앙 백본 업링크 단선`, target: `${dDev}(${dnIp})`, from: md(msOf(dnA.s)) };
  const dnActs = [
    { t: hhAt(0), txt: `${DN} Down 알람 발생`, sub: ["[관제사이트] 확인"] },
    { t: hhAt(3), txt: "장비 접속 및 회선 확인", sub: ["Admin up / Link down 확인"] },
    { t: hhAt(10), txt: "광값·CRC 확인", sub: ["수신 광값 -40 dBm (빛이 안 들어옴)"] },
    { t: hhAt(13), txt: "ARP·ping 확인", sub: ["ARP 없음, ping 100% 손실"] },
    { t: hhAt(16), txt: "연동망(상대 센터) 통화 문의", sub: ["NOC 작업, 연동 구간 이슈, 보안 이슈 유무 문의", "확인 후 전달 예정"] }
  ];
  const dnSms = smsNotice({ ...dnBase, stage: "발생", cause: `안산 ↔ 중앙 백본 업링크(${DN})가 끊겨 확인 중`, impact: "파악중", voc: "파악중" });
  const dnProgress = smsNotice({ ...dnBase, stage: "경과", cause: "상대 구간 원인 파악 후 통보 예정", actions: dnActs, impact: "우회 경로로 서비스 유지 중, 영향 범위 확인 중", voc: "파악중" });
  const peerDev = dlk.b, dnEndTxt = hm(msOf(dnA.e)), dnStartTxt = hm(msOf(dnA.s));
  const optBefore = runOn(dDev, `show interfaces diagnostics optics ${dPort}`, [dPort]), optAfter = runOn(dDev, `show interfaces diagnostics optics ${dPort}`);
  // 복구된 이유는 여러 가지다: 상대 구간 작업이 끝났거나, 일시적인 오류였거나, 광 케이블·SFP가 고장 나서 교체했거나. (원인 내용은 제가 만든 가상 사례)
  const LDC = {
    work: {
      short: "상대 구간 작업이 끝나 자동 복구",
      title: `원인 확인: 연동망 회신 - 상대(${peerDev}) 쪽 작업이었고 끝나면서 복구됨 (사전 공지 누락)`,
      detail: `[연동망(상대 센터 NOC) 회신 - 통화한 분 성함 기록]\n- ${peerDev} 쪽 포트 점검 작업을 ${dnStartTxt}부터 진행했습니다.\n- 작업 대상에 우리 회선이 들어 있는 것을 몰랐고, 사전 공지가 빠졌습니다.\n- 작업은 ${dnEndTxt}에 끝났고, 끝나면 연결이 자동으로 복구됩니다.\n\n[우리 쪽 조치]\n- 없음 (복구 대기). 복구되면 광값·ping을 다시 확인한다.\n- 사전 공지가 빠진 점은 재발 방지로 연동망에 요청한다.`,
      explain: "연동망에서 회신이 왔습니다. 이번 원인은 우리 쪽이 아니라 상대 구간의 작업이었고, 작업이 끝나면서 회선이 저절로 돌아옵니다. 우리가 한 일은 없지만, 복구 뒤에 광값과 ping을 다시 확인하고 사전 공지가 없었던 점을 재발 방지로 요청합니다. 이런 경우가 실제로 꽤 있습니다.",
      acts: [{ t: hhAt(22), txt: "연동망 회신: 상대 구간 작업이었음", sub: ["작업이 끝나면 자동 복구 예정", "사전 공지 누락 재발 방지 요청"] }],
      cause: `상대 구간(${peerDev}) 작업으로 회선 단절, 작업 완료 후 자동 복구 (사전 공지 누락은 재발 방지 요청)`
    },
    transient: {
      short: "일시적인 오류 (자동 복구, 원인 특정 불가)",
      title: "원인 확인: 뚜렷한 원인 없이 일시 오류로 보임 (자동 복구, 재발 감시)",
      detail: `[확인 결과]\n- 로그: ${dnStartTxt}에 링크 Down, ${hhAt(dnWin)}에 Up. 그 사이 반복해서 내려갔다 올라간 기록은 없음\n- 연동망(상대 센터) 회신: 작업·알람 특이사항 없음, 보안 이슈 없음\n- 복구 뒤 광값·CRC: 수신 -3 dBm대로 정상, CRC 증가 없음\n→ 뚜렷한 원인을 찾지 못해 '일시 오류'로 정리합니다.\n\n[우리 쪽 조치]\n- 재발 감시: 같은 포트를 일정 기간 집중해서 감시한다 (광값·CRC·로그).\n- 같은 포트가 또 끊기면 광 케이블·SFP 점검과 교체를 요청한다.`,
      explain: "상대 구간에도 작업이나 알람이 없고, 우리 쪽 광값·CRC도 정상으로 돌아왔습니다. 이럴 때는 원인을 특정하지 못한 채 '일시 오류'로 닫는 경우가 실제로 많습니다. 대신 재발을 지켜보다가 같은 포트가 다시 끊기면 그때 광 케이블이나 SFP를 교체하러 갑니다.",
      acts: [{ t: hhAt(22), txt: "연동망 회신: 작업·알람 특이사항 없음", sub: ["우리 쪽 광값·CRC 확인", "재발 시 광 케이블·SFP 점검 예정"] }],
      cause: "일시적인 회선 오류로 추정(원인 특정 불가), 자동 복구. 재발 시 광 케이블·SFP 점검 예정"
    },
    fiber: {
      short: "광 모듈(SFP) 불량을 교체해서 복구",
      title: `원인 확인: 현장 점검 결과 ${dDev} ${dPort}의 광 모듈(SFP) 불량 - 교체 진행`,
      detail: `[현장(센터) 점검 결과 - 담당자 성함 기록]\n- ${dDev} ${dPort}의 SFP를 뽑아서 확인: 광 모듈 불량 (수신 광값 -40 dBm, 광 케이블을 청소해도 같음)\n- ${hhAt(26)} 예비 SFP로 교체하고 광 케이블을 청소한 뒤 다시 연결\n\n[교체 전]\n${optBefore}\n\n[교체 후]\n${optAfter}\n\n* 오래된 광 케이블이나 SFP는 이렇게 고장이 나서 교체해야 하는 경우가 많습니다.\n* 이미 끊겨 있는 회선이라 교체 작업의 추가 영향은 없지만, 정상 회선이라면 작업 전에 고객 안내와 우회가 필요합니다.`,
      explain: "현장에서 SFP(광 모듈)를 확인해 보니 불량이었습니다. 이 경우는 상대 구간이 아니라 우리 쪽 부품 문제라서 예비 SFP로 교체합니다. 교체한 뒤에는 수신 광값이 평소(-3 dBm대)로 돌아오는지 꼭 확인합니다. 광 케이블이 오래되었거나 접촉이 나쁜 경우도 같은 방식으로 교체합니다.",
      acts: [{ t: hhAt(22), txt: `현장 점검: ${dPort} 광 모듈(SFP) 불량 확인` }, { t: hhAt(26), txt: "예비 SFP로 교체, 광 케이블 청소", sub: ["교체 후 수신 광값 -3 dBm대 확인"] }],
      cause: "광 모듈(SFP) 불량으로 회선 단절 → 예비 모듈로 교체 후 복구"
    }
  };
  const cause = LDC[(opts && opts.cause) || "work"];
  const dnRecover = smsNotice({ ...dnBase, stage: "완료", to: md(msOf(dnA.e + 1)), cause: cause.cause, actions: [...dnActs, ...cause.acts, { t: hhAt(dnWin), txt: "회선 복구 확인", sub: [`${DN} out ${g1(outAt(DN, dn(dnWin)))}G로 회복`] }], impact: "우회 경로로 서비스 유지, 고객 영향 없음 (가상)", voc: "없음" });
  const linkDown = { name: "업링크 회선 다운", tab: "monitor", win: 12, from: dn(-20), to: dn(dnWin + 15), steps: [
    { at: dn(0), kind: "감지", title: `${DN} in·out이 거의 0으로 떨어짐 (전날 같은 시각 out ${g1(outAt(DN, prevDay(dn(0))))}G → ${g1(outAt(DN, dn(0)))}G). 종 알림에 '확인 필요'로 등록`, focus: [DN] },
    { at: dn(3), kind: "확인", title: `정확한 장비·회선명 확인: ${dDev} ${dPort}. descriptions로 보면 Admin up / Link down`, detail: runOn(dDev, "show interfaces descriptions", [dPort]) + "\n\n→ Admin = 관리자가 켜 둔 상태, Link = 실제 연결 상태.\n   Admin up + Link down: 누가 일부러 내린 게 아니라 선이나 상대 쪽 문제로 끊긴 것.\n   (Admin down이면 누군가 포트를 일부러 내려 둔 것)\n고객 회선은 줄마다 '장비 고객사 속도'가 같이 보인다.", sum: "Admin up, Link down → 실제 연결이 끊긴 것. 고객사도 확인", detailLabel: "터미널 출력 보기", focus: [DN] },
    { at: dn(5), kind: "확인", title: `트래픽(전/후) 확인: Down이면 5분 전 값만 보고 이후는 0 (OUT 기준)`, detail: `■ 트래픽(전/후)\n${DN} : ${g1(dnBefore)}Gbps / ${dnAfter < 0.5 ? "0" : g1(dnAfter) + "Gbps"}\n\n* 경과 문자가 나가기 전에 트래픽을 먼저 전달해야 하므로 빠르게 확인한다.`, detailLabel: "경과 문자에 넣을 트래픽 보기", focus: [DN] },
    { at: dn(7), kind: "조치", title: `발생 문자 전송, 영향 고객사(${dnCust.join(", ")})에 안내`, detail: dnSms, detailLabel: "발생 문자 보기", focus: [DN] },
    { at: dn(10), kind: "조치", title: "광값·CRC 확인: 빛이 안 들어옴 (광 케이블 접촉 불량이나 SFP 불량이 많음)", detail: runOn(dDev, `show interfaces diagnostics optics ${dPort}`, [dPort]) + "\n\n" + runOn(dDev, `show interfaces extensive ${dPort} | match CRC`, [dPort]) + "\n\n→ 수신 광값이 -40 dBm이면 빛이 안 들어오는 것. 케이블·SFP·상대 장비 쪽을 의심한다.\n\n" + OPTIC_GUIDE, sum: `광 수신 -40 dBm → 빛이 안 들어옴 (케이블·SFP 의심)`, detailLabel: "터미널 출력 보기", focus: [DN] },
    { at: dn(13), kind: "조치", title: "IP 확인과 ping: ARP가 없고 ping 100% 손실", detail: runOn(dDev, `show arp | match ${dPort}`, [dPort]) + "(출력 없음: 링크가 Down이면 ARP 항목이 없다)\n\n" + runOn(dDev, `ping ${dPeerIp} rapid count 100`, [dPort]) + "\n\n* L2 장비는 IP가 안 나오므로 MAC 주소로 찾는다.", sum: "ARP 없음, ping 100% 손실 → 상대 쪽까지 안 닿음", detailLabel: "터미널 출력 보기", focus: [DN] },
    { at: dn(16), kind: "조치", title: "연동망(상대 센터)에 문의 후 조장에게 전달", detail: "[연동망에 문의할 때 확인할 3가지]\n가. NOC 작업 유/무\n나. 연동 구간(타 부서·타 ISP) 작업 및 이슈 유/무\n다. 보안 관련 이슈 유/무\n\n* 통화한 분의 성함을 확인해서 기록하고, 경과나 원인을 알게 되면 바로바로 전달한다.\n* 확인한 내용(트래픽 전/후, 광값, CRC, ping 결과)은 조장에게 함께 전달한다.\n\n[경과 문자 예시] 복구 전까지는 계속 '경과'로 보냅니다\n" + dnProgress, detailLabel: "문의 항목·경과 문자 보기", focus: [DN] },
    { at: dn(22), kind: "확인", title: cause.title, detail: cause.detail, detailLabel: "원인 확인 내용 보기", focus: [DN] },
    { at: dn(dnWin), kind: "결과", title: `${DN} 회복 (${cause.short}): out ${g1(outAt(DN, dn(dnWin)))}G (다운 구간 ${hhmm(dnA.s)}~${hhmm(dnA.e)}, ${dnWin}분). 조장에게 결과 전달, 완료 문자 발송`, detail: optAfter + "\n\n→ 수신 광값이 평소(-3 dBm대)로 돌아왔고 회선이 다시 Up입니다. 모든 조치가 끝났으므로 '완료' 문자를 보냅니다.\n\n[완료 문자 예시]\n" + dnRecover, detailLabel: "복구 확인·완료 문자 보기", focus: [DN] }
  ] };

  addExplain(linkDown, [
    `안산 센터에서 중앙 백본으로 가는 업링크(${DN})의 in·out이 거의 0으로 떨어졌습니다. 속도가 줄어든 게 아니라 0에 가까우므로, 회선이 끊긴 것으로 의심합니다.`,
    `정확한 장비·회선명을 확인합니다. ${dDev}의 ${dPort} 포트가 이 회선입니다. descriptions 출력에서 Admin은 관리자가 켜 둔 상태, Link는 실제 연결 상태입니다. Admin up인데 Link down이므로 누가 일부러 내린 게 아니라 연결이 끊긴 것입니다.`,
    "트래픽 전/후를 확인해서 경과 문자에 넣을 값을 정합니다. Down이면 5분 전 값만 보고 이후는 0으로 적습니다(OUT 기준). 경과 문자가 나가기 전에 트래픽을 먼저 전달해야 합니다.",
    "영향을 받는 고객사에 발생 문자를 보냅니다. 문자는 발생 → 경과 → 완료 순서이고, 이 문자는 첫 번째인 '발생'입니다. 아직 원인을 모르니 서비스영향과 VOC는 '파악중'으로 씁니다. 이 회선을 쓰는 고객사는 관련 회선 표의 고객사 열에서 확인합니다.",
    "광값과 CRC를 봅니다. 수신 광값이 -40dBm이면 빛이 전혀 들어오지 않는 것입니다. 광 케이블 접촉 불량이나 SFP 불량이 흔한 원인이라 이 둘을 먼저 의심합니다.",
    "상대 장비까지 닿는지 ping으로 봅니다. 링크가 Down이면 ARP도 비어 있고 ping도 100% 실패합니다. 우리 장비까지는 정상이고 선 건너편이 안 보이는 것으로 정리합니다.",
    "연동망(상대 센터)에 문의합니다. NOC 작업 유/무, 연동 구간 작업·이슈 유/무, 보안 이슈 유/무 세 가지를 묻고, 통화한 분의 성함을 기록합니다. 확인한 내용은 조장에게 전달합니다.",
    cause.explain,
    "회선이 복구되었습니다. 복구 시각과 트래픽 회복 값을 확인하고, 모든 조치가 끝났으므로 '완료' 문자를 보냅니다. 완료는 정말 다 끝났을 때만 쓰고, 그 전에는 '경과'로 보냅니다. 완료 문자에는 시작과 끝 일시, 조치 시간표가 들어갑니다."
  ], [null, [dDev], null, null, [dDev], [dDev], null, [dDev, peerDev], [dDev]], "끊긴 회선은 descriptions의 Admin/Link로 먼저 찾고, 광값·CRC → ping → 상대 구간 문의 순서로 좁혀 갑니다. 복구되는 이유는 크게 셋입니다: 상대 구간 작업이 끝났거나, 일시 오류였거나, 광 케이블·SFP가 고장 나서 교체했거나. 원인에 따라 마무리가 다릅니다(재발 방지 요청, 재발 감시, 교체). 문자는 발생 → 경과 → 완료 순서로, 완료는 정말 끝났을 때만 보냅니다.");

  // 3) 트래픽 폭주: 축구 결승
  const ev = DATA.events.find(e => e.name === "축구 결승"), cc = evCalc(ev);
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

  addExplain(surge, [
    "축구 결승 경기 30분 전입니다. 경기 전날 고객사에 '이 회선으로 보내 달라'고 미리 안내해 두었고, 오늘은 그 안내대로 트래픽이 들어오는지 지켜봅니다.",
    "예상 트래픽이 회선 용량을 넘을 것 같아서 일부를 여유 있는 다른 회선으로 돌립니다(분산). 다른 센터 회선으로 돌릴 때는 먼저 협의합니다.",
    "킥오프입니다. 트래픽이 평소 곡선이 아니라 경기 곡선을 따라 오르기 시작합니다.",
    "하프타임 하이드레이션 타임에 트래픽이 잠깐 줄었다가 다시 오릅니다. 급감 경고가 아니라 경기 일정으로 설명되는 하락입니다.",
    "최고점에서 경고선 80%에 닿았습니다. 분산 상태와 영향을 받는 고객사를 집중해서 확인합니다.",
    "경기 종료 직후 트래픽이 급락하는 것은 정상입니다. 이것도 경기 일정으로 설명됩니다.",
    "사후 정리입니다. 예상과 실제 최대치를 비교해서 다음 경기의 배율을 보정합니다."
  ], null, "경기·행사 때의 급증과 급감은 '이벤트 일정과 겹치는지'부터 확인하면 대부분 설명됩니다. 겹치지 않는 급증은 DDoS 가능성을 봅니다.");

  // 4) 서버실 온도 변화: IDC_B_R08 냉각 이상
  const COOL = "IDC_B_R08", R3 = RACKS.find(r => r.id === COOL), al = Lib.detectRoom(RACKS, TD).find(a => a.rack === COOL);
  const fc = R3.temp.findIndex((t, i) => i >= al.s && t >= TD.crit), dv = R3.devices.find(x => x.downStart);
  const dMs = parseT(dv.downStart), tAt = i => g1(R3.temp[i]);
  const lk = TOPOLOGY.links.find(l => l.b === dv.id && DEV[l.a]), peer = DEV[lk.a], pif = peer.ifs.find(x => x[0] === lk.ap);   // 꺼진 장비와 이어진 상대 쪽 포트
  const tmDev = R3.devices.map(x => x.id).join("·"), tmPartner = DEV[dv.id].partner, tmAt = ms => hm(ms);
  const tmBase = { center: TOPOLOGY.centers[COOL.split("_")[1]].replace(" 센터", ""), title: `${COOL} 랙 입구 온도 경고`, target: `${COOL}(${tmDev})`, from: md(msOf(al.s)) };
  const tmSms = smsNotice({ ...tmBase, stage: "발생", cause: `랙 입구 온도 상승(${TD.hot}°C 이상), 냉각 이상 의심`, impact: "파악중", voc: "파악중" });
  const tmDone = smsNotice({ ...tmBase, stage: "완료", to: md(parseT("2026-10-26T17:15")), cause: "냉각 이상으로 랙 입구 온도 상승 → 냉각 복구 후 정상", actions: [
    { t: tmAt(msOf(al.s)), txt: `${COOL} 입구 온도 경고 알람`, sub: ["[관제사이트] 확인"] },
    { t: tmAt(msOf(fc) + 15 * 60000), txt: "냉각기 점검(티켓)·육안점검 요청" },
    { t: tmAt(dMs), txt: `${dv.id} 과열로 꺼짐 확인`, sub: ["옆 장비 포트 Down, 광 수신 -40 dBm", "터미널 응답 없음"] },
    { t: tmAt(parseT("2026-10-26T17:15")), txt: "냉각 복구, 온도 정상 확인" }
  ], impact: `${dv.id} 꺼짐(${hm(dMs)}~${hm(parseT(dv.downEnd))}), 짝 장비 ${tmPartner}(${DEV[tmPartner].rack})가 받아 고객 영향 없음`, voc: "없음" });
  const temp = { name: "서버실 온도 변화", tab: "room", center: "B", from: "2026-10-26T14:30", to: "2026-10-26T17:20", steps: [
    { at: isoLocal(msOf(al.s)), kind: "감지", title: `${COOL} 입구 온도 ${TD.hot}°C 이상 (${tAt(al.s)}°C): 온도 경고 등록`, focus: [COOL] },
    { at: isoLocal(msOf(fc)), kind: "감지", title: `${TD.crit}°C 이상 (${tAt(fc)}°C): 장비 LED 상태가 빨강 깜박임`, focus: [COOL] },
    { at: isoLocal(msOf(fc) + 15 * 60000), kind: "조치", title: "냉각기 점검 요청(티켓)과 육안점검 요청", detail: tmSms, detailLabel: "발생 문자 보기", focus: [COOL] },
    { at: isoLocal(dMs), kind: "감지", title: `${dv.id} 과열로 꺼짐 (전원 LED 꺼짐)`, focus: [COOL] },
    { at: isoLocal(dMs + 10 * 60000), kind: "조치", title: `터미널로 ${dv.id} 쪽과 이어진 ${peer.id} 포트(${lk.ap}) 확인: 빛이 안 들어와서 ${dv.id}이 꺼진 것으로 확인`, detail: runOn(peer.id, `show interfaces diagnostics optics ${lk.ap}`, null, isoLocal(dMs + 10 * 60000)) + `\n\n터미널로 ${dv.id}에 직접 들어가 보면:\n` + runOn(dv.id, "show interfaces descriptions", null, isoLocal(dMs + 10 * 60000)), sum: `광 수신 ${withTime(dMs + 10 * 60000, () => pif[3]).toFixed(2)} dBm, 수신 낮음 알람 켜짐 → 빛이 안 들어옴. ${dv.id} 터미널은 응답 없음`, detailLabel: "터미널 출력 보기", focus: [COOL] },
    { at: isoLocal(msOf(al.e) + 5 * 60000), kind: "확인", title: `냉각 복구: ${TD.hot}°C 아래로 내려옴 (${tAt(al.e + 1)}°C)`, focus: [COOL] },
    { at: "2026-10-26T17:15", kind: "결과", title: `복구 완료 (${tAt(isoIdx("2026-10-26T17:15"))}°C). 육안점검 기록 남김: ${COOL} 이상 있음 → 정상 복귀`, detail: tmDone, detailLabel: "완료 문자 보기", focus: [COOL] }
  ] };

  addExplain(temp, [
    `랙 ${COOL}의 입구 온도가 경고 기준 이상으로 올랐습니다. 이 랙에는 ${R3.devices.map(x => x.id).join("·")}가 들어 있습니다. 이 장비들의 이중화 짝(${R3.devices.map(x => DEV[x.id].partner).join("·")})은 전기가 다른 쪽 랙(${[...new Set(R3.devices.map(x => DEV[DEV[x.id].partner].rack))].join("·")})에 있어서 이 온도 문제의 영향을 받지 않습니다. 온도 경고가 등록되고 육안점검 대상이 됩니다.`,
    "온도가 위험 기준(33°C)을 넘으면 장비 LED의 상태 불빛이 빨간색으로 깜박입니다. 이제 장비가 스스로 꺼질 수 있는 단계입니다.",
    "냉각기 점검을 요청(티켓)하고 현장 육안점검을 요청합니다. 온도가 더 오르기 전에 먼저 알리는 것이 중요합니다.",
    `과열을 견디지 못한 ${dv.id}이 보호 종료로 꺼졌습니다. 전원 LED가 꺼진 상태입니다. 짝 장비 ${DEV[dv.id].partner}는 다른 랙(${DEV[DEV[dv.id].partner].rack})에 있어서 켜져 있고, 고객 회선은 그쪽으로 이어집니다.`,
    `꺼진 장비는 터미널로 들어가도 응답이 없습니다. 대신 옆 장비(허브)에서 이 장비와 이어진 포트를 보면 Down이고 광 수신이 -40dBm입니다. 이것으로 '장비가 꺼졌다'를 확인합니다. 아래 출력의 두 번째 부분이 ${dv.id}에 직접 들어가 본 결과입니다.`,
    "냉각이 복구되어 온도가 경고 기준 아래로 내려왔습니다. 꺼진 장비는 스스로 켜지지 않으므로, 온도가 안정된 것을 확인한 뒤에 사람이 전원을 다시 올립니다.",
    "복구가 끝났습니다. 육안점검 기록을 남기고, 꺼졌던 장비가 정상으로 돌아왔는지 확인합니다."
  ], [null, null, null, [dv.id, DEV[dv.id].partner], [dv.id, peer.id], null, [dv.id]], "온도가 오르면 장비가 스스로 꺼질 수 있습니다. 꺼진 장비는 터미널로 확인할 수 없으니 옆 장비의 포트 상태로 확인하고, 다른 랙에 있는 짝 장비가 살아 있는지 같이 봅니다.");

  // 5) 이중화로 무사히 넘기기: 장비 한 대가 꺼져도 짝 장비가 같은 고객 회선을 받아서 큰 장애 없이 넘어간다
  const o2 = OUTAGES.find(o => o.dev !== dv.id), D1 = o2.dev, D2 = DEV[D1].partner, rt = m => isoLocal(o2.s + m * 60000), downMin = Math.round((o2.e - o2.s) / 60000);
  const lu = DEV[D1].ifs.filter(f => f[10] && !f[11]), sumG = lu.reduce((q, f) => q + f[9], 0), g10 = lu.filter(f => f[9] === 10).length;
  const custOn = [...new Set(lu.map(f => f[10].customer))], rLinks = CUSTOMERS.filter(c => custOn.includes(c.name)).flatMap(c => c.links).filter(id => LINK[id] && codeOf(id) === codeOf(D1));
  const rFocus = [...new Set(rLinks)].slice(0, 3);
  const trafficTxt = (m0, m1) => rFocus.map(id => `${id}: ${g1(outAt(id, rt(m0)))}G → ${g1(outAt(id, rt(m1)))}G (${((outAt(id, rt(m1)) / outAt(id, rt(m0)) - 1) * 100).toFixed(1)}%)`).join("\n");
  const hubIp = withTime(o2.s + 20 * 60000, () => (DEV[D2].ifs.find(f => f[8] && f[5] === "up") || [])[8]);
  const rdBase = { center: TOPOLOGY.centers[D1.split("_")[1]].replace(" 센터", ""), title: `${D1} 장비 전원 꺼짐 (고객 영향 없음)`, target: `${D1}(${DEV[D1].rack})`, from: md(o2.s) };
  const rdActs = [
    { t: hm(o2.s), txt: `${D1} 꺼짐 알람 발생`, sub: ["[관제사이트] 확인", "터미널 접속 안 됨"] },
    { t: hm(o2.s + 3 * 60000), txt: `짝 장비 ${D2} 확인`, sub: ["고객 회선 그대로 Up, 이중화로 전환 없이 유지"] },
    { t: hm(o2.s + 8 * 60000), txt: `${D1} 전원 모듈 교체 요청(티켓)` }
  ];
  const rdSms = smsNotice({ ...rdBase, stage: "발생", cause: `${o2.why}으로 보임`, impact: `없음 (짝 장비 ${D2}에서 같은 고객 회선을 받고 있음)`, voc: "없음" });
  const rdProgress = smsNotice({ ...rdBase, stage: "경과", cause: `${o2.why}으로 보임`, actions: [...rdActs, { t: hm(o2.e), txt: `${D1} 전원 복구, 이중화 복귀 확인` }], impact: `없음 (짝 장비 ${D2}에서 같은 고객 회선을 받음). 전원 모듈 교체 일정 협의 중`, voc: "없음" });
  const rdDone = smsNotice({ ...rdBase, stage: "완료", to: md(o2.e + 5 * 60000), cause: `${o2.why}, 이중화로 고객 영향 없이 복구`, actions: [...rdActs, { t: hm(o2.e), txt: `${D1} 전원 복구, 이중화 복귀 확인` }, { t: hm(o2.e + 5 * 60000), txt: "전체 상태 정상 확인" }], impact: "없음 (이중화로 고객 회선 유지)", voc: "없음" });
  const redundancy = { name: "이중화로 무사히 넘기기", tab: "monitor", center: codeOf(D1), win: 12, from: rt(-30), to: rt(downMin + 20), steps: [
    { at: rt(-10), kind: "확인", title: `평소: 짝 장비 ${D1}·${D2} 모두 정상, 같은 고객 회선이 두 장비에 똑같이 꽂혀 있음`, detail: runOn(D1, "show interfaces descriptions", null, rt(-10)), detailLabel: `${D1} 회선 목록 보기`, sum: `고객 회선 ${lu.length}개 사용 중 (10G ${g10}개, 1G ${lu.length - g10}개)`, focus: rFocus },
    { at: rt(0), kind: "감지", title: `${D1} 전원 꺼짐 (${o2.why}). 서버실 경고가 뜨고 터미널로 접속이 안 됨`, detail: runOn(D1, "show interfaces descriptions", null, rt(1)), detailLabel: `${D1} 터미널 시도 결과 보기`, focus: rFocus },
    { at: rt(3), kind: "확인", title: `짝 장비 ${D2}에서 보면 고객 회선은 그대로 Up, ${D1}과 이어진 짝 연결(PAIR1)만 Down`, detail: runOn(D2, "show interfaces descriptions", null, rt(3)), detailLabel: `${D2} 회선 목록 보기`, sum: "고객 회선은 짝 장비로 계속 이어짐", focus: rFocus },
    { at: rt(5), kind: "확인", title: "트래픽은 거의 그대로: 고객 회선이 짝 장비로 이어져 그래프 변화가 거의 없음", detail: `■ 트래픽 (장비 다운 직전 → 5분 뒤, OUT)\n${trafficTxt(-5, 5)}\n\n* 그래프가 거의 변하지 않았으므로 고객 장애는 없는 것으로 판단한다.`, detailLabel: "트래픽 비교 보기", focus: rFocus },
    { at: rt(8), kind: "조치", title: `고객 영향이 없어 고객 안내는 하지 않고, 조장에게 보고하고 ${D1} 전원 모듈 교체를 요청`, detail: `[발생 문자 예시] 고객 영향이 없어도 장비가 꺼진 것은 전파합니다.\n` + rdSms + `\n\n* 조장에게 보고하고 ${D1} 전원 모듈 교체를 요청했습니다(티켓). 짝 장비 ${D2} 한 대로 운영 중이므로 교체 전까지 ${D2} 상태를 주의해서 봅니다.`, detailLabel: "발생 문자 보기", focus: rFocus },
    { at: rt(20), kind: "확인", title: `지금은 ${D2} 한 대로 버티는 중: 이 장비를 더 주의해서 확인 (ping 정상)`, detail: runOn(D2, `ping ${hubIp} rapid count 100`, null, rt(20)) + "\n\n* 한 대가 더 죽으면 진짜 장애가 된다. 교체가 끝날 때까지 이 장비의 로그·CRC·온도를 계속 확인한다.", detailLabel: "터미널 출력 보기", focus: rFocus },
    { at: isoLocal(o2.e), kind: "확인", title: `${D1} 전원 복구: 이중화 복귀 확인 (회선 목록이 다시 Up)`, detail: runOn(D1, "show interfaces descriptions", null, isoLocal(o2.e + 60000)) + "\n\n[경과 문자 예시] 장비는 돌아왔지만 전원 모듈 교체가 남아 있으므로 아직 '완료'가 아니라 '경과'입니다.\n" + rdProgress, detailLabel: `${D1} 회선 목록·경과 문자 보기`, focus: rFocus },
    { at: rt(downMin + 5), kind: "결과", title: `고객 영향 없음. 이중화가 없었다면 고객사 ${custOn.length}곳의 회선 ${lu.length}개(합계 ${sumG}G)가 ${downMin}분 끊겼을 것 (가정)`, detail: "[완료 문자 예시] 이중화 복귀와 전체 정상까지 확인한 뒤에만 '완료'로 보냅니다.\n" + rdDone, detailLabel: "완료 문자 보기", focus: rFocus }
  ] };
  addExplain(redundancy, [
    `새벽 시간입니다. 이중화는 같은 고객 회선을 서로 다른 장비 두 대(${D1}, ${D2})에 똑같이 꽂아 두는 것입니다. 두 장비는 서로 다른 랙(${DEV[D1].rack}, ${DEV[D2].rack})에 있어서, 한쪽 전기가 나가도 반대쪽이 살려 줍니다. 두 장비의 회선 목록이 같은 포트로 보입니다. 평소에는 두 장비가 함께 트래픽을 나눠 받는다고 가정합니다.`,
    `${D1}이 꺼졌습니다(${o2.why}). 서버실 경고가 뜨고, 이 장비에 터미널로 접속하려고 하면 응답이 없습니다. 꺼진 장비는 직접 확인할 수 없습니다.`,
    `꺼지지 않은 짝 장비 ${D2}로 가서 같은 명령을 칩니다. 고객 회선은 전부 그대로 Up이고, ${D1}과 직접 이어진 짝 연결 포트만 Down입니다. 이 결과가 '회선은 짝 장비로 계속 이어진다'는 증거입니다.`,
    "그래프를 확인합니다. 장비가 꺼지기 직전과 5분 뒤의 값이 거의 같습니다. 고객의 트래픽이 끊기지 않고 짝 장비로 이어졌다는 뜻입니다.",
    "고객에게 영향이 없으므로 고객 안내 문자는 보내지 않습니다. 대신 조장에게 보고하고, 꺼진 장비의 전원 모듈 교체를 요청합니다. 영향이 없어도 장비 한 대가 죽은 것은 반드시 보고해야 합니다.",
    `지금은 이중화가 한 쪽만 남은 위험한 시간입니다. ${D2}에 문제가 생기면 진짜 장애가 되므로 이 장비를 더 자주 확인합니다.`,
    `${D1}의 전원이 복구되어 회선 목록이 다시 전부 Up입니다. 이중화가 원래 상태로 돌아왔습니다. 복구 후에도 짝 연결과 고객 회선이 정상인지 확인합니다.`,
    `정리합니다. 이번 장애로 고객 영향은 없었습니다. 만약 이 회선들이 한 장비에만 꽂혀 있었다면 고객사 ${custOn.length}곳의 회선 ${lu.length}개, 합계 ${sumG}G가 ${downMin}분 동안 끊겼을 것입니다(가정).`
  ], [[D1, D2], [D1], [D2], null, [D1, D2], [D2], [D1], [D1, D2]], "중요한 회선은 서로 다른 장비 두 대에 나눠 꽂아 둡니다(이중화). 한 대가 꺼져도 고객 회선은 짝 장비로 이어져서, 장애가 아니라 '조치가 필요한 알림'으로 끝납니다. 다만 한 대로 버티는 동안은 위험한 시간이므로 빨리 복구해야 합니다.");

  // 6) DDoS 공격 수신과 차단: 데이터의 '경기와 겹치지 않는 급증'(IDC_B_FS1_UP2, 새벽)을 DDoS로 본다. 차단 절차는 일반적인 방식이고 현장 프로세스와 다를 수 있다.
  const UP2 = "IDC_B_FS1_UP2", ddA = ALERTS.find(a => a.link === UP2 && a.kind.includes("급증") && !a.evName), dd = m => isoLocal(msOf(ddA.s) + m * 60000), hhd = m => hm(parseT(dd(m)));
  const ddBase = inAt(UP2, dd(-5)), ddPeak = Math.max(...Array.from({ length: ddA.e - ddA.s + 1 }, (_, k) => LINK[UP2].in[ddA.s + k])), ddAtk = ddPeak - ddBase, ddMpps = ddAtk * 1e9 / (138 * 8) / 1e6;
  const ddVictim = "가상물산", ddIp = "198.51.100.77", ddDev = "IDC_B_FS1", ddPort = "xe-0/0/1", ddDevIp = DEV[ddDev].ifs.find(x => x[0] === ddPort)[7];
  const ddAtkTxt = `TCP (${g1(ddAtk)} Gbps / ${ddMpps.toFixed(1)} Mpps)`;
  const ddBlock = { from: hhd(14), to: hhd(40) };
  const ddBase2 = { center: TOPOLOGY.centers[ddDev.split("_")[1]].replace(" 센터", ""), title: `${ddVictim} 고객사 DDoS 공격 수신`, target: `${ddDev}(${ddDevIp})`, from: md(msOf(ddA.s)), attack: ddAtkTxt };
  const ddActs = [
    { t: hhd(0), txt: `${UP2} in 트래픽 급증 알람`, sub: ["[관제사이트] 확인"] },
    { t: hhd(3), txt: "이벤트 일정 확인", sub: ["경기·행사와 겹치지 않음 → DDoS 의심"] },
    { t: hhd(6), txt: "공격 대상·유형 확인", sub: [`대상 ${ddIp}(${ddVictim}), TCP SYN`, `공격량 ${ddAtkTxt}`] },
    { t: hhd(11), txt: "클린존 가입 여부 확인", sub: [`${ddVictim} IP는 클린존 미가입 → 선차단 대상`] },
    { t: hhd(14), txt: `${ddIp}/32 블랙홀 차단 (우리 장비)` },
    { t: hhd(17), txt: "상위 연동망에 블랙홀 요청" }
  ];
  const ddSms = smsNotice({ ...ddBase2, stage: "발생", cause: "DDoS 공격(TCP) 의심", impact: "파악중", voc: "파악중" });
  const ddProgress = smsNotice({ ...ddBase2, stage: "경과", cause: "DDoS 공격(TCP SYN)으로 확인, 선차단(블랙홀) 진행 중", actions: ddActs, impact: `대상 IP(${ddIp}, ${ddVictim}) 접속 불가(블랙홀 중), 그 외 고객 정상`, voc: "파악중" });
  const ddDone = smsNotice({ ...ddBase2, stage: "완료", to: md(parseT(dd(45))), cause: "DDoS 공격(TCP SYN) 종료 확인, 블랙홀 해제", actions: [...ddActs, { t: hhd(30), txt: "회선 in 트래픽 정상화 확인", sub: [`in ${g1(inAt(UP2, dd(30)))}G (평소 ${g1(ddBase)}G 수준)`] }, { t: hhd(40), txt: `${ddIp}/32 블랙홀 해제`, sub: ["공격 종료 확인 후 해제", "서비스 접속 확인"] }], impact: `블랙홀 구간(${ddBlock.from}~${ddBlock.to}) 대상 IP 접속 불가, 해제 후 정상. 그 외 고객 영향 없음`, voc: "없음 (가정)" });
  const ddos = { name: "DDoS 공격 수신", tab: "monitor", center: "B", win: 12, from: dd(-20), to: dd(60), steps: [
    { at: dd(0), kind: "감지", title: `${UP2} in이 평소 ${g1(ddBase)}G에서 ${g1(ddPeak)}G로 급증 (약 ${(ddPeak / ddBase).toFixed(1)}배). 경기 일정과 겹치지 않음 → DDoS 의심`, focus: [UP2] },
    { at: dd(3), kind: "확인", title: `in만 급증하고 out은 그대로: 공격은 들어오기만 한다 (out ${g1(outAt(UP2, dd(-5)))}G → ${g1(outAt(UP2, dd(3)))}G)`, detail: `■ 트래픽 (공격 직전 → 3분 뒤)\nin  : ${g1(inAt(UP2, dd(-5)))}G → ${g1(inAt(UP2, dd(3)))}G\nout : ${g1(outAt(UP2, dd(-5)))}G → ${g1(outAt(UP2, dd(3)))}G\n\n■ 이벤트 일정 확인: 이 시각에 겹치는 경기·행사 없음\n→ 경기 때문에 오른 트래픽이면 in·out이 같이 오르고 일정과 겹칩니다. 이번에는 in만 오르고 일정도 없으므로 공격을 의심합니다.`, detailLabel: "트래픽 비교·이벤트 확인 보기", focus: [UP2] },
    { at: dd(6), kind: "확인", title: `공격 대상·유형·공격량 파악: ${ddIp}(${ddVictim}), TCP SYN, 공격량 ${ddAtkTxt}`, detail: `[가상 flow(트래픽 흐름) 통계 - 상위 목적지]\n목적지 IP          비율   프로토콜     비고\n${ddIp}      94%    TCP SYN     ${ddVictim} 소유 IP\n그 밖의 목적지      6%    -           평소 트래픽\n\n공격량 ${ddAtkTxt}\n* 공격량 = 급증한 양(평소 ${g1(ddBase)}G를 뺀 값). Mpps는 평균 패킷 크기를 138바이트로 가정해서 계산한 값입니다 (작은 패킷이 많은 SYN 공격의 모습).`, detailLabel: "flow 통계 보기", focus: [UP2] },
    { at: dd(8), kind: "조치", title: "발생 문자 전송: 대상 IP·공격량을 넣고, 서비스영향·VOC는 파악중", detail: ddSms, detailLabel: "발생 문자 보기", focus: [UP2] },
    { at: dd(11), kind: "확인", title: `클린존 가입 여부 확인: ${ddVictim}은 미가입 → 프로세스대로 선차단(블랙홀) 대상`, detail: `[클린존 가입 여부 - 가정: 제가 정한 값]\n고객사        클린존   처리\n${ddVictim}      미가입   선차단(블랙홀)  ← 공격 대상\n모의커머스      미가입   (공격 대상 아님)\n가상은행        가입     공격이 오면 클린존으로 우회 (공격만 거르고 정상 트래픽은 전달)\n\n[두 방식의 차이]\n블랙홀 : 그 IP로 가는 트래픽을 전부 버립니다. 빠르고 확실하지만 그 IP도 접속이 안 됩니다(공격자 목적 달성). 가입이 필요 없고 마지막 수단입니다.\n클린존 : 그 IP로 가는 트래픽을 걸러 주는 센터로 돌려서 공격만 버리고 정상 트래픽은 되돌려 줍니다. 가입이 필요합니다.\n\n* 메모: 클린존 가입 IP가 아닌 다른 IP로 공격이 들어오면 프로세스대로 먼저 차단합니다.`, detailLabel: "가입 여부·차단 방식 비교 보기", focus: [UP2] },
    { at: dd(14), kind: "조치", title: `우리 장비에서 ${ddIp}/32 블랙홀 차단 (공격 트래픽을 장비 안에서 버림)`, detail: `[Juniper 예시 형식 - 장비·정책마다 다름, 가상]\nadmin@${ddDev}# set routing-options static route ${ddIp}/32 discard\nadmin@${ddDev}# commit\n\nadmin@${ddDev}> show route ${ddIp}\n${ddIp}/32   *[Static/5] 00:00:12\n                      Discard\n\n* 대상 IP를 두 번 확인합니다 (/32 한 개만). 잘못 쓰면 정상 고객이 끊깁니다.\n* 이 경로를 넣으면 그 IP로 가는 트래픽은 전부 버려지므로 고객사에 먼저 알립니다.\n* 장비 안에서 버리기 때문에 서버는 보호되지만, 회선으로 들어오는 양은 그대로입니다.`, detailLabel: "차단 명령 예시 보기", focus: [UP2] },
    { at: dd(17), kind: "조치", title: "회선 in은 아직 높음 → 상위 연동망에 블랙홀 요청 (연동망 문의 3가지 함께 확인)", detail: `[상위(연동망) 블랙홀 요청]\n- 우리 장비에서 버려도 회선(${UP2})으로 들어오는 공격 양은 줄지 않습니다. 공격이 회선에 들어오기 전에 상위에서 버려야 회선이 안전해집니다.\n- 요청 내용: ${ddIp}/32 블랙홀 (BGP로 요청할 때는 표준 블랙홀 값 65535:666을 붙이는 방식이 일반적. 상대가 받아 주는 조건(보통 /32만)이 있어서 먼저 확인)\n\n[연동망에 문의할 때 확인할 3가지]\n가. NOC 작업 유/무\n나. 연동 구간(타 부서·타 ISP) 작업 및 이슈 유/무\n다. 보안 관련 이슈 유/무\n* 통화한 분의 성함을 확인해서 기록합니다.`, detailLabel: "요청 내용 보기", focus: [UP2] },
    { at: dd(20), kind: "조치", title: "경과 문자 전송: 공격 차단(블랙홀) 중, 대상 IP 접속 불가 안내", detail: ddProgress, detailLabel: "경과 문자 보기", focus: [UP2] },
    { at: dd(30), kind: "확인", title: `in 트래픽 정상화: ${g1(inAt(UP2, dd(30)))}G (평소 ${g1(ddBase)}G 수준). 공격이 끝났는지 계속 지켜봄`, focus: [UP2] },
    { at: dd(45), kind: "결과", title: "공격 종료 확인 후 블랙홀 해제, 서비스 접속 확인. 완료 문자 발송 (해제 전에는 '경과')", detail: `[블랙홀 해제]\nadmin@${ddDev}# delete routing-options static route ${ddIp}/32\nadmin@${ddDev}# commit\n\n* 해제는 공격이 끝난 것을 충분히 확인한 뒤에 합니다. 너무 일찍 풀면 공격이 다시 들어옵니다.\n* 해제 뒤 ${ddVictim} 서비스가 정상 접속되는지 확인하고 고객사에도 알립니다.\n\n[완료 문자 예시] 해제와 서비스 확인까지 끝난 뒤에만 '완료'로 보냅니다.\n` + ddDone, detailLabel: "해제 절차·완료 문자 보기", focus: [UP2] }
  ] };
  addExplain(ddos, [
    `새벽에 ${UP2}의 in 트래픽이 평소의 약 ${(ddPeak / ddBase).toFixed(1)}배로 갑자기 올랐습니다. 먼저 '경기나 행사 때문인가'를 확인해야 하는데, 이 시각에는 일정이 없습니다. 종 알림에 '확인 필요'로 뜨고, DDoS를 의심합니다.`,
    "DDoS의 특징은 들어오는 트래픽(in)만 크게 오르는 것입니다. 정상적인 서비스 이용이 늘면 나가는 트래픽(out)도 같이 오릅니다. in만 오르고 일정도 없으니 공격 가능성이 높아졌습니다.",
    "누구를 향한 공격인지, 어떤 종류인지, 얼마나 큰지 알아야 문자에 쓰고 차단할 수 있습니다. flow 통계에서 목적지가 한 IP에 몰려 있고 TCP SYN이 대부분이면 그 IP를 노린 SYN 공격입니다. 공격량은 Gbps(용량)와 Mpps(초당 패킷 수) 두 가지로 적습니다.",
    "먼저 상황을 전파합니다. 아직 서비스영향과 VOC(고객 문의)는 모르니 '파악중'으로 쓰고, 공격량은 문자에 넣습니다. 문자는 발생 → 경과 → 완료 순서입니다.",
    "차단 방법은 고객이 클린존에 가입했는지에 따라 달라집니다. 클린존 가입 고객이면 공격만 걸러 주는 센터로 우회시킬 수 있지만, 가입하지 않은 IP로 공격이 오면 프로세스대로 먼저 차단(블랙홀)합니다. 이번 대상은 미가입이라 블랙홀입니다. (가입 여부는 제가 정한 가정입니다.)",
    "블랙홀은 대상 IP로 가는 트래픽을 장비 안에서 전부 버리는 방법입니다. 서버는 바로 보호되지만 그 IP도 접속이 안 됩니다. 그래서 대상 IP를 정확히 확인하고(/32 한 개), 고객사에 먼저 알린 뒤 실행합니다.",
    "그래프를 보면 회선으로 들어오는 양(in)은 아직 그대로입니다. 우리 장비 안에서 버려도 회선까지 들어오는 공격은 막지 못하기 때문입니다. 회선이 가득 차면 다른 고객도 영향을 받으므로, 상위 연동망에 같은 블랙홀을 요청해 공격이 회선에 들어오기 전에 버리게 합니다.",
    "복구 전까지는 계속 '경과'로 보냅니다. 이 문자에는 지금까지의 조치 시간표와, 블랙홀 때문에 대상 IP가 접속 불가라는 서비스영향을 씁니다.",
    "상위에서 버려지기 시작하자 회선의 in 트래픽이 평소 수준으로 돌아왔습니다. 하지만 공격이 정말 끝났는지는 더 지켜봐야 합니다. 아직 블랙홀을 풀면 안 됩니다.",
    "공격이 충분히 오래 멈춘 것을 확인한 뒤 블랙홀을 해제하고, 서비스가 정상 접속되는지 확인합니다. 이 모든 것이 끝났을 때 비로소 '완료' 문자를 보냅니다. 완료 문자에는 블랙홀 구간 동안 대상 IP가 접속 불가였다는 점을 적습니다."
  ], [null, null, null, [ddDev], null, [ddDev], [ddDev], null, null, [ddDev]], "DDoS는 ① 이벤트 때문인지 먼저 가르고 ② 대상 IP·종류·공격량을 파악해 문자로 전파한 뒤 ③ 클린존 가입 여부에 따라 차단 방식을 정합니다. 블랙홀은 빠르고 확실하지만 대상 IP도 접속 불가(공격자 목적 달성)라서 마지막 수단이고, 클린존은 공격만 걸러 정상 트래픽은 전달합니다. 우리 쪽 블랙홀만으로는 회선 트래픽이 줄지 않아서 상위 연동망에 요청해야 할 때가 있고, 해제는 공격 종료를 충분히 확인한 뒤에 합니다.");

  return { calm, drop, linkDown, surge, ddos, temp, redundancy };
}
const SCN_LIST = [["live", "DDoS 공격 수신 · 직접 대응 (시험판)", "알림이 늦게 뜨고, 값을 직접 확인·판단·조치하는 실시간 방식"], ["liveLinkDown", "업링크 회선 다운 · 직접 대응 (시험판)", "안산 업링크 Down: 알림 확인 → 회선·광값·ping → 연동망 문의 → 원인 판단 → 복구 확인 → 완료 문자"], ["liveDrop", "트래픽 급감 · 직접 대응 (시험판)", "국내 연동(IX) 급감: 알림 확인 → 경기 일정·우회·광값 → 상대 사업자 문의 → 고객사 안내 → 회복 확인 → 완료 문자"], ["liveRedundancy", "이중화로 무사히 넘기기 · 직접 대응 (시험판)", "장비 한 대가 꺼짐: 꺼진 장비·짝 장비 확인 → 트래픽 비교 → 보고 → 복구 확인 → 경과·완료 문자"]];
let scn = null;
function stopScn() { if (scn && scn.timer) clearInterval(scn.timer); scn = null; HL.clear(); const p = $("#scnPop"); if (p) p.hidden = true; }
function scnSetView(at) {   // at: 보여 줄 시각(기본은 지금 진행 시각). 이전 단계를 볼 때는 그 단계의 시각으로 보여 준다
  const t = at == null ? scn.idx : at;
  if (scn.def.tab === "monitor") { state.end = t; renderAll(); } else { sr.end = t; renderServerRoom(); }
  if (scn.reveal) {   // 강조된 그래프가 막대에 가리거나 화면 밖이면 보이는 곳으로 스크롤
    scn.reveal = false;
    const el = $(scn.def.tab === "monitor" ? ".panel.hl" : ".rack.hl");
    if (el) { const r = el.getBoundingClientRect(), top = $("#scnBar").getBoundingClientRect().bottom; if (r.top < top || r.bottom > innerHeight) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
}
function scnShowDue() {
  const due = scn.steps.filter(st => !st.shown && st.i <= scn.idx);
  due.forEach(st => { st.shown = true; scn.done.push(st); if (st.focus) { HL.clear(); st.focus.forEach(f => HL.add(f)); scn.reveal = true; } });
  if (due.length) { scnRenderSteps(); if (!scn.skip && !scn.modal) scnOpenPop(scn.seen + 1); }
}
/* ---------- 단계 팝업: 어떤 장비·회선이 어떻게 되고 있는지 자세히 ---------- */
function scnDevText(id, i) {   // 그 시각의 장비 상태 한 줄
  const rack = RACKS.find(r => r.devices.some(x => x.id === id)), dv = rack.devices.find(x => x.id === id), st = devState(rack, dv, i);
  return !st.power ? '<span class="crit-t">전원 꺼짐</span>' : st.status === "crit" ? '<span class="crit-t">장애(온도)</span>' : st.status === "warn" ? '<span class="warn-t">주의(온도)</span>' : st.fan === "warn" ? '<span class="warn-t">팬 주의</span>' : "정상";
}
function scnRelatedHtml(st) {
  const i = clamp(st.i, 0, N - 1), foc = st.focus || [], links = foc.filter(id => LINK[id]), racks = foc.filter(id => RACKS.some(r => r.id === id));
  let h = "";
  if (links.length) {
    const sorted = [...links].sort((x, y) => LINK[y].out[i] / LINK[y].cap - LINK[x].out[i] / LINK[x].cap), show = sorted.slice(0, 6);
    h += `<h4>관련 회선 (이 시각 ${hm(msOf(i))})</h4><table class="kv2"><tr><th>회선</th><th>연결 (장비 포트)</th><th class="n">용량</th><th class="n">out / in</th><th>고객사</th></tr>` + show.map(id => {
      const l = TOPOLOGY.links.find(x => x.link === id), L = LINK[id], cu = custOf(id), u = L.out[i] / L.cap * 100;
      return `<tr><td class="mono">${id}</td><td>${l ? `${l.a} ${l.ap} ↔ ${esc(l.b)}${l.bp && l.bp !== "-" ? " " + l.bp : ""}` : ""}</td><td class="n">${L.cap}G</td><td class="n ${u >= 80 ? "crit-t" : ""}">${g1(L.out[i])}G / ${g1(L.in[i])}G (${u.toFixed(0)}%)</td><td>${esc(cu.slice(0, 3).join(" · "))}${cu.length > 3 ? ` 외 ${cu.length - 3}곳` : ""}</td></tr>`;
    }).join("") + `</table>${sorted.length > 6 ? `<p class="note">외 ${sorted.length - 6}개 회선은 관제 화면에서 확인합니다.</p>` : ""}`;
  }
  const devs = st.devs || [];
  if (racks.length) h += `<h4>관련 랙</h4><table class="kv2"><tr><th>랙</th><th class="n">입구 온도</th><th>장비 상태</th></tr>` + racks.map(id => { const r = RACKS.find(x => x.id === id); return `<tr><td class="mono">${id}</td><td class="n ${tempCls(r.temp[i])}">${r.temp[i].toFixed(1)}°C</td><td>${r.devices.map(x => `${x.id} ${scnDevText(x.id, i)}`).join(" · ")}</td></tr>`; }).join("") + "</table>";
  if (devs.length) h += `<h4>관련 장비</h4><table class="kv2"><tr><th>장비</th><th>종류·역할</th><th>랙</th><th>이중화 짝</th><th>이 시각 상태</th></tr>` + devs.map(id => { const d = DEV[id]; return `<tr><td class="mono">${id}</td><td>${{ juniper: "Juniper", cisco: "Cisco Nexus 7710(추정)", huawei: "Huawei" }[d.vendor]} · ${esc(d.role)}</td><td>${d.rack}</td><td class="mono">${d.partner}</td><td>${scnDevText(id, i)}</td></tr>`; }).join("") + "</table>";
  return h;
}
function scnPopupShow(st, k) {
  const lesson = !!st.lesson;
  scn.popK = k;
  $("#scnPopKind").className = "tag " + (KIND_CLS[st.kind] || ""); $("#scnPopKind").textContent = st.kind;
  $("#scnPopTime").textContent = lesson ? "" : ymdhm(msOf(st.i));
  $("#scnPopNo").textContent = lesson ? "정리" : `단계 ${k + 1} / ${scn.steps.length}`;
  $("#scnPopTitle").textContent = st.title;
  const ex = st.explain ? `<div class="explain">${String(st.explain).split("\n").map(x => `<p>${esc(x)}</p>`).join("")}</div>` : "";
  $("#scnPopBody").innerHTML = ex + (lesson ? "" : scnRelatedHtml(st)) + (st.sum ? `<p class="sumline">정리: ${esc(st.sum)}</p>` : "") + (st.detail ? `<h4>${esc(st.detailLabel || "자세한 내용")}</h4><pre>${esc(st.detail)}</pre>` : "");
  $("#scnPopBody").scrollTop = 0;
  const last = k >= scn.done.length - 1;
  $("#scnPopPrev").disabled = k <= 0;
  $("#scnPopNext").textContent = !last ? "다음 ▶" : (scn.finished || scn.idx >= scn.i1 || lesson) ? "닫기" : "계속 진행 ▶";
  $("#scnPop").hidden = false; scn.modal = true;
}
function scnOpenPop(k) {   // k번째 단계의 팝업. 지난 단계도 다시 볼 수 있고, 그 단계 시각의 화면을 보여 준다
  const st = scn.done[k]; if (!st) return;
  scn.seen = Math.max(scn.seen, k); scnPopupShow(st, k); scnSetView(st.i);
}
function scnPopNext() { if (!scn) return; if (scn.popK < scn.done.length - 1) { scnOpenPop(scn.popK + 1); return; } scnPopClose(); }
function scnPopPrev() { if (scn && scn.popK > 0) scnOpenPop(scn.popK - 1); }
function scnPopClose() {   // 팝업을 닫고 진행 시각의 화면으로 돌아와 계속 진행
  if (!scn) return;
  $("#scnPop").hidden = true; scn.modal = false; scnSetView();
  if (!scn.finished && scn.idx >= scn.i1) scnFinish();
}
function scnLessonPop() { if (scn && scn.def.lesson) { scnPopupShow({ kind: "결과", title: "이 시나리오에서 배울 점", explain: scn.def.lesson, i: scn.i1, lesson: true }, scn.done.length); } }
function scnProgress() {
  $("#scnTime").textContent = ymdhm(msOf(scn.idx));
  $("#scnProg").style.width = (scn.finished ? 100 : (scn.idx - scn.i0) / Math.max(1, scn.i1 - scn.i0) * 100) + "%";
  $("#scnTitle").textContent = `시나리오 · ${scn.def.name}${scn.finished ? " (끝)" : ""}`;
  $("#scnPause").textContent = scn.paused ? "계속" : "일시정지"; $("#scnPause").disabled = scn.finished;
  $("#scnPrevStep").disabled = !scn.done.length; $("#scnNextStep").disabled = scn.finished;
}
function scnRenderSteps() {
  const last = scn.done.length - 1;
  $("#scnSteps").innerHTML = scn.done.map((st, k) => `<li class="${k === last && !scn.finished ? "cur" : ""}"><span class="tag ${KIND_CLS[st.kind]}">${st.kind}</span> <b class="mono">${hhmm(st.i)}</b> ${esc(st.title)}${st.sum ? `<span class="muted"> → ${esc(st.sum)}</span>` : ""}${st.detail ? `<details><summary>${esc(st.detailLabel || "자세히")}</summary><pre>${esc(st.detail)}</pre></details>` : ""} <button class="btn sm" data-scnpop="${k}">자세히 팝업</button></li>`).join("");
  const ul = $("#scnSteps"); ul.scrollTop = ul.scrollHeight;
  $("#scnLesson").hidden = !(scn.finished && scn.def.lesson);
}
function scnFinish() { scn.finished = true; clearInterval(scn.timer); scn.timer = null; scnProgress(); scnRenderSteps(); if (!scn.skip && scn.def.lesson && !scn.lessonShown) { scn.lessonShown = true; scnLessonPop(); } }
function scnTick() {
  if (!scn || scn.paused || scn.finished) return;
  if (scn.modal) return;   // 팝업이 열려 있는 동안은 시간이 흐르지 않는다
  if (scn.idx >= scn.i1) { scnFinish(); return; }
  scn.idx++; scnShowDue(); scnSetView(); scnProgress();
}
function startScn(id, opts) {
  stopScn();
  const def = buildScenarios(opts)[id];
  const steps = def.steps.map(st => Object.assign({ i: isoIdx(st.at), shown: false }, st)).sort((a, b) => a.i - b.i);
  scn = { def, steps, i0: isoIdx(def.from), i1: isoIdx(def.to), idx: isoIdx(def.from), done: [], seen: -1, popK: -1, modal: false, skip: false, lessonShown: false, paused: false, finished: false, timer: null };
  state.cust = "all"; state.ymode = "cap";
  setCenter(def.center || "ALL", false);   // 시나리오가 보여 줄 센터 (선택값은 저장하지 않음)
  state.win = def.win || 12;
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
  menu.addEventListener("click", e => { const b = e.target.closest("[data-scn]"); if (b) { closeMenu(); if (b.dataset.scn === "live") { showTab("live"); if (window.LIVE) LIVE.load("ddos"); } else if (b.dataset.scn === "liveRedundancy") { showTab("live"); if (window.LIVE) LIVE.load("redundancy"); } else if (b.dataset.scn === "liveDrop") { showTab("live"); if (window.LIVE) LIVE.load("drop"); } else if (b.dataset.scn === "liveLinkDown") { window.ldRoute = "live"; $("#scnCausePop").hidden = false; } else if (b.dataset.scn === "linkDown") { window.ldRoute = "slides"; $("#scnCausePop").hidden = false; } else startScn(b.dataset.scn); } });
  $$("[data-ldcause]").forEach(b => { b.onclick = () => { $("#scnCausePop").hidden = true; if (window.ldRoute === "live" && window.LIVE) { showTab("live"); LIVE.load("linkDown", { cause: b.dataset.ldcause }); } else startScn("linkDown", { cause: b.dataset.ldcause }); }; });   // 업링크 회선 다운은 복구 원인을 먼저 고른다
  $("#ldCauseCancel").onclick = () => { $("#scnCausePop").hidden = true; };
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  $("#scnPause").onclick = () => { if (scn && !scn.finished) { scn.paused = !scn.paused; scnProgress(); } };
  const skipAll = () => { if (!scn || scn.finished) return; scn.skip = true; scn.modal = false; $("#scnPop").hidden = true; scn.idx = scn.i1; scnShowDue(); scnSetView(); scnFinish(); };
  $("#scnSkip").onclick = skipAll; $("#scnPopSkip").onclick = skipAll;
  $("#scnPopNext").onclick = scnPopNext; $("#scnPopPrev").onclick = scnPopPrev; $("#scnPopX").onclick = scnPopClose;
  $("#scnPrevStep").onclick = () => { if (scn && !scn.modal && scn.done.length) scnOpenPop(scn.done.length - 1); };   // 가장 최근 단계의 팝업을 다시 열고, 거기서 더 이전으로 갈 수 있다
  $("#scnNextStep").onclick = () => { if (!scn || scn.modal || scn.finished) return; const nx = scn.steps.find(s => !s.shown); if (!nx) { scn.idx = scn.i1; scnShowDue(); scnSetView(); scnFinish(); return; } scn.idx = Math.max(scn.idx, nx.i); scnShowDue(); scnSetView(); scnProgress(); };   // 다음 단계 시각으로 바로 건너뜀
  $("#scnLesson").onclick = scnLessonPop;
  $("#scnSteps").addEventListener("click", e => { const b = e.target.closest("[data-scnpop]"); if (b && scn) scnOpenPop(+b.dataset.scnpop); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scnCausePop").hidden) $("#scnCausePop").hidden = true; else if (e.key === "Escape" && scn && scn.modal) scnPopClose(); });
  $("#scnClose").onclick = () => { stopScn(); $("#scnBar").hidden = true; showTab("monitor"); goNow(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  syncHdr(); window.addEventListener("resize", syncHdr);
})();

/* ---------- 서버실-3D 공용: 포트 배치, 장비 상세(포트·광케이블). 3D 화면 자체는 room3d.js ---------- */
// 장비 크기: Cisco는 Nexus 7710(14U, 사진·메모로 추정), Juniper 6U·Huawei 2U와 포트 배치는 제가 만든 가상 그림입니다.
const R3 = { dev: null, port: null, z: 1, focus: null };   // z: 확대 배율, focus: 다시 그린 뒤 화면 가운데에 놓을 위치(그림 좌표)   // 장비 상세(포트·광케이블) 창의 상태
const RACK_U = 42, DEV_U = { cisco: 14, juniper: 6, huawei: 2 }, ROW_N = 8;   // 장비 높이는 제가 만든 가정
const portBad = f => !f[11] && (f[2] > 50 || f[3] < -9);   // 아직 안 쓰는 회선(f[11])은 이상이 아니다
function portPlan(d) {   // 포트를 슬롯·번호 순서대로 위치(0부터)에 놓는다. 위아래 2줄, 왼쪽부터
  const sorted = sortedIfs(d), n = sorted.length;
  const total = d.vendor === "cisco" ? Math.max(48, Math.ceil(n / 12) * 12) : Math.max(24, Math.ceil(n / 24) * 24);
  return { total, cols: total / 2, map: new Map(sorted.map((f, q) => [q, f])) };
}
/* 장비 상세: 포트 배치와 꽂혀 있는 광케이블 (위줄 포트의 케이블은 위로, 아래줄은 아래로) */
function r3Detail() { return withTime(msOf(clamp(sr.end, 0, N - 1)), r3DetailNow); }   // 그 시각의 꺼짐 상태를 반영해서 그린다
function r3DetailNow() {
  const d = DEV[R3.dev], rack = RACKS.find(r => r.id === d.rack), i = clamp(sr.end, 0, N - 1), dv = rack.devices.find(x => x.id === d.id), st = devState(rack, dv, i);
  const pl = portPlan(d), PX = 26, PAD = 20, CARD = d.vendor === "cisco" ? 6 : 0, GAPW = 16, ZONE = 150, HEAD = 26;
  const colX = c => PAD + c * PX + (CARD ? Math.floor(c / CARD) * GAPW : 0);
  const W = colX(pl.cols - 1) + PX + PAD, plateH = HEAD + 2 * 30 + PAD, H = ZONE * 2 + plateH;
  const pos = k => ({ x: colX(Math.floor(k / 2)) + 10, row: k % 2, y: ZONE + HEAD + (k % 2) * 30 });
  const slot = R3.slot, inSlot = k => !slot || (k >= slot.a && k < slot.b), used = [...pl.map.keys()].sort((a, b) => a - b), cabled = used.filter(k => !pl.map.get(k)[11] && inSlot(k)), outNow = outageAt(d.id, msOf(clamp(sr.end, 0, N - 1)));   // 아직 안 쓰는 회선에는 케이블을 그리지 않는다
  const sel = R3.port != null && pl.map.has(R3.port) ? R3.port : null;
  const peerOf = f => { if (f[10]) return { dev: f[1], port: "", kind: `고객 회선 (홈 ${f[10].home})`, gbps: f[9] }; const lk = f[4]; return { dev: f[1], port: lk ? (lk.a === d.id ? lk.bp : lk.ap) : "", kind: lk ? lk.kind : "", gbps: lk ? lk.gbps : "" }; };
  let svg = "", tags = "", plate = "";
  for (let k = 0; k < pl.total; k++) { const p = pos(k), f = pl.map.get(k);
    plate += `<button class="pt${f ? (portBad(f) ? " x" : f[5] === "down" ? " d" : " u") : ""}${k === sel ? " sel" : ""}${inSlot(k) ? "" : " dim"}" data-i="${k}" style="left:${p.x - 10}px;top:${p.y}px" title="포트 ${k}${f ? " → " + f[1] : " (비어 있음)"}">${k}</button>`; }
  [0, 1].forEach(rw => {   // rw 0 = 위줄(케이블 위로), 1 = 아래줄(케이블 아래로)
    const mine = cabled.filter(k => k % 2 === rw);
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
  const rows = used.filter(inSlot).map(k => { const f = pl.map.get(k), pe = peerOf(f);
    return `<tr class="click${k === sel ? " on" : ""}" data-i="${k}"><td>${f[0]}</td><td>${esc(pe.dev)}${pe.port && pe.port !== "-" ? " " + esc(pe.port) : ""}</td><td>${esc(pe.kind || "외부 연결")}</td><td class="n">${pe.gbps}</td><td class="n ${f[3] < -9 ? "crit-t" : ""}">${f[3].toFixed(2)}</td><td class="n ${f[2] > 50 ? "crit-t" : ""}">${f[2]}</td><td class="${f[5] === "down" && !f[11] ? "crit-t" : "muted"}">${f[11] === "unused" ? "미사용 (Link down)" : f[11] === "off" ? "미사용 (Admin down)" : f[6] === "down" ? "Admin down" : f[5] === "down" ? "Link down" : "Up"}</td></tr>`; }).join("");
  const label = { ok: "정상", warn: "주의", crit: "장애", off: "꺼짐" };
  $("#r3Detail").hidden = false;
  $("#r3DBody").innerHTML = `<div class="dhd"><b>${d.id}</b>${slot ? `<span class="tag ok">칸: ${esc(slot.label)}</span><button class="btn sm" id="r3SlotAll" type="button">장비 전체 보기</button>` : ""}<span class="tag">${{ juniper: "Juniper", cisco: "Cisco", huawei: "Huawei" }[d.vendor]}</span><span class="muted">${esc(d.role)} · ${d.rack} · 입구 ${rack.temp[i].toFixed(1)}°C</span>${ledHtml(st)}<span class="muted">전원 ${st.power ? "켜짐" : "꺼짐"} · 상태 ${label[st.status]} · 팬 ${label[st.fan]}</span>${outNow ? `<span class="tag crit">전원 꺼짐${outNow.why ? ": " + esc(outNow.why) : ""}</span>` : ""}<span class="sp"></span><button class="btn" id="r3DTerm">이 장비 터미널 열기</button><button class="btn" id="r3DClose">닫기</button></div>` +
    `<p class="note">노란 선이 꽂혀 있는 광케이블(가상, 단일모드로 가정)이고 빨간 선은 광 수신이 약하거나 CRC 오류가 많은 포트입니다. 회색 포트는 아직 쓰지 않는 회선(Down)이라 케이블을 그리지 않았습니다. 위줄 포트의 케이블은 위로, 아래줄은 아래로 나갑니다. 포트를 누르면 표시됩니다.</p>` +
    `<div class="dzoom"><button class="btn sm" id="r3ZIn" type="button">＋ 확대</button><button class="btn sm" id="r3ZOut" type="button">－ 축소</button><button class="btn sm" id="r3ZFit" type="button">전체 맞춤</button><span class="muted">포트를 누르면 가운데로 확대됩니다. 마우스로 끌어서 옮기고, 휠로 확대·축소합니다. (${Math.round(R3.z * 100)}%)</span></div>` +
    `<div class="dscroll"><div class="dsizer${R3.z > 1 ? " pad" : ""}" style="width:${W * R3.z}px;height:${H * R3.z}px"><div class="dwrap" style="width:${W}px;height:${H}px;transform:scale(${R3.z});transform-origin:0 0"><svg width="${W}" height="${H}">${svg}</svg>` +
    `<div class="plate ${d.vendor}" style="left:0;top:${ZONE}px;width:${W}px;height:${plateH}px"><span class="pl">${d.id} · ${d.vendor === "cisco" ? "Cisco Nexus 7710 (추정)" : d.vendor === "juniper" ? "Juniper" : "Huawei"}</span></div>${plate}${tags}</div></div></div>` +
    `<div class="card" style="padding:0;margin-top:10px;max-height:240px;overflow:auto"><table><tr><th>포트</th><th>연결 상대</th><th>종류</th><th class="n">Gbps</th><th class="n">수신 dBm</th><th class="n">CRC</th><th>상태</th></tr>${rows || `<tr><td colspan="6" class="muted">연결된 포트가 없습니다.</td></tr>`}</table></div>`;
  const sc = document.querySelector("#r3DBody .dscroll");
  if (sc) {
    if (R3.focus) { const o = r3Origin(sc); sc.scrollLeft = o.x + R3.focus.x * R3.z - sc.clientWidth / 2; sc.scrollTop = o.y + R3.focus.y * R3.z - sc.clientHeight / 2; R3.focus = null; }   // 고른 포트를 가운데에
    else if (slot) sc.scrollLeft = Math.max(0, pos(slot.a).x * R3.z - 60);   // 고른 칸이 보이도록 옆으로 옮긴다
  }
  R3.pos = pos;
}
function r3Origin(sc) {   // 그림 왼쪽 위 모서리가 스크롤 영역 안에서 있는 위치 (확대하면 양옆에 빈 칸을 둬서 가장자리 포트도 가운데로 올 수 있다)
  const a = sc.getBoundingClientRect(), b = sc.querySelector(".dwrap").getBoundingClientRect(); return { x: b.left - a.left + sc.scrollLeft, y: b.top - a.top + sc.scrollTop };
}
function r3Zoom(nz, fx, fy) {   // 배율을 바꾸고 (fx, fy: 그림 좌표)가 화면 가운데에 오게 다시 그린다
  R3.z = Math.min(3, Math.max(0.5, nz)); if (fx != null) R3.focus = { x: fx, y: fy }; r3Detail();
}
function r3Open(id, slot) { R3.dev = id; R3.port = null; R3.z = 1; R3.focus = null; R3.slot = slot && slot.ports ? { a: slot.ports[0], b: slot.ports[1], label: slot.label } : null; r3Detail(); }
function r3Close() { R3.dev = null; $("#r3Detail").hidden = true; }
(function initDetailModal() {   // 장비 상세(포트·광케이블) 창의 버튼
  $("#r3Detail").addEventListener("click", ev => {
    if (ev.target.id === "r3Detail" || ev.target.id === "r3DClose") { r3Close(); return; }
    if (ev.target.id === "r3DTerm") { openDeviceTerminal(R3.dev); return; }
    if (ev.target.id === "r3SlotAll") { R3.slot = null; R3.port = null; r3Detail(); return; }
    if (ev.target.id === "r3ZIn" || ev.target.id === "r3ZOut") { const sc = document.querySelector("#r3DBody .dscroll"); { const o = r3Origin(sc); r3Zoom(R3.z * (ev.target.id === "r3ZIn" ? 1.3 : 1 / 1.3), (sc.scrollLeft + sc.clientWidth / 2 - o.x) / R3.z, (sc.scrollTop + sc.clientHeight / 2 - o.y) / R3.z); }; return; }
    if (ev.target.id === "r3ZFit") { R3.z = 1; R3.focus = null; r3Detail(); const sc = document.querySelector("#r3DBody .dscroll"); if (sc) { sc.scrollLeft = 0; sc.scrollTop = 0; } return; }
    if (R3.dragged) { R3.dragged = false; return; }   // 끌어서 옮긴 직후의 클릭은 포트 선택이 아니다
    const pt = ev.target.closest("[data-i]"); if (pt) {
      const k = +pt.dataset.i; R3.port = k; const p = R3.pos(k);
      if (pt.closest(".dwrap")) r3Zoom(Math.max(R3.z, 1.6), p.x, p.y + 10); else r3Detail();   // 포트를 누르면 가운데로 확대
    }
  });
  const dv = $("#r3Detail"); let drag = null;
  dv.addEventListener("pointerdown", ev => { const sc = ev.target.closest(".dscroll"); if (!sc || ev.button !== 0) return; drag = { sc, x: ev.clientX, y: ev.clientY, l: sc.scrollLeft, t: sc.scrollTop, moved: false }; });
  window.addEventListener("pointermove", ev => { if (!drag) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) < 5) return; drag.moved = true; drag.sc.classList.add("grab"); drag.sc.scrollLeft = drag.l - dx; drag.sc.scrollTop = drag.t - dy; });
  window.addEventListener("pointerup", () => { if (drag) { if (drag.moved) { R3.dragged = true; setTimeout(() => { R3.dragged = false; }, 0); } drag.sc.classList.remove("grab"); drag = null; } });
  dv.addEventListener("wheel", ev => { const sc = ev.target.closest(".dscroll"); if (!sc) return; ev.preventDefault(); const r = sc.getBoundingClientRect(), z = R3.z, o = r3Origin(sc), fx = (sc.scrollLeft + ev.clientX - r.left - o.x) / z, fy = (sc.scrollTop + ev.clientY - r.top - o.y) / z; const nz = Math.min(3, Math.max(0.5, z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15))); R3.z = nz; r3Detail(); const s2 = document.querySelector("#r3DBody .dscroll"); if (s2) { const o2 = r3Origin(s2); s2.scrollLeft = o2.x + fx * nz - (ev.clientX - r.left); s2.scrollTop = o2.y + fy * nz - (ev.clientY - r.top); } }, { passive: false });
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
  if (qs.get("t")) TERM.at = parseT(qs.get("t"));
  showTab("term"); termConnect(qs.get("dev"));
  document.title = `${qs.get("dev")} 터미널 (가상)`;
  $("#termIn").focus();
} else {
  showTab(["monitor", "monthly", "event", "room", "room3d", "visit", "term", "sms", "gear", "live"].includes(h0) ? h0 : "monitor");
}
