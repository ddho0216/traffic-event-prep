/* 보고 문자 두 가지: 실제로 쓰는 양식(사용자가 알려 준 것, 이름은 가려져 있음)을 따라 만든다. 숫자는 전부 가상 데이터에서 계산한다.
   1) [주요고객 트래픽] 일일 보고: 센터별로 업링크와 주요 고객사의 24시간 최대 트래픽을 전주 / 전일 / 현재로 비교
   2) 이벤트 최대 트래픽 보고: 이벤트(경기·행사) 중 최대 트래픽을 센터 백본과 고객사별로, 전주 같은 시간대 최대와 비교
   고객사별 트래픽은 데이터에 따로 없어서, 회선 트래픽을 고객사 용량 비율로 나눠 붙인 가상 배분입니다(제가 정한 방식).
   app.js보다 먼저 불러오고, 계산은 호출될 때(app.js가 만든 값이 준비된 뒤) 한다. */
const REPORT = (() => {
  const ORDER = ["S", "A", "B", "G"], NM = { S: "서초", A: "안산", B: "분당", G: "구로" }, HOUR = 3600000, DAYMS = 24 * HOUR, WEEK = 7 * DAYMS;
  const cOf = id => id.split("_")[1];
  const idx = ms => Math.floor((ms - T0) / STEP);
  const pad = n => String(n).padStart(2, "0");
  const fT = g => g >= 1 ? `${g.toFixed(1)}G` : g >= 0.001 ? `${(g * 1000).toFixed(1)}M` : `${(g * 1e6).toFixed(1)}K`;   // 실제 문자처럼 G·M·K로
  const mdhm = ms => { const d = new Date(ms); return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const upLinks = c => LINKS.filter(l => cOf(l.id) === c && /_UP\d$/.test(l.id));   // 센터 업링크 = 그 센터의 *_UP1·UP2 회선
  const upCap = c => upLinks(c).reduce((s, l) => s + l.cap, 0);
  const maxUp = (c, a, b) => { const ls = upLinks(c); let m = 0; for (let i = a; i <= b; i++) { let v = 0; for (const l of ls) v += l.out[i]; if (v > m) m = v; } return m; };
  const hash = (s, k) => { let h = 2166136261 + k * 97; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };   // 이름으로 정해지는 0~1 값 (항상 같음)
  const wCap = cu => 0.5 + hash(cu.name, 1), wTr = cu => 0.4 + 0.9 * hash(cu.name, 2);   // 고객사마다 용량 몫과 트래픽 몫이 다르다 (가상)
  const onLink = id => CUSTOMERS.filter(c => c.links.includes(id));
  const capOf = cu => {   // 고객사 용량: 큰 고객사는 전용 회선 용량, 나머지는 쓰는 회선 용량을 같이 쓰는 고객사끼리 나눈 몫의 합 (가상)
    if (cu.big) return LINK[cu.links[0]].cap;
    let g = 0; for (const id of cu.links) { if (!LINK[id]) continue; g += LINK[id].cap * wCap(cu) / onLink(id).reduce((s, x) => s + wCap(x), 0); }
    return Math.max(1, Math.round(g));
  };
  const custAt = (cu, i) => { let v = 0; for (const id of cu.links) { if (!LINK[id]) continue; v += LINK[id].out[i] * (cu.big ? 1 : wTr(cu) / onLink(id).reduce((s, x) => s + wTr(x), 0)); } return Math.min(v, capOf(cu) * 0.9); };
  const custMax = (cu, a, b) => { let m = 0; for (let i = a; i <= b; i++) m = Math.max(m, custAt(cu, i)); return m; };
  const homeOf = cu => cOf(cu.links[0]);   // 고객사의 센터 = 첫 회선의 센터
  const win = (endMs, shift) => { const e = idx(endMs - shift), a = idx(endMs - shift - DAYMS) + 1; return a >= 0 && e <= N - 1 ? [a, e] : null; };

  function daily(endMs) {
    const W = [win(endMs, WEEK), win(endMs, DAYMS), win(endMs, 0)];
    const val = f => W.map(w => w ? fT(f(w[0], w[1])) : "-").join(" / ");
    const L = ["[" + COMPANY + "]", "[Web발신]", "[주요고객 트래픽]", "", `■ 일시 : ${mdhm(endMs - DAYMS)} ~ ${mdhm(endMs)}`, "■ 최대트래픽 - 고객명 : 전주 / 전일 / 현재", ""];
    ORDER.forEach(c => {
      L.push(`[${NM[c]}]`, `- 센터 업링크(${upCap(c)}G): ${val((a, b) => maxUp(c, a, b))}`);
      CUSTOMERS.filter(cu => homeOf(cu) === c).map(cu => ({ cu, now: W[2] ? custMax(cu, W[2][0], W[2][1]) : 0 })).sort((x, y) => y.now - x.now).slice(0, 7)
        .forEach(x => L.push(`- ${x.cu.name}(${capOf(x.cu)}G): ${val((a, b) => custMax(x.cu, a, b))}`));
      L.push("");
    });
    return L.join("\n").trimEnd();
  }

  function event(ev) {
    const s = parseT(ev.start), e = parseT(ev.end), a = idx(s), b = idx(e), a0 = idx(s - WEEK), b0 = idx(e - WEEK), hasPrev = a0 >= 0;
    const centers = ORDER.filter(c => c === "S" || c === "B" || ev.links.some(l => cOf(l) === c));
    const dlt = (now, prev) => hasPrev ? `전주 MAX 대비 ${fT(Math.abs(now - prev))} ${now >= prev ? "증가" : "감소"}` : "전주 데이터 없음";
    const d = new Date(s), L = ["[" + COMPANY + "]", "[Web발신]", `[2026 아이치·나고야 아시안게임] ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${ev.name} 중 최대 트래픽`, "", "■ 백본 트래픽"];
    centers.forEach(c => { const now = maxUp(c, a, b), prev = hasPrev ? maxUp(c, a0, b0) : 0, cap = upCap(c); L.push(`- ${NM[c]} : ${fT(now)} / ${cap}G (사용률 ${(now / cap * 100).toFixed(1)}% ${dlt(now, prev)})`); });
    L.push("", "■ 고객 트래픽");
    centers.forEach(c => {
      const top = CUSTOMERS.filter(cu => homeOf(cu) === c).map(cu => ({ cu, now: custMax(cu, a, b) })).sort((x, y) => y.now - x.now)[0];
      if (top) L.push(`- ${top.cu.name}(${NM[c]}) : ${fT(top.now)} (${dlt(top.now, hasPrev ? custMax(top.cu, a0, b0) : 0)})`);
    });
    const hit = typeof ALERTS !== "undefined" ? ALERTS.filter(x => x.e >= a && x.s <= b && !x.evName) : [];
    L.push("", `■ 서비스 영향 : ${hit.length ? hit.map(x => `${x.link} ${x.kind}`).join(", ") + " 확인됨" : "서비스 및 DDoS 특이사항 없음"}`, "■ VOC : 없음");
    return L.join("\n");
  }
  return { daily, event, fT, mdhm, upCap, maxUp, custMax, capOf, homeOf };
})();
