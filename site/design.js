/* 설계도(그림) + PDF 내려받기. 모든 장비·회선·고객사는 가상이고, 데이터는 topology.js에서 읽는다.
   - 전체 구성도: 서초가 코어 백본 센터이고 나머지 센터가 서초에 붙는 모양.
   - 센터별 구성도: 센터 백본 짝 두 대(A측·B측)에서 버스가 내려오고, 같은 줄·같은 칸의 파란 장비(A측)와 주황 장비(B측)가 이중화 짝이다.
   - PDF: 외부 라이브러리 없이 직접 만든다. 그림은 JPEG로 구워서 PDF 페이지에 넣고(한글이 그대로 나온다), 표는 캔버스에 그려서 같은 방식으로 넣는다. */
const DG_CODES = Object.keys(TOPOLOGY.centers);   // 서초, 분당, 구로, 안산 순서
const DG_HUB = { B: "IDC_B_FS1", S: "IDC_S_FR1", G: "IDC_G_FS1", A: "IDC_A_FS1" };
const DG_FONT = "'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic','Nanum Gothic',sans-serif";
const dgNum = id => +id.match(/(\d+)$/)[1];
const dgCode = id => id.split("_")[1];
const dgPartner = id => TOPOLOGY.devices.find(d => d.id === id).partner;
const dgVendorName = { cisco: "Cisco", juniper: "Juniper", huawei: "Huawei" };
const dgX = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dgTheme(light) {
  return light
    ? { bg: "#ffffff", text: "#111827", sub: "#4b5563", line: "#6b7280", box: "#f3f4f6", boxLine: "#9ca3af", a: "#dbeafe", aLine: "#1d6fb8", b: "#ffedd5", bLine: "#c2610c", core: "#fef3c7", coreLine: "#b45309", ext: "#e5e7eb", warn: "#b91c1c", labelBg: "#ffffff" }
    : { bg: "#0b1015", text: "#e6edf3", sub: "#9aa7b2", line: "#5b6b78", box: "#121a22", boxLine: "#33424f", a: "#17324d", aLine: "#4aa3e3", b: "#3a2a19", bLine: "#e3a04a", core: "#4a3b12", coreLine: "#e3c34a", ext: "#1b242d", warn: "#e5604d", labelBg: "#0b1015" };
}
function dgStats(code) {
  const T = TOPOLOGY, devs = T.devices.filter(d => dgCode(d.id) === code), n = v => devs.filter(d => d.vendor === v).length;
  const cust = T.customers.filter(c => dgCode(c.links[0]) === code);
  return { devs, cisco: n("cisco"), juniper: n("juniper"), huawei: n("huawei"), racks: new Set(devs.map(d => d.rack)).size, cust, big: cust.filter(c => c.big).length };
}
function dgSvg(w, h, body, th, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${DG_FONT}"><rect width="${w}" height="${h}" fill="${th.bg}"/>${body}${footer ? `<text x="${w - 20}" y="${h - 12}" text-anchor="end" font-size="12" fill="${th.sub}">${dgX(footer)}</text>` : ""}</svg>`;
}
const dgText = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 14}" fill="${o.fill}" ${o.bold ? 'font-weight="700"' : ""} ${o.anchor ? `text-anchor="${o.anchor}"` : ""}>${dgX(s)}</text>`;

