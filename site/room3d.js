/* 서버실-3D (WebGL, three.js): 서버실을 정면에서 보는 3D 랙 화면.
   - 랙 안에는 설계도(topology.js)의 네트워크 장비가 들어 있다. 패치 패널·케이블 정리대·PDU·빈 패널은 화면을 현실감 있게 하려는 가상 보조 장비로, 데이터 모델에는 없다.
   - Cisco는 Nexus 7710(14U, I/O 8 + 슈퍼바이저 2)로 그렸다: 사진과 메모의 "7710"으로 추정한 것이고 모델은 확인하지 못했다. Juniper 6U·Huawei 2U와 랙 안 배치(U 위치)는 제가 만든 가상 그림이다.
   - three.js는 site/vendor에 넣어 두었고, 이 탭을 처음 열 때만 불러온다. 시점 조작은 직접 짠 간단한 컨트롤(좌우 ±70°로 제한, 관성 없음). */
const G = { gmode: (window.matchMedia && matchMedia("(pointer: coarse)").matches) ? "pan" : "rotate", sel: null, mode: "status", row: 0, center: null, q: "", filt: "all", ready: false, loading: false, dirty: true, items: [], ray: [], hover: null };
const LV_ORDER = { ok: 0, warn: 1, hot: 2, crit: 3 };
const LV_HEX = { ok: "#2f6fb0", warn: "#c9a62f", hot: "#d2692f", crit: "#d03a30" };
const LV_TXT = { ok: "정상", warn: "주의", hot: "경고", crit: "위험" };
const KIND_TXT = { juniper: "Juniper 스위치", cisco: "Cisco Nexus 7710 (사진·메모로 추정, 모델 확인 못 함)", huawei: "Huawei 접속 스위치", patch: "패치 패널", mgr: "케이블 정리대", pdu: "PDU", blank: "빈 패널" };
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/* ---------- 데이터: 랙 안 배치, 상태 ---------- */
function rackLayout(r) {   // 아래(1U)부터 쌓는다. 장비는 설계도 그대로, 나머지는 보조 장비
  const h = hash(r.id), items = []; let cur = 1;
  const big = r.devices.some(d => d.vendor === "cisco");
  if (!big) cur += 2 + (h % 9);   // 랙마다 시작 위치를 다르게 (아래 몇 U는 비워 둠)
  const devs = [...r.devices].sort((a, b) => DEV_U[b.vendor] - DEV_U[a.vendor]);
  devs.forEach((dv, k) => {
    const u = DEV_U[dv.vendor];
    items.push({ kind: dv.vendor, id: dv.id, dv, u0: cur, u }); cur += u;
    if (k < devs.length - 1) { items.push({ kind: "mgr", id: `${r.id.slice(4)}-CM${k + 1}`, u0: cur, u: 1 }); cur += 1; }
  });
  if (big) { items.push({ kind: "patch", id: `${r.id.slice(4)}-PP0`, u0: cur + 1, u: 1 }); items.push({ kind: "mgr", id: `${r.id.slice(4)}-CM9`, u0: cur + 2, u: 1 }); }
  else if (h % 2 === 0) { items.push({ kind: "blank", id: `${r.id.slice(4)}-BL1`, u0: cur + 1, u: 2 }); }
  if (!big && h % 4 === 1) { items.push({ kind: "patch", id: `${r.id.slice(4)}-PP2`, u0: 1, u: 1 }); items.push({ kind: "blank", id: `${r.id.slice(4)}-BL0`, u0: 2, u: 1 }); }
  items.push({ kind: "pdu", id: `${r.id.slice(4)}-PDU`, u0: RACK_U, u: 1 });
  if (h % 3 !== 0) { items.push({ kind: "patch", id: `${r.id.slice(4)}-PP1`, u0: RACK_U - 1, u: 1 }); items.push({ kind: "mgr", id: `${r.id.slice(4)}-CM0`, u0: RACK_U - 2, u: 1 }); }
  return items;
}
function rackStatus(r, i) {   // 온도 단계와 장비 LED 중 가장 나쁜 것
  let w = tempCls(r.temp[i]);
  r.devices.forEach(dv => { const st = devState(r, dv, i); const lv = !st.power ? "crit" : st.status === "crit" ? "crit" : st.status === "warn" ? "hot" : st.fan === "warn" ? "warn" : "ok"; if (LV_ORDER[lv] > LV_ORDER[w]) w = lv; });
  return w;
}
function tempColor(t) {   // 온도 보기용 색 (파랑 -> 초록 -> 노랑 -> 주황 -> 빨강)
  const stops = [[20, [43, 111, 176]], [23, [53, 150, 100]], [27, [201, 166, 47]], [30, [210, 105, 47]], [34, [208, 58, 48]]];
  if (t <= stops[0][0]) return stops[0][1]; if (t >= stops[4][0]) return stops[4][1];
  for (let k = 0; k < 4; k++) if (t <= stops[k + 1][0]) { const f = (t - stops[k][0]) / (stops[k + 1][0] - stops[k][0]); return stops[k][1].map((v, q) => Math.round(v + (stops[k + 1][1][q] - v) * f)); }
}
const rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`, rgbHex = c => (c[0] << 16) | (c[1] << 8) | c[2];
function rackColor(r, i) { return G.mode === "temp" ? tempColor(r.temp[i]) : [...LV_HEX[rackStatus(r, i)].match(/\w\w/g).slice(0, 3)].map(x => parseInt(x, 16)); }
function r3Rows(vr) {
  const rows = [];
  [...new Set(vr.map(r => codeOf(r.id)))].forEach(c => {
    const rs = vr.filter(r => codeOf(r.id) === c);
    for (let k = 0; k < rs.length; k += ROW_N) { const part = rs.slice(k, k + ROW_N);
      rows.push({ code: c, label: `${TOPOLOGY.centers[c]} ${Math.floor(k / ROW_N) + 1}열 (${part[0].id.slice(4)}~${part[part.length - 1].id.slice(4)})`, racks: part }); }
  });
  return rows;
}

/* ---------- three.js 불러오기 (처음 열 때만) ---------- */
function loadThree(cb) {
  if (window.THREE) return cb();
  if (G.loading) return; G.loading = true;
  const s = document.createElement("script"); s.src = "vendor/three.min.js";
  s.onload = () => { G.loading = false; cb(); };
  s.onerror = () => { G.loading = false; $("#glHint").textContent = "3D 라이브러리를 불러오지 못했습니다. 왼쪽 목록과 오른쪽 상세는 그대로 쓸 수 있습니다."; };
  document.head.appendChild(s);
}

/* ---------- 텍스처 그리기 (장비 앞면) ---------- */
const TEX = [];
function canvasTex(w, h, fn) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; fn(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; TEX.push(t); return t;
}
const LEDC = { ok: "#3fd07a", warn: "#e6b93a", crit: "#e5604d", off: "#39444d" };
function grad(g, y0, y1, a, b) { const q = g.createLinearGradient(0, y0, 0, y1); q.addColorStop(0, a); q.addColorStop(1, b); return q; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawPorts(g, pl, a, b, x, y, w, h, cols, rows) {   // 포트 칸 (위아래 2줄, 번호순). 연결됨 = 초록 LED, 이상 = 빨강
  const cw = w / cols, ch = h / rows;
  for (let k = a; k < b; k++) {
    const c = Math.floor((k - a) / rows), rw = (k - a) % rows, f = pl.map.get(k);
    const px = x + c * cw, py = y + rw * ch;
    g.fillStyle = "#14181c"; rr(g, px + 2, py + ch * 0.28, cw - 4, ch * 0.66, 2); g.fill();
    g.fillStyle = f && f[5] !== "down" ? "#2b323a" : "#1d2328"; g.fillRect(px + 4, py + ch * 0.36, cw - 8, ch * 0.46);
    g.fillStyle = f ? (portBad(f) ? LEDC.crit : f[5] === "down" ? LEDC.off : LEDC.ok) : LEDC.off; g.fillRect(px + cw / 2 - 2.5, py + ch * 0.1, 5, ch * 0.12);
  }
}
function drawLeds(g, x, y, st, size) { [st.power ? "ok" : "off", st.power ? st.status : "off", st.power ? st.fan : "off"].forEach((c, k) => { g.fillStyle = LEDC[c === "crit" ? "crit" : c]; g.beginPath(); g.arc(x + k * (size * 2.2), y, size, 0, 7); g.fill(); }); }
function devTexture(it, st, pl) {
  const dv = it.dv, w = 640, h = it.u * 40;
  return canvasTex(w, h, (g) => {
    if (it.kind === "juniper") {
      g.fillStyle = grad(g, 0, h, "#d6dbdf", "#a9b1b8"); g.fillRect(0, 0, w, h);
      g.fillStyle = "#1a2026"; g.fillRect(14, 12, 190, 46); g.fillStyle = "#e6edf3"; g.font = "bold 22px monospace"; g.fillText(dv.id.slice(4), 24, 44);
      g.fillStyle = "#566069"; g.font = "13px monospace"; g.fillText("JUNIPER · 가상", 24, h - 18);
      drawLeds(g, 40, 90, st, 7);
      drawPorts(g, pl, 0, pl.total, 220, 22, 330, h - 44, pl.cols, 2);
      g.fillStyle = "#3a434b"; for (let k = 0; k < 8; k++) g.fillRect(578, 16 + k * ((h - 40) / 8), 48, 5);
    } else if (it.kind === "huawei") {
      g.fillStyle = grad(g, 0, h, "#dfe2e5", "#b6bcc1"); g.fillRect(0, 0, w, h);
      g.fillStyle = "#222a31"; g.fillRect(8, 6, 130, h - 12); g.fillStyle = "#e6edf3"; g.font = "bold 20px monospace"; g.fillText(dv.id.slice(4), 16, h / 2 + 7);
      drawLeds(g, 160, h / 2, st, 5);
      drawPorts(g, pl, 0, pl.total, 205, 6, 340, h - 12, pl.cols, 2);
      g.fillStyle = "#2a3138"; g.fillRect(565, 14, 58, h - 28);
      g.fillStyle = "#3a434b"; for (let k = 0; k < 6; k++) g.fillRect(570, 18 + k * ((h - 36) / 6), 48, 3);
    } else {   // Cisco Nexus 7710 (사진·메모로 추정): 슬롯 10개 = 위 I/O 4 + 슈퍼바이저 2(가운데) + 아래 I/O 4, 맨 아래 전원부
      g.fillStyle = "#23282e"; g.fillRect(0, 0, w, h); g.strokeStyle = "#0b0e11"; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
      const cards = Math.min(8, Math.ceil(pl.total / 12)), supH = 54, psuH = 60, ioH = (h - supH * 2 - psuH - 22) / 8;
      let y = 8, c = 0;
      const io = () => {   // I/O 모듈 슬롯: 포트가 있으면 라인 카드, 남는 슬롯은 빈 판
        if (c < cards) { g.fillStyle = grad(g, y, y + ioH, "#bcc3c9", "#9ca4ab"); g.fillRect(10, y, w - 20, ioH - 4);
          g.fillStyle = "#111519"; g.fillRect(10, y, 22, ioH - 4); g.fillRect(w - 32, y, 22, ioH - 4);
          g.fillStyle = "#2a3138"; g.font = "bold 12px monospace"; g.fillText(`I/O ${c + 1}`, 42, y + 18);
          drawPorts(g, pl, c * 12, c * 12 + 12, 100, y + 4, w - 160, ioH - 12, 6, 2);
        } else { g.fillStyle = "#3b434a"; g.fillRect(10, y, w - 20, ioH - 4); g.fillStyle = "#14181c"; g.beginPath(); g.arc(24, y + ioH / 2 - 2, 5, 0, 7); g.arc(w - 24, y + ioH / 2 - 2, 5, 0, 7); g.fill(); }
        c++; y += ioH;
      };
      for (let k = 0; k < 4; k++) io();
      for (let s = 0; s < 2; s++) { g.fillStyle = grad(g, y, y + supH, "#c9cfd4", "#9aa2a9"); g.fillRect(10, y, w - 20, supH - 6); g.fillStyle = "#111519"; g.fillRect(10, y, 26, supH - 6); g.fillRect(w - 36, y, 26, supH - 6);
        g.fillStyle = "#2a3138"; g.font = "bold 13px monospace"; g.fillText(`NEXUS 7710 · SUP${s + 1} · ${dv.id.slice(4)}`, 50, y + 20); drawLeds(g, 56, y + 38, st, 6);
        for (let q = 0; q < 2; q++) { g.fillStyle = "#111519"; g.fillRect(330 + q * 70, y + 12, 56, 28); } y += supH; }
      for (let k = 0; k < 4; k++) io();
      y += 6;
      for (let k = 0; k < 8; k++) { const px = 12 + k * ((w - 24) / 8); g.fillStyle = grad(g, y, y + psuH, "#2d343b", "#1c2227"); g.fillRect(px, y, (w - 24) / 8 - 6, psuH - 8);
        g.fillStyle = "#0c0f12"; g.fillRect(px + 8, y + 10, (w - 24) / 8 - 22, 26); g.fillStyle = st.power ? LEDC.ok : LEDC.off; g.fillRect(px + 10, y + 42, 8, 6); }
    }
    if (!st.power) { g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 0, w, h); }
  });
}
function decoTexture(it) {
  const w = 640, h = it.u * 40, hs = hash(it.id);
  return canvasTex(w, h, (g) => {
    if (it.kind === "patch") {
      g.fillStyle = "#15191d"; g.fillRect(0, 0, w, h); g.strokeStyle = "#2a3138"; g.strokeRect(1, 1, w - 2, h - 2);
      const cords = ["#e3c34a", "#4aa3e3", "#e36a4a", "#8bd06a", "#c58ae3"];
      for (let k = 0; k < 24; k++) { const x = 40 + k * 24; g.fillStyle = "#2b323a"; g.fillRect(x, 8, 18, 18); g.fillStyle = "#0b0e11"; g.fillRect(x + 3, 11, 12, 12);
        if ((hs >> (k % 24)) & 1) { g.fillStyle = cords[(hs + k) % 5]; g.fillRect(x + 6, 24, 6, 14); } }
      g.fillStyle = "#6c7882"; g.font = "11px monospace"; g.fillText(it.id, 8, 34);
    } else if (it.kind === "mgr") {
      g.fillStyle = "#101316"; g.fillRect(0, 0, w, h); g.fillStyle = "#1d2328"; for (let k = 0; k < 22; k++) g.fillRect(24 + k * 27, 6, 14, h - 12);
    } else if (it.kind === "pdu") {
      g.fillStyle = grad(g, 0, h, "#3a4147", "#262b30"); g.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) { g.fillStyle = "#cfd5da"; g.fillRect(70 + k * 56, 9, 38, 22); g.fillStyle = "#15191d"; g.fillRect(78 + k * 56, 14, 6, 12); g.fillRect(94 + k * 56, 14, 6, 12); }
      g.fillStyle = LEDC.ok; g.fillRect(16, 16, 12, 8); g.fillStyle = "#9aa4ad"; g.font = "bold 12px monospace"; g.fillText("PDU", 520, 26);
    } else {
      g.fillStyle = grad(g, 0, h, "#4a5158", "#353b41"); g.fillRect(0, 0, w, h); g.fillStyle = "#14181c"; g.beginPath(); g.arc(24, h / 2, 6, 0, 7); g.arc(w - 24, h / 2, 6, 0, 7); g.fill();
    }
  });
}
function numberTex() {   // 랙 앞 기둥의 U 번호
  return canvasTex(48, RACK_U * 24, (g, w, h) => { g.fillStyle = "#1a2026"; g.fillRect(0, 0, w, h); g.fillStyle = "#8d99a3"; g.font = "11px monospace"; g.textAlign = "center";
    for (let u = 1; u <= RACK_U; u++) { const y = h - (u - 0.5) * 24; g.fillText(String(u), w / 2, y + 4); g.fillRect(6, h - u * 24, w - 12, 1); } });
}
function labelTex(txt, sub, sel) {
  return canvasTex(256, 112, (g, w, h) => { g.fillStyle = sel ? "#2c6ef2" : "#f1f3f5"; rr(g, 4, 4, w - 8, 62, 8); g.fill(); g.fillStyle = sel ? "#fff" : "#10151a"; g.font = "bold 40px monospace"; g.textAlign = "center"; g.fillText(txt, w / 2, 52);
    g.fillStyle = "#1b2229cc"; rr(g, 20, 74, w - 40, 30, 6); g.fill(); g.fillStyle = "#cfd8df"; g.font = "18px monospace"; g.fillText(sub, w / 2, 96); });
}
function badgeTex(t) {
  const lv = tempCls(t), col = { ok: "#3fa56b", warn: "#d9b13b", hot: "#e5604d", crit: "#e5604d" }[lv];
  return canvasTex(128, 64, (g, w, h) => { g.fillStyle = "#0b0f13"; rr(g, 4, 4, w - 8, h - 8, 10); g.fill(); g.strokeStyle = col; g.lineWidth = 6; rr(g, 4, 4, w - 8, h - 8, 10); g.stroke(); g.fillStyle = "#fff"; g.font = "bold 30px monospace"; g.textAlign = "center"; g.fillText(t.toFixed(1), w / 2 - 6, 44); g.font = "16px monospace"; g.fillText("°C", w - 22, 44); });
}
function floorTex() {
  return canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#2a3036"; g.fillRect(0, 0, w, h); g.fillStyle = "#1a1f24"; for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); }
    g.strokeStyle = "#0c0f12"; g.lineWidth = 4; g.strokeRect(0, 0, w, h); });
}

/* ---------- 장면 ---------- */
const SC = { U: 0.0445, RW: 0.6, RD: 0.9, GAP: 0.07, BASE: 0.1, FW: 0.482 };
const rackH = () => SC.BASE + RACK_U * SC.U + 0.04;
function initGL() {
  const cv = $("#glCanvas"), wrap = $("#glWrap");
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setClearColor(0x05080b);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x05080b, 9, 22);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xcfe0f2, 0x1a1f24, 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(2, 5, 6); scene.add(dl);
  const fl = new THREE.PointLight(0x9fc4ff, 0.5, 14); fl.position.set(0, 2.6, 2.5); scene.add(fl);
  const t = floorTex(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 20);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 2.2); scene.add(floor);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), new THREE.MeshStandardMaterial({ color: 0x0d1217, roughness: 1 })); back.position.set(0, 3, -1.2); scene.add(back);
  const root = new THREE.Group(); scene.add(root);
  Object.assign(G, { r, scene, cam, root, ray: [], rc: new THREE.Raycaster(), cs: { az: 0, pol: 88, dist: 7, tx: 0, ty: 1.0 }, ready: true });
  const ro = new ResizeObserver(() => { sizeGL(); }); ro.observe(wrap);
  sizeGL(); bindControls(cv);
}
function sizeGL() {
  if (!G.ready) return; const w = $("#glWrap").clientWidth, h = $("#glWrap").clientHeight; if (!w || !h) return;
  G.r.setSize(w, h, false); G.cam.aspect = w / h; G.cam.updateProjectionMatrix(); G.dirty = true;
}
function placeCam() {
  const c = G.cs, a = c.az * Math.PI / 180, p = c.pol * Math.PI / 180;
  G.cam.position.set(c.tx + c.dist * Math.sin(a) * Math.sin(p), c.ty + c.dist * Math.cos(p), c.dist * Math.cos(a) * Math.sin(p));
  G.cam.lookAt(c.tx, c.ty, 0); G.dirty = true;
}
function fitTarget() {
  const n = G.rowRacks ? G.rowRacks.length : 8, rowW = n * SC.RW + (n - 1) * SC.GAP;
  const vf = G.cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * G.cam.aspect);
  const need = Math.max((rowW / 2 + 0.3) / Math.tan(hf / 2), (rackH() / 2 + 0.45) / Math.tan(vf / 2));
  return { az: 0, pol: 88, dist: need + SC.RD / 2, tx: rowW / 2 - SC.RW / 2, ty: rackH() / 2 + 0.05 };
}
function focusTarget(f) {   // 선택한 랙(또는 장비) 쪽으로 확대할 카메라 위치
  const k = Math.max(0, G.rowRacks.findIndex(r => r.id === f.rack)), vf = G.cam.fov * Math.PI / 180;
  const x = k * (SC.RW + SC.GAP);
  if (f.u0) return { az: 0, pol: 88, dist: 2.1, tx: x, ty: SC.BASE + (f.u0 - 1 + (f.u || 1) / 2) * SC.U };
  return { az: 0, pol: 88, dist: (rackH() / 2 + 0.35) / Math.tan(vf / 2) + SC.RD / 2, tx: x, ty: rackH() / 2 + 0.05 };
}
function flyTo(to) { G.fly = { from: Object.assign({}, G.cs), to, t0: performance.now(), dur: 700 }; G.dirty = true; }
function fitCam(reset) {
  const n = G.rowRacks ? G.rowRacks.length : 8, rowW = n * SC.RW + (n - 1) * SC.GAP;
  const vf = G.cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * G.cam.aspect);
  const need = Math.max((rowW / 2 + 0.3) / Math.tan(hf / 2), (rackH() / 2 + 0.45) / Math.tan(vf / 2));
  Object.assign(G.cs, { az: 0, pol: 88, dist: need + SC.RD / 2, tx: rowW / 2 - SC.RW / 2, ty: rackH() / 2 + 0.05 }); placeCam();
}
const ZMIN = 1.3, ZMAX = 14;
function panLimits() { const n = G.rowRacks ? G.rowRacks.length : 8; return { x0: -0.6, x1: (n - 1) * (SC.RW + SC.GAP) + 0.6 }; }
function panTo(tx, ty) { const p = panLimits(); G.cs.tx = clamp(tx, p.x0, p.x1); G.cs.ty = clamp(ty, 0.2, 3); }
function bindControls(cv) {
  const P = new Map();   // 눌려 있는 손가락(마우스)들
  let d = null, g2 = null;
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("pointerdown", e => {
    G.fly = null; P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (P.size === 2) {   // 두 손가락: 벌리고 모으기 = 확대·축소, 같이 움직이기 = 이동
      const [a, b] = [...P.values()];
      g2 = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cs: Object.assign({}, G.cs) }; d = null;
      try { cv.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
      return;
    }
    d = { x: e.clientX, y: e.clientY, az: G.cs.az, pol: G.cs.pol, tx: G.cs.tx, ty: G.cs.ty, pan: e.button === 2 || e.shiftKey || G.gmode === "pan", moved: false, id: e.pointerId };
  });
  cv.addEventListener("pointermove", e => {
    if (P.has(e.pointerId)) P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g2 && P.size >= 2) {
      const [a, b] = [...P.values()], dn = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      G.cs.dist = clamp(g2.cs.dist * g2.d0 / dn, ZMIN, ZMAX);
      const k = G.cs.dist * 0.0012; panTo(g2.cs.tx - (mx - g2.mx) * k, g2.cs.ty + (my - g2.my) * k);
      placeCam(); hideTip(); return;
    }
    if (d) {
      if (e.pointerType === "mouse" && e.buttons === 0) { d = null; return; }
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 6) { d.moved = true; try { cv.setPointerCapture(d.id); } catch (er) { /* 무시 */ } }
      if (d.moved) {
        if (d.pan) { const k = G.cs.dist * 0.0012; panTo(d.tx - dx * k, d.ty + dy * k); }
        else { G.cs.az = clamp(d.az - dx * 0.25, -70, 70); G.cs.pol = clamp(d.pol - dy * 0.2, 60, 100); }
        placeCam(); hideTip(); return;
      }
    }
    if (e.pointerType === "mouse") hover(e);
  });
  const end = e => {
    P.delete(e.pointerId);
    if (g2) { if (P.size < 2) { g2 = null; d = null; } return; }
    const was = d; d = null;
    if (was && !was.moved && e.type === "pointerup" && (e.button === 0 || e.pointerType !== "mouse")) pick(e);
  };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hideTip(); });
  cv.addEventListener("wheel", e => { e.preventDefault(); G.fly = null; G.cs.dist = clamp(G.cs.dist * (e.deltaY < 0 ? 0.9 : 1.1), ZMIN, ZMAX); placeCam(); }, { passive: false });
}
function rayAt(e) {
  const b = G.r.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
  G.rc.setFromCamera(v, G.cam); const hit = G.rc.intersectObjects(G.ray, false)[0]; return hit ? hit.object.userData : null;
}
function hover(e) {
  const u = rayAt(e); G.r.domElement.style.cursor = u ? "pointer" : "grab";
  const tip = $("#glTip");
  if (!u) { hideTip(); return; }
  const rk = RACKS.find(r => r.id === u.rack);
  tip.textContent = u.kind === "rack" ? `${u.rack} (랙)` : `${u.name || u.id} · ${KIND_TXT[u.kind]} · ${u.rack} U${u.u0}${u.u > 1 ? "–" + (u.u0 + u.u - 1) : ""}`;
  const b = $("#glWrap").getBoundingClientRect(); tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 260) + "px"; tip.style.top = (e.clientY - b.top + 14) + "px"; tip.hidden = false;
}
function hideTip() { const t = $("#glTip"); if (t) t.hidden = true; }
function pick(e) {
  const u = rayAt(e);
  G.sel = u ? (u.kind === "rack" ? { kind: "rack", rack: u.rack } : { kind: u.kind, id: u.id, rack: u.rack, u0: u.u0, u: u.u }) : null;
  G.focus = G.sel ? { rack: G.sel.rack, u0: G.sel.kind === "rack" ? 0 : G.sel.u0, u: G.sel.u } : { fit: true };
  render3d();
}

function disposeRoot() {
  [...G.root.children].forEach(o => { G.root.remove(o); o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach(m => m.dispose()); }); });
  TEX.splice(0).forEach(t => t.dispose()); G.ray = []; badgeCache = {};
}
const dark = (c) => new THREE.MeshStandardMaterial({ color: c || 0x1b2127, roughness: 0.8, metalness: 0.3 });
const devTemp = (r, it, i) => r.temp[i] + (it.u0 - 1) / RACK_U * 1.6;   // 장비 온도(가정): 랙 입구 온도 + 높이 보정 0~1.6°C
let badgeCache = {};
function buildRack(r, k, i, sel) {
  const { U, RW, RD, BASE, FW } = SC, g = new THREE.Group(), x = k * (RW + SC.GAP), H = rackH();
  g.position.x = x;
  const col = rackColor(r, i), hex = rgbHex(col), hi = sel && sel.rack === r.id;
  const add = (geo, mat, px, py, pz, ud) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); if (ud) { m.userData = ud; G.ray.push(m); } g.add(m); return m; };
  const rk = { kind: "rack", rack: r.id };
  add(new THREE.BoxGeometry(RW, BASE, RD), dark(0x14181c), 0, BASE / 2, 0, rk);
  add(new THREE.BoxGeometry(RW, 0.04, RD), dark(0x171c21), 0, H - 0.02, 0, rk);
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => add(new THREE.BoxGeometry(0.04, H - BASE - 0.04, 0.04), dark(0x20272d), sx * (FW / 2 + 0.02), (H + BASE - 0.04) / 2 - 0.0, sz * (RD / 2 - 0.03), rk));
  const sideMat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.88, emissive: hex, emissiveIntensity: 0.12 });
  [-1, 1].forEach(sx => add(new THREE.BoxGeometry(0.012, H - BASE - 0.04, RD - 0.02), sideMat, sx * (RW / 2 - 0.006), (H + BASE - 0.04) / 2, 0));
  add(new THREE.BoxGeometry(RW - 0.02, H - BASE - 0.04, 0.012), dark(0x0a0d10), 0, (H + BASE - 0.04) / 2, -RD / 2 + 0.02);
  const nt = numberTex(); [-1, 1].forEach(sx => add(new THREE.PlaneGeometry(0.036, RACK_U * U), new THREE.MeshBasicMaterial({ map: nt }), sx * (FW / 2 + 0.002 + 0.018 - 0.0), BASE + RACK_U * U / 2, RD / 2 - 0.005));
  const hit = new THREE.Mesh(new THREE.BoxGeometry(RW, H, RD - 0.1), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, H / 2, -0.05); hit.userData = rk; G.ray.push(hit); g.add(hit);
  // 바닥 띠 (상태/온도 색)
  add(new THREE.PlaneGeometry(RW, RD + 0.5), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.55 }), 0, 0.003, 0.25).rotation.x = -Math.PI / 2;
  // 장비
  rackLayout(r).forEach(it => {
    const h = it.u * U - 0.003, y = BASE + (it.u0 - 1) * U + h / 2 + 0.0015, zf = RD / 2 - 0.045, dep = it.kind === "pdu" || it.kind === "mgr" ? 0.12 : it.kind === "patch" ? 0.12 : 0.55;
    const st = it.dv ? devState(r, it.dv, i) : null, pl = it.dv ? portPlan(DEV[it.dv.id]) : null;
    const tex = it.dv ? devTexture(it, st, pl) : decoTexture(it);
    if (it.dv) {   // 장비마다 온도 하나: 랙 입구 온도에 높이 보정(위쪽일수록 조금 높게, 가정)을 더한 값
      const v = devTemp(r, it, i), key = v.toFixed(1); badgeCache[key] = badgeCache[key] || badgeTex(+key);
      const bd = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ map: badgeCache[key], transparent: true })); bd.position.set(FW / 2 - 0.07, y, zf + 0.006); g.add(bd);
    }
    const side = dark(0x232a31), front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(FW, h, dep), [side, side, side, side, front, side]);
    m.position.set(0, y, zf - dep / 2); m.userData = { kind: it.kind, id: it.id, name: it.id, rack: r.id, u0: it.u0, u: it.u }; G.ray.push(m); g.add(m);
    if (sel && sel.id === it.id && sel.rack === r.id) {   // 선택한 장비: 초록 테두리와 반투명 덮개
      const ov = new THREE.Mesh(new THREE.BoxGeometry(FW + 0.02, h + 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0x35d070, transparent: true, opacity: 0.28 })); ov.position.set(0, y, zf + 0.008); g.add(ov);
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(FW + 0.02, h + 0.012, 0.012)), new THREE.LineBasicMaterial({ color: 0x35d070 })); ed.position.copy(ov.position); g.add(ed);
    }
  });
  if (hi && sel.kind === "rack") { const ed = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(RW + 0.03, H + 0.03, RD + 0.03)), new THREE.LineBasicMaterial({ color: 0xffffff })); ed.position.set(0, H / 2, 0); g.add(ed); }
  // 이름표와 온도 3점
  const used = r.devices.reduce((n, dv) => n + DEV_U[dv.vendor], 0);
  const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({ map: labelTex(r.id.slice(4), `장비 ${r.devices.length}대 · ${used}U/${RACK_U}U`, hi), transparent: true })); lb.position.set(0, H + 0.2, RD / 2 - 0.02); g.add(lb);
  return g;
}
function buildScene() {
  if (!G.ready) return;
  disposeRoot();
  const i = clamp(sr.end, 0, N - 1);
  withTime(msOf(i), () => G.rowRacks.forEach((r, k) => G.root.add(buildRack(r, k, i, G.sel))));   // 꺼진 장비 옆 포트는 Down으로 그려진다
  G.dirty = true;
}
function stepFly() {
  if (!G.fly) return;
  const f = G.fly, k = Math.min(1, (performance.now() - f.t0) / f.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  ["az", "pol", "dist", "tx", "ty"].forEach(q => { G.cs[q] = f.from[q] + (f.to[q] - f.from[q]) * e; });
  placeCam(); if (k >= 1) G.fly = null;
}
function loop() { stepFly(); if (G.dirty && G.ready && $("#tab-room3d").classList.contains("on")) { G.dirty = false; G.r.render(G.scene, G.cam); } requestAnimationFrame(loop); }

/* ---------- 패널: 왼쪽 목록, 오른쪽 상세, 아래 영역 ---------- */
const stLabel = lv => lv === "ok" ? "정상" : lv === "warn" ? "주의" : "경고·위험";
const stCls = lv => lv === "ok" ? "ok" : lv === "warn" ? "warn" : "crit";
function bigChart(r, i) {
  const w = 520, h = 120, s = Math.max(0, i - 36), e = Math.min(N - 1, i + 12), lo = 18, hi = Math.max(36, TEMP_CRIT + 3);
  const X = k => 34 + (k - s) / Math.max(1, e - s) * (w - 44), Y = v => h - 18 - (clamp(v, lo, hi) - lo) / (hi - lo) * (h - 30);
  let d = ""; for (let k = s; k <= e; k++) d += (k === s ? "M" : "L") + X(k).toFixed(1) + "," + Y(r.temp[k]).toFixed(1);
  const line = (v, c) => `<line x1="34" x2="${w - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-dasharray="4 3" opacity=".7"/><text x="2" y="${Y(v) + 3}" fill="${c}" font-size="10">${v}°</text>`;
  const lab = k => `<text x="${X(k)}" y="${h - 3}" fill="#8d99a3" font-size="10" text-anchor="middle">${hm(msOf(k))}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${line(TEMP_WARN, "#d9b13b")}${line(TEMP_HOT, "#e5604d")}<path d="${d}" fill="none" stroke="#4aa3e3" stroke-width="2"/><line x1="${X(i)}" x2="${X(i)}" y1="6" y2="${h - 16}" stroke="#fff" opacity=".6"/>${lab(s)}${lab(i)}${lab(e)}</svg>`;
}
function selRack(vr) { return G.sel ? vr.find(r => r.id === G.sel.rack) : null; }
function detailHtml(vr, rows, i) {
  const rk = selRack(vr);
  if (!rk) {
    const cnt = k => rows[G.row].racks.filter(r => stCls(rackStatus(r, i)) === k).length;
    return `<h3>서버실 요약</h3><p class="note">${rows[G.row].label}</p><table class="kv"><tr><td>랙</td><td>${rows[G.row].racks.length}개</td></tr><tr><td>정상</td><td>${cnt("ok")}</td></tr><tr><td>주의</td><td>${cnt("warn")}</td></tr><tr><td>경고·위험</td><td>${cnt("crit")}</td></tr></table><p class="note">랙이나 장비를 누르면 여기에 자세한 정보가 나옵니다. 빈 곳을 누르면 선택이 풀립니다.</p>`;
  }
  const lv = rackStatus(rk, i), t = rk.temp[i], used = rk.devices.reduce((n, dv) => n + DEV_U[dv.vendor], 0);
  const alerts = ROOM_ALERTS.filter(a => a.rack === rk.id);
  const alertHtml = alerts.length ? alerts.map(a => `<li>${md(msOf(a.s))} ~ ${hm(msOf(a.e))} 온도 ${a.max.toFixed(1)}°C (경고 이상)</li>`).join("") : "<li class=\"muted\">온도 경고 기록 없음</li>";
  if (G.sel.kind === "rack") {
    return `<h3>${rk.id} <span class="tag ${stCls(lv)}">${stLabel(lv)}</span></h3><p class="note">${TOPOLOGY.centers[codeOf(rk.id)]} · 랙(42U)</p>` +
      `<table class="kv"><tr><td>입구 온도</td><td class="${tempCls(t)}">${t.toFixed(1)}°C</td></tr><tr><td>네트워크 장비</td><td>${rk.devices.length}대 (${used}U 사용 / 42U)</td></tr><tr><td>전력</td><td class="muted">가상 데이터에 없음</td></tr></table>` +
      `<h4>최근 알림</h4><ul class="alist">${alertHtml}</ul>`;
  }
  if (G.sel.kind === "rack") return "";
  const it = G.sel, uTxt = `U${it.u0}${it.u > 1 ? "–" + (it.u0 + it.u - 1) : ""}`;
  if (!DEV[it.id]) return `<h3>${esc(it.id)}</h3><p class="note">${KIND_TXT[it.kind]}</p><table class="kv"><tr><td>랙 위치</td><td>${it.rack} · ${uTxt}</td></tr><tr><td>종류</td><td>가상 보조 장비 (화면을 현실감 있게 하려고 넣은 것, 데이터 없음)</td></tr><tr><td>상태</td><td class="muted">정보 없음</td></tr></table>`;
  const d = DEV[it.id], dv = rk.devices.find(x => x.id === it.id), st = devState(rk, dv, i), pl = portPlan(d);
  const bad = [...pl.map.values()].filter(portBad).length, off = outageAt(d.id, msOf(i)), cust = (d.customers || []).map(k => CUSTOMERS.find(c => c.key === k).name);
  const links = TOPOLOGY.links.filter(l => (l.a === d.id || l.b === d.id) && LINK[l.link]).map(l => `<tr><td>${esc(CUSTOMERS.filter(c => c.links.includes(l.link)).map(c => c.name).slice(0, 2).join(" · ") || l.link)}</td><td class="n">in ${g1(LINK[l.link].in[i])}G</td><td class="n">out ${g1(LINK[l.link].out[i])}G</td></tr>`).join("");
  const peers = d.ifs.filter(f => !f[10]).slice(0, 5).map(f => `<li>${f[0]} → ${esc(f[1])}${portBad(f) ? " <span class=\"crit-t\">이상</span>" : ""}</li>`).join("");
  const ev = []; if (dv.fanWarn) ev.push("팬 경고가 계속 켜져 있음 (교체 대기 가정)"); if (dv.downStart) ev.push(`${md(parseT(dv.downStart))} ~ ${hm(parseT(dv.downEnd))} 꺼짐${dv.downWhy ? ` (${dv.downWhy})` : ""}`);
  const led = { ok: "정상", warn: "주의", crit: "장애", off: "꺼짐" };
  return `<h3>${d.id} <span class="tag ${stCls(!st.power ? "crit" : st.status === "crit" ? "crit" : st.status === "warn" ? "hot" : st.fan === "warn" ? "warn" : "ok")}">${!st.power ? "꺼짐" : st.status === "ok" && st.fan === "ok" ? "정상" : "주의"}</span></h3><p class="note">자산 ID: ${d.id}</p>` +
    `<table class="kv"><tr><td>종류</td><td>${KIND_TXT[d.vendor]}</td></tr><tr><td>역할</td><td>${esc(d.role)}</td></tr><tr><td>랙 위치</td><td>${d.rack} · ${uTxt}</td></tr>` +
    `<tr><td>LED</td><td>${ledHtml(st)} <span class="muted">전원 ${led[st.power ? "ok" : "off"]} · 상태 ${led[st.status]} · 팬 ${led[st.fan]}</span></td></tr><tr><td>랙 입구 온도</td><td class="${tempCls(rk.temp[i])}">${rk.temp[i].toFixed(1)}°C</td></tr><tr><td>장비 온도</td><td class="${tempCls(devTemp(rk, { u0: it.u0 }, i))}">${devTemp(rk, { u0: it.u0 }, i).toFixed(1)}°C <span class="muted">(입구 온도 + 높이 보정, 가정)</span></td></tr>` +
    `<tr><td>포트</td><td>${pl.map.size}개 연결 / ${pl.total} (고객 회선 ${d.ifs.filter(f => f[10]).length}개: 사용 중 ${d.ifs.filter(f => f[10] && !f[11]).length}, 미사용 Down ${d.ifs.filter(f => f[10] && f[11]).length} · 10G ${d.ifs.filter(f => f[10] && f[9] === 10).length}, 1G ${d.ifs.filter(f => f[10] && f[9] === 1).length})${bad ? ` · <span class="crit-t">이상 ${bad}</span>` : ""}</td></tr>${off ? `<tr><td>접속</td><td class="crit-t">전원 꺼짐${off.why ? " (" + esc(off.why) + ")" : ""}: 터미널은 응답 없음, 포트 전부 Down</td></tr>` : ""}<tr><td>이중화 짝</td><td>${d.partner} <span class="muted">(같은 고객 회선 목록)</span></td></tr>${cust.length ? `<tr><td>고객사</td><td>${esc(cust.join(" · "))}</td></tr>` : ""}` +
    `<tr><td>CPU·메모리</td><td class="muted">네트워크 장비라 표시 안 함</td></tr></table>` +
    (links ? `<h4>연결 회선 트래픽 (이 시각)</h4><table class="kv">${links}</table>` : "") +
    `<h4>장비 간 연결 (일부)</h4><ul class="alist">${peers}</ul><h4>최근 알림·점검</h4><ul class="alist">${ev.length ? ev.map(x => `<li>${x}</li>`).join("") : "<li class=\"muted\">알림 없음</li>"}</ul>` +
    `<div class="btnrow"><button class="btn" id="glPorts">포트·광케이블 자세히</button><button class="btn" id="glTerm">터미널 열기</button></div>`;
}
function renderPanels(vr, rows, i) {
  const q = G.q.trim().toLowerCase();
  const match = r => (!q || r.id.toLowerCase().includes(q) || r.devices.some(d => d.id.toLowerCase().includes(q))) && (G.filt === "all" || stCls(rackStatus(r, i)) === G.filt);
  const list = vr.filter(match);
  $("#glList").innerHTML = list.length ? list.map(r => { const lv = rackStatus(r, i); return `<div class="gli${G.sel && G.sel.rack === r.id ? " on" : ""}" data-rack="${r.id}"><span class="dot ${lv}"></span><b>${r.id}</b><span class="muted">장비 ${r.devices.length}</span><span class="tmp ${tempCls(r.temp[i])}">${r.temp[i].toFixed(1)}°</span></div>`; }).join("") : `<p class="note" style="padding:8px">조건에 맞는 랙이 없습니다.</p>`;
  $("#glCount").textContent = `${list.length} / ${vr.length}`;
  $("#glDetail").innerHTML = withTime(msOf(i), () => detailHtml(vr, rows, i));
  const rk = selRack(vr) || rows[G.row].racks[0];
  $("#glChart").innerHTML = `<h4>${rk.id} 온도 추이 <span class="muted">(점선 ${TEMP_WARN}/${TEMP_HOT}°C, 흰 선 = 기준 시각)</span></h4>` + bigChart(rk, i);
  const its = rackLayout(rk).sort((a, b) => b.u0 - a.u0);
  $("#glDevs").innerHTML = `<h4>${rk.id} 장비 목록</h4><table><tr><th>U</th><th>장비</th><th>종류</th><th>상태</th></tr>` + its.map(it => { const st = it.dv ? devState(rk, it.dv, i) : null;
    return `<tr class="click${G.sel && G.sel.id === it.id ? " on" : ""}" data-id="${it.id}" data-kind="${it.kind}" data-rack="${rk.id}" data-u0="${it.u0}" data-u="${it.u}"><td>${it.u0}${it.u > 1 ? "–" + (it.u0 + it.u - 1) : ""}</td><td>${esc(it.id)}</td><td>${KIND_TXT[it.kind].split(" (")[0]}</td><td>${st ? (!st.power ? "꺼짐" : st.status === "ok" && st.fan === "ok" ? "정상" : "주의") : '<span class="muted">-</span>'}</td></tr>`; }).join("") + "</table>";
  const ev = [];
  ROOM_ALERTS.filter(a => inView(a.rack)).forEach(a => ev.push({ t: a.s, rack: a.rack, txt: `온도 ${a.max.toFixed(1)}°C 경고`, lv: "crit" }));
  vr.forEach(r => r.devices.forEach(dv => { if (dv.downStart) ev.push({ t: idxOf(parseT(dv.downStart)), rack: r.id, txt: `${dv.id} 꺼짐${dv.downWhy ? ` (${dv.downWhy})` : ""}`, lv: "crit" }); if (dv.fanWarn) ev.push({ t: 0, rack: r.id, txt: `${dv.id} 팬 경고 (지속)`, lv: "warn" }); }));
  ev.sort((a, b) => b.t - a.t);
  $("#glAlerts").innerHTML = `<h4>최근 장애·경고 <span class="muted">(${viewLabel()})</span></h4><table><tr><th>시각</th><th>랙</th><th>내용</th></tr>` + (ev.length ? ev.map(e => `<tr class="click" data-t="${e.t}" data-rack="${e.rack}"><td>${e.t ? md(msOf(e.t)) : "상시"}</td><td>${e.rack}</td><td class="${e.lv === "crit" ? "crit-t" : "warn-t"}">${e.txt}</td></tr>`).join("") : `<tr><td colspan="3" class="muted">기록 없음</td></tr>`) + "</table>";
}
function render3d() {
  if (!$("#tab-room3d").classList.contains("on")) return;
  const i = clamp(sr.end, 0, N - 1), vr = visibleRacks(), rows = r3Rows(vr);
  $("#r3Time").value = isoLocal(msOf(i));
  if (G.center !== view.center) { G.center = view.center; G.row = 0; G.sel = null; }
  if (G.sel && !vr.some(r => r.id === G.sel.rack)) G.sel = null;
  if (G.jump && G.sel) G.row = Math.max(0, rows.findIndex(x => x.racks.some(r => r.id === G.sel.rack)));
  G.jump = false; G.row = clamp(G.row, 0, rows.length - 1);
  if (G.sel && !rows[G.row].racks.some(r => r.id === G.sel.rack)) G.sel = null;
  const prevRow = G.rowRacks && G.rowRacks[0] && G.rowRacks[0].id;
  G.rowRacks = rows[G.row].racks;
  $("#r3RowSel").innerHTML = rows.map((x, k) => `<option value="${k}" ${k === G.row ? "selected" : ""}>${x.label}</option>`).join("");
  $("#glCrumb").textContent = `가상 데이터센터 › ${viewLabel()} › ${rows[G.row].label}`;
  $$("[data-glmode]").forEach(b => b.classList.toggle("on", b.dataset.glmode === G.mode));
  $$("[data-glf]").forEach(b => b.classList.toggle("on", b.dataset.glf === G.filt));
  renderPanels(vr, rows, i);
  if (R3.dev) r3Detail();
  loadThree(() => { if (!G.ready) { initGL(); requestAnimationFrame(loop); } buildScene(); if (prevRow !== G.rowRacks[0].id || !G.fitted) { fitCam(); G.fitted = true; }
    if (G.focus) { const f = G.focus; G.focus = null; flyTo(f.fit ? fitTarget() : focusTarget(f)); } });
}

