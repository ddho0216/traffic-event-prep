/* 90s low-poly 느낌 캐릭터/소품 (작은 해상도로 그린 뒤 정수배 확대) */
(function () {
const OL = '#2a1c14';
function poly(c, pts, fill, stroke = true) {
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = OL; c.lineWidth = 1; c.lineJoin = 'round'; c.stroke(); }
}
function ngon(c, cx, cy, rx, ry, n, fill, rot = 0, stroke = true) {
  const pts = []; for (let i = 0; i < n; i++) { const a = rot + i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  poly(c, pts, fill, stroke);
}
const K = {
  me:      { skin: '#f3cfae', skinD: '#dba984', hair: '#3a2a22', hairD: '#241812', top: '#9aa0a8', topD: '#7b818a' },
  sister:  { skin: '#f3cfae', skinD: '#dba984', hair: '#2a2220', hairD: '#1a1412', top: '#d9a63e', topD: '#b58528' },
  mom:     { skin: '#f0c9a6', skinD: '#d6a47e', hair: '#6a4632', hairD: '#4a2f20', top: '#e6b8ae', topD: '#c99a90' },
  dad:     { skin: '#e8bd98', skinD: '#cf9c74', hair: '#2b2420', hairD: '#1a1512', top: '#8fb4d6', topD: '#6f95b8' },
  grandma: { skin: '#f0cfb0', skinD: '#d9ad8c', hair: '#ececee', hairD: '#c4c4cc', top: '#b79aa8', topD: '#977a89' },
};
window.makeChar = function (kind, mood = 'good') {
  const k = K[kind], cv = document.createElement('canvas'); cv.width = 56; cv.height = 64;
  const c = cv.getContext('2d');
  // 몸통
  const wide = kind === 'sister';
  const T = wide ? [[1, 64], [4, 46], [17, 39], [39, 39], [52, 46], [55, 64]] : [[6, 64], [8, 46], [19, 40], [37, 40], [48, 46], [50, 64]];
  poly(c, T, k.top);
  poly(c, wide ? [[28, 39], [39, 39], [52, 46], [55, 64], [28, 64]] : [[28, 40], [37, 40], [48, 46], [50, 64], [28, 64]], k.topD);
  if (kind === 'sister') { poly(c, [[15, 41], [20, 35], [36, 35], [41, 41], [34, 46], [22, 46]], k.topD); c.strokeStyle = '#f3efe6'; c.lineWidth = 1; c.beginPath(); c.moveTo(24, 46); c.lineTo(24, 56); c.moveTo(32, 46); c.lineTo(32, 56); c.stroke(); }
  if (kind === 'mom') { poly(c, [[19, 64], [21, 45], [35, 45], [37, 64]], '#f4ecd8'); c.strokeStyle = '#f4ecd8'; c.beginPath(); c.moveTo(21, 45); c.lineTo(19, 40); c.moveTo(35, 45); c.lineTo(37, 40); c.stroke(); poly(c, [[25, 52], [31, 52], [31, 58], [25, 58]], '#e3d6b8'); }
  if (kind === 'grandma') { poly(c, [[22, 40], [28, 54], [34, 40]], '#f2eee6'); c.fillStyle = '#d8c4cc'; [[12, 50], [16, 55], [10, 58], [42, 50], [46, 55], [40, 58], [14, 61], [44, 61]].forEach(([x, y]) => c.fillRect(x, y, 2, 2)); c.strokeStyle = OL; c.beginPath(); c.moveTo(22, 40); c.lineTo(28, 54); c.lineTo(34, 40); c.stroke(); }
  if (kind === 'dad') { poly(c, [[21, 40], [28, 49], [24, 40]], '#f2f2ee'); poly(c, [[35, 40], [28, 49], [32, 40]], '#f2f2ee'); c.strokeStyle = '#6f95b8'; c.beginPath(); c.moveTo(28, 49); c.lineTo(28, 64); c.stroke(); }
  if (kind === 'me') { poly(c, [[22, 40], [28, 46], [34, 40]], k.skin); }
  // 목
  poly(c, [[24, 33], [32, 33], [32, 41], [28, 44], [24, 41]], k.skinD);
  // 머리 (8각)
  poly(c, [[18, 10], [38, 10], [42, 16], [42, 28], [37, 35], [19, 35], [14, 28], [14, 16]], k.skin);
  poly(c, [[28, 10], [38, 10], [42, 16], [42, 28], [37, 35], [28, 35]], k.skinD, false);
  // 머리카락
  if (kind === 'me') { poly(c, [[13, 20], [14, 10], [21, 5], [35, 5], [42, 10], [43, 20], [39, 13], [30, 10], [17, 13]], k.hair); poly(c, [[23, 0], [33, 0], [36, 3], [33, 7], [23, 7], [20, 3]], k.hair); }
  if (kind === 'sister') poly(c, [[13, 28], [12, 14], [18, 6], [38, 6], [44, 14], [43, 28], [39, 27], [39, 15], [35, 12], [21, 12], [17, 15], [17, 27]], k.hair);
  if (kind === 'mom') { poly(c, [[11, 38], [11, 14], [17, 6], [39, 6], [45, 14], [45, 38], [39, 35], [39, 16], [17, 16], [17, 35]], k.hair); poly(c, [[17, 16], [22, 10], [34, 10], [39, 16], [33, 14], [23, 14]], k.hairD); }
  if (kind === 'dad') poly(c, [[13, 17], [15, 8], [22, 5], [34, 5], [41, 8], [43, 17], [40, 12], [30, 9], [16, 12]], k.hair);
  if (kind === 'grandma') { poly(c, [[10, 24], [11, 12], [17, 5], [24, 2], [32, 2], [39, 5], [45, 12], [46, 24], [41, 19], [39, 12], [17, 12], [15, 19]], k.hair); poly(c, [[10, 24], [15, 19], [15, 14], [11, 12]], k.hairD, false); poly(c, [[46, 24], [41, 19], [41, 14], [45, 12]], k.hairD, false); }
  // 얼굴
  c.fillStyle = OL;
  if (mood === 'love') { c.fillRect(21, 22, 4, 1); c.fillRect(20, 23, 1, 1); c.fillRect(25, 23, 1, 1); c.fillRect(31, 22, 4, 1); c.fillRect(30, 23, 1, 1); c.fillRect(35, 23, 1, 1); }
  else { c.fillRect(22, 21, 2, 3); c.fillRect(32, 21, 2, 3); }
  if (kind === 'dad') { c.fillRect(21, 19, 4, 1); c.fillRect(31, 19, 4, 1); }
  if (kind === 'grandma') { c.fillStyle = 'rgba(120,80,60,0.6)'; c.fillRect(19, 25, 3, 1); c.fillRect(35, 25, 3, 1); c.fillRect(20, 17, 4, 1); c.fillRect(32, 17, 4, 1); }
  c.fillStyle = 'rgba(230,110,100,0.55)'; c.fillRect(18, 26, 4, 2); c.fillRect(34, 26, 4, 2);
  c.fillStyle = OL;
  if (mood === 'love') { c.fillRect(24, 28, 8, 1); c.fillRect(25, 29, 6, 2); c.fillStyle = '#b8453a'; c.fillRect(26, 29, 4, 1); }
  else if (mood === 'good') { c.fillRect(25, 29, 6, 1); c.fillRect(24, 28, 1, 1); c.fillRect(31, 28, 1, 1); }
  else if (mood === 'sad') { c.fillRect(25, 29, 6, 1); c.fillRect(24, 30, 1, 1); c.fillRect(31, 30, 1, 1); }
  else c.fillRect(25, 29, 6, 1);
  return cv;
};
const cache = {};
window.drawChar = function (ctx, kind, x, y, s, mood) {
  const key = kind + mood; const c = cache[key] || (cache[key] = window.makeChar(kind, mood));
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(c, x - 28 * s, y, 56 * s, 64 * s); ctx.restore();
};

/* ---------- 소품 ---------- */
window.makeProp = function (name) {
  const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return [cv, cv.getContext('2d')]; };
  let cv, c;
  switch (name) {
    case 'flour_pancake': [cv, c] = mk(30, 40);
      poly(c, [[3, 38], [4, 10], [26, 10], [27, 38]], '#f0a830'); poly(c, [[15, 10], [26, 10], [27, 38], [15, 38]], '#d98a1c', false);
      poly(c, [[3, 10], [7, 3], [23, 3], [27, 10]], '#f6c860'); poly(c, [[8, 18], [22, 18], [22, 30], [8, 30]], '#fbf1d4'); poly(c, [[8, 18], [22, 18], [22, 22], [8, 22]], '#c8452f'); break;
    case 'flour_rice': [cv, c] = mk(26, 34);
      poly(c, [[3, 32], [4, 9], [22, 9], [23, 32]], '#7fb069'); poly(c, [[13, 9], [22, 9], [23, 32], [13, 32]], '#639652', false);
      poly(c, [[3, 9], [6, 3], [20, 3], [23, 9]], '#a6d08e'); poly(c, [[7, 16], [19, 16], [19, 26], [7, 26]], '#fbf1d4'); break;
    case 'flour_fry': [cv, c] = mk(28, 40);
      poly(c, [[3, 38], [4, 8], [24, 8], [25, 38]], '#3f6fb5'); poly(c, [[14, 8], [24, 8], [25, 38], [14, 38]], '#2f5694', false);
      poly(c, [[3, 8], [6, 2], [22, 2], [25, 8]], '#5a8ad0'); poly(c, [[4, 17], [24, 17], [24, 29], [4, 29]], '#f2c94c'); break;
    case 'salt': [cv, c] = mk(18, 30);
      poly(c, [[4, 28], [3, 10], [15, 10], [14, 28]], '#f1f3f5'); poly(c, [[10, 10], [15, 10], [14, 28], [10, 28]], '#cfd6dc', false);
      poly(c, [[3, 10], [4, 4], [14, 4], [15, 10]], '#aab4c0'); c.fillStyle = '#6a7380'; c.fillRect(7, 6, 1, 1); c.fillRect(10, 6, 1, 1); c.fillRect(8, 8, 1, 1); break;
    case 'soy': [cv, c] = mk(20, 42);
      poly(c, [[3, 40], [3, 20], [8, 14], [8, 8], [13, 8], [13, 14], [18, 20], [18, 40]], '#2f1c10'); poly(c, [[11, 14], [18, 20], [18, 40], [11, 40]], '#1c100a', false);
      poly(c, [[7, 3], [14, 3], [14, 8], [7, 8]], '#c8452f'); poly(c, [[5, 26], [16, 26], [16, 35], [5, 35]], '#f1e3c0'); c.fillStyle = '#c8452f'; c.fillRect(7, 29, 7, 2); break;
    case 'pepper': [cv, c] = mk(16, 26);
      poly(c, [[3, 24], [3, 9], [13, 9], [13, 24]], '#6b4a32'); poly(c, [[8, 9], [13, 9], [13, 24], [8, 24]], '#4a3322', false);
      poly(c, [[3, 9], [4, 4], [12, 4], [13, 9]], '#aab4c0'); c.fillStyle = '#e8d8b0'; c.fillRect(6, 14, 1, 1); c.fillRect(9, 17, 1, 1); c.fillRect(6, 20, 1, 1); break;
    case 'bowl': [cv, c] = mk(60, 34);
      poly(c, [[4, 12], [56, 12], [50, 26], [40, 32], [20, 32], [10, 26]], '#8fa0a6'); poly(c, [[30, 12], [56, 12], [50, 26], [40, 32], [30, 32]], '#6f8086', false);
      ngon(c, 30, 12, 26, 7, 12, '#b9c6ca'); ngon(c, 30, 12, 22, 5, 12, '#efe4c0'); c.fillStyle = '#4f8a3a'; [[20, 11], [30, 13], [38, 10]].forEach(([x, y]) => c.fillRect(x, y, 3, 1)); c.fillStyle = '#c8452f'; [[25, 12], [34, 12]].forEach(([x, y]) => c.fillRect(x, y, 2, 1)); break;
    case 'pan': [cv, c] = mk(86, 36);
      poly(c, [[60, 14], [84, 11], [84, 17], [60, 19]], '#1c1c1e'); ngon(c, 32, 20, 30, 12, 12, '#1a1b1e'); ngon(c, 32, 17, 30, 12, 12, '#34353a'); ngon(c, 32, 17, 24, 9, 12, '#d9983c'); c.fillStyle = '#b87a28'; [[22, 14], [30, 19], [40, 15], [34, 12]].forEach(([x, y]) => c.fillRect(x, y, 3, 2)); c.fillStyle = '#c8452f'; c.fillRect(26, 16, 2, 1); c.fillRect(38, 19, 2, 1); c.fillStyle = '#4f8a3a'; c.fillRect(30, 14, 3, 1); break;
    case 'spatula': [cv, c] = mk(60, 14);
      poly(c, [[2, 3], [22, 3], [22, 11], [2, 11]], '#b9c0c8'); poly(c, [[22, 6], [58, 6], [58, 9], [22, 9]], '#8a6a44'); break;
    case 'spoon': [cv, c] = mk(60, 14);
      ngon(c, 8, 7, 7, 5, 8, '#c59a62'); poly(c, [[14, 6], [58, 6], [58, 9], [14, 9]], '#a87c46'); break;
    case 'plates': [cv, c] = mk(54, 34);
      for (let i = 0; i < 4; i++) { ngon(c, 27, 26 - i * 5, 23, 7, 8, '#cfc9bc'); ngon(c, 27, 24 - i * 5, 23, 7, 8, '#f4efe4'); } ngon(c, 27, 6, 14, 3, 8, '#e4ddcc', 0, false); break;
    case 'eggs': [cv, c] = mk(60, 34);
      poly(c, [[2, 30], [4, 14], [56, 14], [58, 30]], '#b8a888'); poly(c, [[30, 14], [56, 14], [58, 30], [30, 30]], '#9a8b6e', false);
      [[12, 18], [30, 18], [48, 18], [12, 26], [30, 26], [48, 26]].forEach(([x, y]) => ngon(c, x, y, 6, 5, 8, '#f1dcc0')); break;
    case 'cutting': [cv, c] = mk(70, 34);
      poly(c, [[10, 6], [62, 6], [68, 28], [4, 28]], '#cf9f66'); poly(c, [[4, 28], [68, 28], [68, 32], [4, 32]], '#9a6e3e'); c.strokeStyle = 'rgba(110,70,30,0.5)'; c.beginPath(); c.moveTo(12, 12); c.lineTo(58, 12); c.moveTo(10, 18); c.lineTo(60, 18); c.moveTo(8, 24); c.lineTo(62, 24); c.stroke(); break;
  }
  return cv;
};
})();