/* 전체 구성도 */
function dgOverview(light, footer) {
  const th = dgTheme(light), W = 1200, H = 760, T = TOPOLOGY, S = dgStats("S");
  const L = id => T.links.find(l => l.link === id);
  let b = dgText(40, 38, "전체 구성도 (가상)", { size: 24, bold: true, fill: th.text }) + dgText(40, 62, "서초가 코어 백본 센터입니다. 나머지 센터는 서초에 이중화로 붙고, 센터 안의 모든 장비는 서로 다른 랙에 있는 짝 장비와 이중화됩니다.", { size: 13, fill: th.sub });
  // 서초 (코어)
  b += `<rect x="250" y="90" width="700" height="250" rx="10" fill="${th.box}" stroke="${th.coreLine}" stroke-width="2"/>`;
  b += dgText(270, 120, "서초 센터 (코어 백본)", { size: 18, bold: true, fill: th.text });
  b += dgText(270, 142, `장비 ${S.devs.length}대 (Cisco ${S.cisco} · Juniper ${S.juniper} · Huawei ${S.huawei}) · 랙 ${S.racks}개 · 고객사 ${S.cust.length}곳(큰 고객사 ${S.big})`, { size: 12.5, fill: th.sub });
  [["IDC_S_FS1", 330], ["IDC_S_FS2", 670]].forEach(([id, x]) => { b += `<g data-dev="${id}" style="cursor:pointer"><rect x="${x}" y="165" width="200" height="62" rx="6" fill="${th.core}" stroke="${th.coreLine}" stroke-width="2"/>${dgText(x + 100, 192, id, { size: 16, bold: true, fill: th.text, anchor: "middle" })}${dgText(x + 100, 214, "중앙 백본 (대형)", { size: 12, fill: th.sub, anchor: "middle" })}</g>`; });
  b += `<line x1="530" y1="190" x2="670" y2="190" stroke="${th.coreLine}" stroke-width="3"/><line x1="530" y1="204" x2="670" y2="204" stroke="${th.coreLine}" stroke-width="3"/>` + dgText(600, 182, "중앙 백본 간 400G ×2", { size: 11.5, fill: th.sub, anchor: "middle" });
  b += dgText(270, 262, "서초 센터 백본(Cisco 짝): IDC_S_FR1 · IDC_S_FR2   ↔ 중앙 백본 IDC_S_FS2 (IDC_S_FR1_UP1, 400G)", { size: 12.5, fill: th.text });
  b += dgText(270, 284, "고객사: " + S.cust.map(c => c.name).join(", "), { size: 12, fill: th.sub });
  b += dgText(270, 306, "CDN 연결: 서초 중앙 백본 IDC_S_FS1 ↔ 분당 IDC_B_FS3 (100G)", { size: 12, fill: th.sub });
  // 아래 센터들
  const low = [["B", 30], ["G", 420], ["A", 810]];
  low.forEach(([c, x]) => {
    const s = dgStats(c);
    b += `<rect x="${x}" y="470" width="360" height="190" rx="10" fill="${th.box}" stroke="${th.boxLine}" stroke-width="1.5"/>`;
    b += dgText(x + 16, 498, TOPOLOGY.centers[c], { size: 17, bold: true, fill: th.text });
    b += dgText(x + 16, 520, `장비 ${s.devs.length}대 · 랙 ${s.racks}개 · 고객사 ${s.cust.length}곳(큰 고객사 ${s.big})`, { size: 12.5, fill: th.sub });
    b += dgText(x + 16, 540, `Cisco ${s.cisco} · Juniper ${s.juniper} · Huawei ${s.huawei}`, { size: 12.5, fill: th.sub });
    const h1 = DG_HUB[c];
    [[h1, 0], [dgPartner(h1), 1]].forEach(([id, k]) => { const bx = x + 16 + k * 168; b += `<g data-dev="${id}" style="cursor:pointer"><rect x="${bx}" y="560" width="160" height="42" rx="6" fill="${k ? th.b : th.a}" stroke="${k ? th.bLine : th.aLine}" stroke-width="1.5"/>${dgText(bx + 80, 579, id, { size: 13, bold: true, fill: th.text, anchor: "middle" })}${dgText(bx + 80, 595, k ? "센터 백본 (B측)" : "센터 백본 (A측)", { size: 11, fill: th.sub, anchor: "middle" })}</g>`; });
    b += dgText(x + 16, 628, "센터 안 장비는 이 백본 짝에 각각 연결", { size: 11.5, fill: th.sub });
  });
  // 센터 -> 서초 회선
  const tw = t => [...t].reduce((q, ch) => q + (ch.charCodeAt(0) > 255 ? 11.5 : 6.4), 0) + 10;   // 글자 폭 추정 (한글은 넓게)
  const ln = (x1, y1, x2, y2, label, o = {}) => {
    const t = o.t == null ? 0.5 : o.t, mx = x1 + (x2 - x1) * t, my = y1 + (y2 - y1) * t, w = label ? tw(label) : 0;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.color || th.line}" stroke-width="${o.w || 2.5}" ${o.dash ? 'stroke-dasharray="7 5"' : ""}/>` + (label ? `<rect x="${mx - w / 2}" y="${my - 10}" width="${w}" height="18" rx="3" fill="${th.labelBg}" stroke="${th.boxLine}" stroke-width=".6"/>${dgText(mx, my + 3.5, label, { size: 11, fill: th.text, anchor: "middle" })}` : "");
  };
  b += ln(90, 470, 330, 340, `UP1 ${L("IDC_B_FS1_UP1").gbps}G`, { t: 0.22 }) + ln(150, 470, 400, 340, `UP2 ${L("IDC_B_FS1_UP2").gbps}G`, { t: 0.5 });
  b += ln(230, 470, 470, 340, `서초→분당 ${L("IDC_S_FS2_TOB1").gbps}G`, { dash: true, color: th.coreLine, t: 0.78 });
  b += ln(600, 470, 600, 340, `구로 UP1 ${L("IDC_G_FS1_UP1").gbps}G`);
  b += ln(930, 470, 760, 340, `UP1 ${L("IDC_A_FS1_UP1").gbps}G`, { t: 0.3 }) + ln(1000, 470, 830, 340, `Cisco ${L("IDC_A_FR1_UP1").gbps}G`, { t: 0.62 });
  // 외부
  [["국내 IX (100G)", 100], ["해외 사업자 (100G)", 270]].forEach(([t, x]) => { b += `<ellipse cx="${x}" cy="718" rx="78" ry="20" fill="${th.ext}" stroke="${th.boxLine}"/>${dgText(x, 722, t, { size: 12, fill: th.text, anchor: "middle" })}<line x1="${x}" y1="698" x2="${x}" y2="660" stroke="${th.line}" stroke-width="2"/>`; });
  b += dgText(40, 752, "분당 IDC_B_FS2가 국내 IX와 해외 사업자에 연결됩니다.", { size: 11.5, fill: th.sub });
  // 범례
  b += `<rect x="620" y="690" width="16" height="14" fill="${th.core}" stroke="${th.coreLine}"/>` + dgText(642, 702, "중앙 백본", { size: 12, fill: th.text });
  b += `<rect x="720" y="690" width="16" height="14" fill="${th.a}" stroke="${th.aLine}"/>` + dgText(742, 702, "A측(홀수 번호)", { size: 12, fill: th.text });
  b += `<rect x="850" y="690" width="16" height="14" fill="${th.b}" stroke="${th.bLine}"/>` + dgText(872, 702, "B측(짝수 번호)", { size: 12, fill: th.text });
  b += `<line x1="990" y1="697" x2="1030" y2="697" stroke="${th.coreLine}" stroke-width="2.5" stroke-dasharray="7 5"/>` + dgText(1038, 702, "서초 경유", { size: 12, fill: th.text });
  b += dgText(620, 730, "용량은 가상 값입니다. 장비를 누르면 그 장비의 터미널로 이동합니다.", { size: 11.5, fill: th.sub });
  return { svg: dgSvg(W, H, b, th, footer), w: W, h: H };
}