/* ---------- 이벤트 ---------- */
(function initRoom3d() {
  $("#r3Time").addEventListener("change", e => { if (e.target.value) { timeNote(e.target, parseT(e.target.value)); sr.end = idxOf(parseT(e.target.value)); render3d(); } });
  $("#r3Prev").onclick = () => { sr.end -= cfg.step; render3d(); };
  $("#r3Next").onclick = () => { sr.end += cfg.step; render3d(); };
  $("#r3RowSel").onchange = e => { G.row = +e.target.value; G.sel = null; render3d(); };
  $$("[data-glmode]").forEach(b => b.onclick = () => { G.mode = b.dataset.glmode; render3d(); });
  $$("[data-glf]").forEach(b => b.onclick = () => { G.filt = b.dataset.glf; render3d(); });
  $("#glSearch").addEventListener("input", e => { G.q = e.target.value; render3d(); });
  $("#glZoomIn").onclick = () => { G.fly = null; G.cs.dist = clamp(G.cs.dist * 0.8, ZMIN, ZMAX); placeCam(); };
  $("#glZoomOut").onclick = () => { G.fly = null; G.cs.dist = clamp(G.cs.dist * 1.25, ZMIN, ZMAX); placeCam(); };
  const hold = (el, fn) => { let t = null; const stop = () => { clearInterval(t); t = null; }; el.addEventListener("pointerdown", e => { e.preventDefault(); G.fly = null; fn(); stop(); t = setInterval(fn, 70); }); ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, stop)); };
  $$("[data-pan]").forEach(b => hold(b, () => { const k = G.cs.dist * 0.03, m = { left: [-1, 0], right: [1, 0], up: [0, 0.6], down: [0, -0.6] }[b.dataset.pan]; panTo(G.cs.tx + m[0] * k, G.cs.ty + m[1] * k); placeCam(); }));
  $$("[data-rot]").forEach(b => hold(b, () => { G.cs.az = clamp(G.cs.az + (+b.dataset.rot) * 2, -70, 70); placeCam(); }));
  hold($("#glPadIn"), () => { G.cs.dist = clamp(G.cs.dist * 0.96, ZMIN, ZMAX); placeCam(); });
  hold($("#glPadOut"), () => { G.cs.dist = clamp(G.cs.dist / 0.96, ZMIN, ZMAX); placeCam(); });
  $("#glPadTog").onclick = () => { const m = $("#glPad").classList.toggle("min"); $("#glPadTog").textContent = m ? "조작판 펼치기" : "조작판 접기"; $("#glPadTog").setAttribute("aria-expanded", String(!m)); };
  $$("[data-gm]").forEach(b => { b.classList.toggle("on", b.dataset.gm === G.gmode); b.onclick = () => { G.gmode = b.dataset.gm; $$("[data-gm]").forEach(x => x.classList.toggle("on", x.dataset.gm === G.gmode)); }; });
  $("#glFit").onclick = () => { if (G.ready) flyTo(fitTarget()); };
  $("#glHome").onclick = () => { if (G.ready) flyTo(Object.assign({}, G.cs, { az: 0, pol: 88 })); };
  $("#glList").addEventListener("click", ev => { const el = ev.target.closest(".gli"); if (el) { G.sel = { kind: "rack", rack: el.dataset.rack }; G.jump = true; G.focus = { rack: el.dataset.rack, u0: 0 }; render3d(); } });
  $("#glAlerts").addEventListener("click", ev => { const tr = ev.target.closest("tr.click"); if (tr) { if (+tr.dataset.t) sr.end = +tr.dataset.t; G.sel = { kind: "rack", rack: tr.dataset.rack }; G.jump = true; G.focus = { rack: tr.dataset.rack, u0: 0 }; render3d(); } });
  $("#glDevs").addEventListener("click", ev => { const tr = ev.target.closest("tr.click"); if (tr) { const d = tr.dataset; G.sel = { kind: d.kind, id: d.id, rack: d.rack, u0: +d.u0, u: +d.u }; G.focus = { rack: d.rack, u0: +d.u0, u: +d.u }; render3d(); } });
  $("#glDetail").addEventListener("click", ev => { if (ev.target.id === "glPorts") r3Open(G.sel.id); if (ev.target.id === "glTerm") openDeviceTerminal(G.sel.id); });
  $$("[data-r3]").forEach(b => b.onclick = () => {
    sr.end = idxOf(parseT(b.dataset.r3));
    if (b.dataset.center && view.center !== "ALL" && view.center !== b.dataset.center) setCenter(b.dataset.center);
    if (b.dataset.rack) { G.sel = { kind: "rack", rack: b.dataset.rack }; G.jump = true; G.focus = { rack: b.dataset.rack, u0: 0 }; }
    render3d();
  });
  if ($("#tab-room3d").classList.contains("on")) render3d();
})();
