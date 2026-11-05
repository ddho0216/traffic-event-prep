// 테스트와 보고서가 같이 쓰는 도우미: 데이터·정답표 읽기, 탐지 결과를 정답표와 비교
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Lib = require(path.join(ROOT, 'site/lib.js'));

function loadData() {
  const txt = fs.readFileSync(path.join(ROOT, 'site/data.js'), 'utf8');   // "const DATA = {...};" 형태
  return new Function(txt + '\nreturn DATA;')();
}
function loadTruth() { return JSON.parse(fs.readFileSync(path.join(__dirname, 'ground_truth.json'), 'utf8')); }
const toMs = s => Lib.parseT(s.replace(' ', 'T'));

// 탐지 결과를 정답표와 비교한다.
function evaluate(data, truth, opt) {
  const T0 = Lib.parseT(data.start), STEP = data.stepMin * 60000, tol = truth.tolerance_min * 60000;
  const msOf = i => T0 + i * STEP;
  const { alerts } = Lib.detectTraffic(data, opt);

  // 1) 알림이 떠야 하는 사건을 잡았는가
  const rows = truth.must_alert.map(t => {
    const ts = toMs(t.start), te = toMs(t.end);
    const hit = alerts.find(a => a.link === t.link && t.kind_any.includes(a.kind) && !a.evName &&
      msOf(a.s) >= ts - tol && msOf(a.e) <= te + tol && msOf(a.e) >= ts && msOf(a.s) <= te);
    return { truth: t, hit, delayMin: hit ? (msOf(hit.s) - ts) / 60000 : null };
  });
  const matched = new Set(rows.map(r => r.hit).filter(Boolean));

  // 2) 정답표에 없는데 "확인 필요"로 뜬 것 (오탐)
  const falseAlarms = alerts.filter(a => !a.evName && !matched.has(a));

  // 3) 경기 시간대 알림에 경기 표시가 붙었는가
  const evWin = truth.expected_noise.map(n => ({ n, a: toMs(n.start) - truth.tag_before_min * 60000, b: toMs(n.end) + truth.tag_after_min * 60000 }));
  const inWindow = a => evWin.some(w => msOf(a.peak) >= w.a && msOf(a.peak) <= w.b);
  const untaggedInWindow = alerts.filter(a => inWindow(a) && !a.evName);
  const taggedOutside = alerts.filter(a => a.evName && !inWindow(a));
  const tagged = alerts.filter(a => a.evName);

  // 4) 서버실 온도 경고
  const roomAlerts = Lib.detectRoom(data.racks, Lib.TEMP_DEFAULTS);
  const room = truth.must_alert_room.map(t => {
    const ts = toMs(t.start), te = toMs(t.end);
    const hit = roomAlerts.find(a => a.rack === t.rack && msOf(a.s) >= ts && msOf(a.e) <= te && a.max >= t.min_peak_c);
    return { truth: t, hit };
  });
  const roomFalse = roomAlerts.filter(a => !room.some(r => r.hit === a));

  return { alerts, rows, falseAlarms, tagged, untaggedInWindow, taggedOutside, roomAlerts, room, roomFalse, msOf };
}

module.exports = { ROOT, Lib, loadData, loadTruth, toMs, evaluate };