/* 센터별 구성도 */
function dgCenter(code, light, footer) {
  const th = dgTheme(light), W = 1200, T = TOPOLOGY, s = dgStats(code), h1 = DG_HUB[code], h2 = dgPartner(h1), BW = 82, BH = 40, STEP = 92, COLS = 6;
  const xA = 40, xB = W - 40 - COLS * STEP + 10, pairsOf = v => s.devs.filter(d => d.vendor === v && dgNum(d.id) % 2 === 1 && d.id !== h1 && d.id !== h2).map(d => [d.id, d.partner]);
  const groups = [["cisco", "Cisco 장비"], ["juniper", "Juniper 장비"], ["huawei", "Huawei 랙 접속 스위치"]].map(([v, name]) => ({ v, name, pairs: pairsOf(v) })).filter(g => g.pairs.length);
  let y = 192, b = dgText(40, 36, `${T.centers[code]} 구성도 (가상)`, { size: 22, bold: true, fill: th.text }) + dgText(40, 58, `장비 ${s.devs.length}대 (Cisco ${s.cisco} · Juniper ${s.juniper} · Huawei ${s.huawei}) · 랙 ${s.racks}개 · 고객사 ${s.cust.length}곳(큰 고객사 ${s.big}). 같은 줄·같은 칸의 파란 장비(A측)와 주황 장비(B측)가 이중화 짝이고, 서로 다른 랙에 있습니다.`, { size: 12.5, fill: th.sub });
  const hubBox = (id, x, side) => `<g data-dev="${id}" style="cursor:pointer"><title>${dgX(`${id} · ${TOPOLOGY.devices.find(d => d.id === id).role} · ${TOPOLOGY.devices.find(d => d.id === id).rack}`)}</title><rect x="${x}" y="78" width="230" height="50" rx="7" fill="${side ? th.b : th.a}" stroke="${side ? th.bLine : th.aLine}" stroke-width="2"/>${dgText(x + 115, 99, id, { size: 15, bold: true, fill: th.text, anchor: "middle" })}${dgText(x + 115, 117, `센터 백본 (${side ? "B" : "A"}측) · ${TOPOLOGY.devices.find(d => d.id === id).rack.split("_")[2]}`, { size: 11.5, fill: th.sub, anchor: "middle" })}</g>`;
  const hx1 = 300, hx2 = W - 300 - 230 + 0;
  b += hubBox(h1, hx1, 0) + hubBox(h2, hx2, 1);
  b += `<line x1="${hx1 + 230}" y1="103" x2="${hx2}" y2="103" stroke="${th.line}" stroke-width="2" stroke-dasharray="6 4"/>` + dgText(W / 2, 96, "짝 장비 연결", { size: 11, fill: th.sub, anchor: "middle" });
  // 버스
  const busY = 156, rA = 22, rB = W - 22;
  b += `<path d="M${hx1 + 115},128 L${hx1 + 115},${busY} L${rA},${busY}" fill="none" stroke="${th.aLine}" stroke-width="3"/><path d="M${hx2 + 115},128 L${hx2 + 115},${busY} L${rB},${busY}" fill="none" stroke="${th.bLine}" stroke-width="3"/>`;
  let lastRowY = busY;
  const rackOf = id => TOPOLOGY.devices.find(d => d.id === id).rack.split("_")[2];
  const custOf = id => (TOPOLOGY.devices.find(d => d.id === id).customers || []).map(k => TOPOLOGY.customers.find(c => c.key === k).name);
  const box = (id, x, yy, side) => { const d = TOPOLOGY.devices.find(q => q.id === id), cu = custOf(id), core = d.tier === "core";
    return `<g data-dev="${id}" style="cursor:pointer"><title>${dgX(`${id} · ${d.role} · 랙 ${d.rack}${cu.length ? " · 고객사: " + cu.join(", ") : ""}`)}</title><rect x="${x}" y="${yy}" width="${BW}" height="${BH}" rx="5" fill="${core ? th.core : side ? th.b : th.a}" stroke="${core ? th.coreLine : side ? th.bLine : th.aLine}" stroke-width="${cu.length || core ? 2 : 1.2}"/>${dgText(x + BW / 2, yy + 17, id.split("_")[2], { size: 14, bold: true, fill: th.text, anchor: "middle" })}${dgText(x + BW / 2, yy + 32, rackOf(id), { size: 10.5, fill: th.sub, anchor: "middle" })}</g>`; };
  groups.forEach(g => {
    b += dgText(W / 2, y + 2, `${g.name} (${g.pairs.length}쌍)`, { size: 13, bold: true, fill: th.text, anchor: "middle" });
    y += 12;
    g.pairs.forEach(([a, p], k) => {
      const row = Math.floor(k / COLS), col = k % COLS, yy = y + row * (BH + 22);
      b += `<line x1="${rA}" y1="${yy + BH / 2}" x2="${xA + col * STEP}" y2="${yy + BH / 2}" stroke="${th.aLine}" stroke-width="1" opacity=".7"/><line x1="${xB + col * STEP + BW}" y1="${yy + BH / 2}" x2="${rB}" y2="${yy + BH / 2}" stroke="${th.bLine}" stroke-width="1" opacity=".7"/>`;
      b += box(a, xA + col * STEP, yy, 0) + box(p, xB + col * STEP, yy, 1);
      lastRowY = Math.max(lastRowY, yy + BH / 2);
    });
    y += Math.ceil(g.pairs.length / COLS) * (BH + 22) + 18;
  });
  b += `<line x1="${rA}" y1="${busY}" x2="${rA}" y2="${lastRowY}" stroke="${th.aLine}" stroke-width="3"/><line x1="${rB}" y1="${busY}" x2="${rB}" y2="${lastRowY}" stroke="${th.bLine}" stroke-width="3"/>`;
  // 고객사
  const names = s.cust.map(c => c.name + (c.big ? "(큰 고객사)" : "")); let line = "", lines = [];
  names.forEach(n => { if ((line + n).length > 96) { lines.push(line); line = ""; } line += (line ? ", " : "") + n; }); if (line) lines.push(line);
  b += dgText(40, y + 8, "이 센터의 고객사", { size: 13, bold: true, fill: th.text }); lines.forEach((t, k) => { b += dgText(40, y + 28 + k * 19, t, { size: 12, fill: th.sub }); });
  y += 36 + lines.length * 19;
  b += `<rect x="40" y="${y}" width="14" height="12" fill="${th.a}" stroke="${th.aLine}"/>` + dgText(60, y + 11, "A측 랙(홀수 번호 장비)", { size: 12, fill: th.text }) + `<rect x="230" y="${y}" width="14" height="12" fill="${th.b}" stroke="${th.bLine}"/>` + dgText(250, y + 11, "B측 랙(짝수 번호 장비)", { size: 12, fill: th.text }) + dgText(430, y + 11, "상자 아래 R숫자 = 들어 있는 랙, 굵은 테두리 = 고객 접속 장비. 위쪽 버스 선은 센터 백본 짝에서 각 장비로 내려가는 연결입니다.", { size: 11.5, fill: th.sub });
  y += 40;
  return { svg: dgSvg(W, y, b, th, footer), w: W, h: y };
}

