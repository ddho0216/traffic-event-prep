/* 탐지·판정 로직 (화면 코드 없음)
   브라우저에서는 전역 Lib로, Node에서는 require("./lib.js")로 쓴다. 터미널에서 대량으로 시험하려고 분리했다.
   입력은 사이트 데이터(DATA)와 같은 모양: { start, stepMin, n, links:[{id,cap,in[],out[]}], events:[...], racks:[...] } */
(function (root, factory) {
  const lib = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = lib; else root.Lib = lib;
})(typeof self !== "undefined" ? self : this, function () {
  const PER_DAY = 288;   // 5분 간격 하루 점 수

  // 탐지 기준 (바꿀 수 있게 모아 둠)
  const DEFAULTS = {
    usage: 0.8,          // 사용률 이 값 이상이면 경고
    spike: 3,            // in이 같은 시간대 평소의 이 배수 이상이면 급증 의심
    dropRatio: 0.4,      // 같은 시간대 평소의 이 비율 미만이면 급감 후보
    dropMinPoints: 3,    // 급감 후보가 이 점수 이상 이어져야 급감 (3점 = 15분)
    evBefore: 6,         // 경기 시작 이 점수 전부터 "경기와 겹침"으로 본다 (6점 = 30분)
    evAfter: 4           // 경기 끝난 뒤 이 점수까지 (4점 = 20분)
  };
  const TEMP_DEFAULTS = { warn: 27, hot: 30, crit: 33 };

  function parseT(s) {   // "2026-10-19T00:00" -> 밀리초 (시간대 영향 없이 UTC로 처리)
    const [d, t] = s.split("T"); const [y, m, da] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number);
    return Date.UTC(y, m - 1, da, h, mi);
  }
  function runs(flags) {   // 연속으로 true인 구간 [시작, 끝] 목록
    const out = []; let s = -1;
    flags.forEach((f, i) => { if (f && s < 0) s = i; if (!f && s >= 0) { out.push([s, i - 1]); s = -1; } });
    if (s >= 0) out.push([s, flags.length - 1]);
    return out;
  }
  function median(a) { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }   // 개수가 짝수면 위쪽 값
  function slotMedians(arr, n) {   // 하루 중 같은 시각끼리의 중앙값 (288칸)
    return Array.from({ length: PER_DAY }, (_, k) => { const v = []; for (let i = k; i < n; i += PER_DAY) v.push(arr[i]); return median(v); });
  }

  /* 트래픽 경고: 사용률, in 급증, 급감(in·out 동시 / out / in). 경기와 겹치면 evName을 붙인다. */
  function detectTraffic(data, opt) {
    const o = Object.assign({}, DEFAULTS, opt), n = data.n;
    const T0 = parseT(data.start), STEP = data.stepMin * 60000, idxOf = ms => Math.round((ms - T0) / STEP);
    const res = [], drop = {};
    for (const l of data.links) {
      // 1) out 사용률
      runs(l.out.map(v => v >= l.cap * o.usage)).forEach(([s, e]) => {
        let p = s; for (let i = s; i <= e; i++) if (l.out[i] > l.out[p]) p = i;
        res.push({ link: l.id, kind: "사용률 80%+", s, e, peak: p, val: `${(l.out[p] / l.cap * 100).toFixed(0)}% (${l.out[p].toFixed(1)}G)`, sev: "crit", ratio: l.out[p] / l.cap });
      });
      // 2) in 급증
      const mi = slotMedians(l.in, n), mo = slotMedians(l.out, n);
      runs(l.in.map((v, i) => v >= o.spike * mi[i % PER_DAY])).forEach(([s, e]) => {
        let p = s; for (let i = s; i <= e; i++) if (l.in[i] / mi[i % PER_DAY] > l.in[p] / mi[p % PER_DAY]) p = i;
        res.push({ link: l.id, kind: "in 급증 의심", s, e, peak: p, val: `평소의 ${(l.in[p] / mi[p % PER_DAY]).toFixed(1)}배 (${l.in[p].toFixed(1)}G)`, sev: "warn", ratio: l.in[p] / mi[p % PER_DAY] });
      });
      // 3) 급감
      const dOut = l.out.map((v, i) => v < o.dropRatio * mo[i % PER_DAY]), dIn = l.in.map((v, i) => v < o.dropRatio * mi[i % PER_DAY]);
      drop[l.id] = dOut.map((f, i) => f || dIn[i]);
      const longRuns = flags => runs(flags).filter(([a, b]) => b - a >= o.dropMinPoints - 1);
      const lowest = (a, b, arr, med) => { let p = a; for (let i = a; i <= b; i++) if (arr[i] / med[i % PER_DAY] < arr[p] / med[p % PER_DAY]) p = i; return p; };
      const push = (kind, sev, a, b, arr, med, label) => {
        const p = lowest(a, b, arr, med);
        res.push({ link: l.id, kind, s: a, e: b, peak: p, val: `평소의 ${(arr[p] / med[p % PER_DAY] * 100).toFixed(0)}% (${label} ${arr[p].toFixed(1)}G)`, sev, ratio: arr[p] / med[p % PER_DAY] });
      };
      longRuns(dOut.map((f, i) => f && dIn[i])).forEach(([a, b]) => push("in·out 동시 급감", "crit", a, b, l.out, mo, "out"));
      longRuns(dOut.map((f, i) => f && !dIn[i])).forEach(([a, b]) => push("out 급감", "warn", a, b, l.out, mo, "out"));
      longRuns(dIn.map((f, i) => f && !dOut[i])).forEach(([a, b]) => push("in 급감", "warn", a, b, l.in, mi, "in"));
    }
    // 경기 일정과 겹치는지 표시
    const evWin = (data.events || []).map(ev => ({ ev, a: idxOf(parseT(ev.start)) - o.evBefore, b: idxOf(parseT(ev.end)) + o.evAfter }));
    res.forEach(a => { const hit = evWin.find(w => a.peak >= w.a && a.peak <= w.b); a.evName = hit ? hit.ev.name : ""; });
    return { alerts: res.sort((a, b) => a.s - b.s), drop };
  }

  /* 서버실 */
  function tempLevel(t, th) {   // 랙 입구 온도 단계: ok / warn(주의) / hot(경고) / crit(위험)
    const x = Object.assign({}, TEMP_DEFAULTS, th);
    return t >= x.crit ? "crit" : t >= x.hot ? "hot" : t >= x.warn ? "warn" : "ok";
  }
  function serverLed(temp, sv, ms, th) {   // 서버 LED 3개: 전원(켜짐 여부), 상태(ok/warn/crit), 디스크(ok/warn/off)
    const x = Object.assign({}, TEMP_DEFAULTS, th);
    const down = !!sv.downStart && ms >= parseT(sv.downStart) && ms < parseT(sv.downEnd);
    if (down) return { power: false, status: "crit", hdd: "off" };
    return { power: true, status: temp >= x.crit ? "crit" : temp >= x.hot ? "warn" : "ok", hdd: sv.hddWarn ? "warn" : "ok" };
  }
  function detectRoom(racks, th) {   // 입구 온도가 경고(hot) 이상인 구간
    const x = Object.assign({}, TEMP_DEFAULTS, th), res = [];
    racks.forEach(r => runs(r.temp.map(t => t >= x.hot)).forEach(([a, b]) => {
      let p = a; for (let i = a; i <= b; i++) if (r.temp[i] > r.temp[p]) p = i;
      res.push({ rack: r.id, s: a, e: b, peak: p, max: r.temp[p] });
    }));
    return res.sort((a, b) => a.s - b.s);
  }

  return { PER_DAY, DEFAULTS, TEMP_DEFAULTS, parseT, runs, median, slotMedians, detectTraffic, tempLevel, serverLed, detectRoom };
});