/* ---------- 보내주신 캐릭터 시트 정면 그림으로 인물 그리기 ---------- */
(function () {
  const CH = { grandma: { cx: 137, ht: 1.48 }, me: { cx: 119, ht: 1.62 }, sister: { cx: 118.5, ht: 1.58 }, mom: { cx: 124, ht: 1.56 }, dad: { cx: 123.5, ht: 1.72 } };
  const IM = {};
  Object.keys(CH).forEach(k => { const i = new Image(); i.src = 'assets/char_' + k + '.webp'; IM[k] = i; });
  const pixel = window.drawChar;
  window.drawChar = function (ctx, kind, x, y, s, mood) {
    const im = IM[kind], c = CH[kind];
    if (!im || !im.complete || !im.naturalWidth) return pixel(ctx, kind, x, y, s, mood);
    const full = 64 * s / 0.42;              // 가장 큰 사람(아빠) 전신 높이
    const bodyH = full * (c.ht / 1.72);       // 키 비례
    const k = bodyH / im.naturalHeight;
    const top = y + full - bodyH;             // 발 위치를 맞춰 키 차이가 보이게
    const bob = mood === 'love' ? Math.abs(Math.sin(performance.now() / 160)) * 3 * s / 2.6 : 0;
    ctx.save(); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(im, x - c.cx * k, top - bob, im.naturalWidth * k, bodyH);
    ctx.restore();
  };
})();