/* ---------- 화면 ---------- */
let dgCur = "ALL";
function renderDiagram() {
  const box = $("#dgView"); if (!box) return;
  const r = dgCur === "ALL" ? dgOverview(false) : dgCenter(dgCur, false);
  box.innerHTML = r.svg.replace(/<svg /, '<svg class="dgsvg" ');
  $$("#dgTabs button").forEach(b => b.classList.toggle("on", b.dataset.dg === dgCur));
}
(function initDesign() {
  const tabs = $("#dgTabs"); if (!tabs) return;
  tabs.innerHTML = `<button class="btn" data-dg="ALL">전체</button>` + DG_CODES.map(c => `<button class="btn" data-dg="${c}">${TOPOLOGY.centers[c].replace(" 센터", "")}</button>`).join("");
  tabs.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { dgCur = b.dataset.dg; renderDiagram(); } });
  $("#dgView").addEventListener("click", e => { const g = e.target.closest("[data-dev]"); if (g) { showTermPane("term"); selectDevice(g.dataset.dev); window.scrollTo({ top: 0, behavior: "smooth" }); $("#termIn").focus(); } });
  const box = $("#designBox");
  box.addEventListener("toggle", () => { if (box.open) renderDiagram(); });
  $("#dgPdf").onclick = makeDesignPdf;
  if (box.open) renderDiagram();
})();

/* ---------- PDF ---------- */
function dgSvgToCanvas(svg, w, h, scale) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => { const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("그림을 PDF용으로 바꾸지 못했습니다")); };
    img.src = url;
  });
}
function dgTablePages(title, note, headers, rows, widths, footer) {   // 표를 캔버스에 그려서 쪽마다 한 장씩 (A4 가로 비율)
  const PW = 1684, PH = 1191, M = 60, RH = 31, top = 150, per = Math.floor((PH - top - 70) / RH) - 1, pages = [];
  const total = widths.reduce((a, b) => a + b, 0), cw = widths.map(x => x / total * (PW - 2 * M));
  for (let p = 0; p < Math.max(1, Math.ceil(rows.length / per)); p++) {
    const c = document.createElement("canvas"); c.width = PW; c.height = PH; const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, PW, PH); g.fillStyle = "#111827"; g.font = `bold 34px ${DG_FONT}`; g.fillText(`${title}${Math.ceil(rows.length / per) > 1 ? ` (${p + 1}/${Math.ceil(rows.length / per)})` : ""}`, M, 70);
    g.fillStyle = "#4b5563"; g.font = `18px ${DG_FONT}`; g.fillText(note, M, 104);
    let x = M; g.fillStyle = "#e5e7eb"; g.fillRect(M, top - 24, PW - 2 * M, RH); g.fillStyle = "#111827"; g.font = `bold 18px ${DG_FONT}`;
    headers.forEach((h, k) => { g.fillText(h, x + 6, top - 2); x += cw[k]; });
    g.font = `17px ${DG_FONT}`;
    rows.slice(p * per, (p + 1) * per).forEach((r, i) => {
      const yy = top + (i + 1) * RH; if (i % 2) { g.fillStyle = "#f3f4f6"; g.fillRect(M, yy - 24, PW - 2 * M, RH); }
      g.fillStyle = "#111827"; x = M;
      r.forEach((cell, k) => { let t = String(cell); while (g.measureText(t).width > cw[k] - 12 && t.length > 1) t = t.slice(0, -1); if (t !== String(cell)) t = t.slice(0, -1) + "…"; g.fillText(t, x + 6, yy - 3); x += cw[k]; });
    });
    g.fillStyle = "#6b7280"; g.font = `15px ${DG_FONT}`; g.textAlign = "right"; g.fillText(footer, PW - M, PH - 28); g.textAlign = "left";
    pages.push({ canvas: c, w: PW, h: PH });
  }
  return pages;
}
function dgJpeg(canvas) { const b64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1], bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function dgBuildPdf(pages) {   // pages: [{canvas}] -> PDF Blob (A4 가로, 쪽마다 이미지 한 장)
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = b => { const u = typeof b === "string" ? enc.encode(b) : b; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, k) => `${3 + k * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  const PW = 842, PH = 595;
  pages.forEach((p, k) => {
    const n = 3 + k * 3, jpg = dgJpeg(p.canvas), s = Math.min((PW - 36) / p.canvas.width, (PH - 36) / p.canvas.height), w = p.canvas.width * s, h = p.canvas.height * s, x = (PW - w) / 2, y = (PH - h) / 2;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offs[n + 2] = len; push(`${n + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.canvas.width} /Height ${p.canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push("\nendstream\nendobj\n");
  });
  const total = 3 + pages.length * 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(String(offs[n]).padStart(10, "0") + " 00000 n \n");
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
async function makeDesignPdf() {
  const btn = $("#dgPdf"), old = btn.textContent; btn.disabled = true; btn.textContent = "PDF 만드는 중…";
  try {
    const stamp = ymdhm(Date.now()).slice(0, 10), footer = `가상 데이터 · 포트폴리오용 설계도 · ${stamp}`, T = TOPOLOGY, pages = [];
    const ov = dgOverview(true, footer); pages.push({ canvas: await dgSvgToCanvas(ov.svg, ov.w, ov.h, 2) });
    for (const c of DG_CODES) { const r = dgCenter(c, true, footer); pages.push({ canvas: await dgSvgToCanvas(r.svg, r.w, r.h, 2) }); }
    const devOf = k => T.devices.find(d => (d.customers || []).includes(k));
    dgTablePages("고객사", "고객사 19곳(전부 가상). 큰 고객사는 전용 접속 장비와 전용 회선이 있습니다.", ["고객사", "구분", "센터", "접속 장비(전용/대표)", "쓰는 그래프 회선"],
      T.customers.map(c => [c.name, c.big ? "큰 고객사" : "일반", T.centers[dgCode(c.links[0])], (devOf(c.key) || {}).id || "-", c.links.join(", ")]), [2, 1.2, 1.4, 2, 6], footer).forEach(p => pages.push(p));
    dgTablePages("그래프 회선", "관제 그래프에 나오는 회선과 연결 장비·용량(가상).", ["회선", "설명", "용량", "연결", "고객사"],
      DATA.links.map(l => { const t = T.links.find(x => x.link === l.id); return [l.id, l.desc, `${l.cap}G`, t ? `${t.a} ${t.ap} ↔ ${t.b}${t.bp && t.bp !== "-" ? " " + t.bp : ""}` : "", custOf(l.id).slice(0, 4).join(", ")]; }), [2.2, 3.2, 0.8, 4.2, 3], footer).forEach(p => pages.push(p));
    dgTablePages("장비 목록", "장비 120대: Cisco(FR)·Juniper(FS)·Huawei(AS). 이중화 짝은 서로 다른 랙에 있습니다.", ["장비", "종류", "센터", "랙", "이중화 짝", "짝의 랙", "역할"],
      T.devices.map(d => [d.id, dgVendorName[d.vendor], d.center, d.rack, d.partner, T.devices.find(x => x.id === d.partner).rack, d.role]), [1.5, 1, 1.1, 1.2, 1.5, 1.2, 4.5], footer).forEach(p => pages.push(p));
    const blob = dgBuildPdf(pages);
    download(`traffic_design_${stamp.replace(/-/g, "")}.pdf`, blob);
    $("#dgMsg").textContent = `PDF ${pages.length}쪽을 내려받았습니다.`;
  } catch (e) { $("#dgMsg").textContent = "PDF를 만들지 못했습니다: " + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
}
