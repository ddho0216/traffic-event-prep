// 탐지 정확도 보고서: 정답표와 탐지 결과를 표로 보여 준다.
// 실행: node tests/report.js
const { loadData, loadTruth, evaluate, Lib } = require('./helpers');

const data = loadData(), truth = loadTruth(), R = evaluate(data, truth);
const ymdhm = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const line = (...c) => console.log(c.join('  '));

console.log('\n=== 1. 정답표의 확인 필요 사건 vs 탐지 ===');
R.rows.forEach(r => line(r.hit ? '잡음  ' : '놓침  ', r.truth.id.padEnd(6), r.truth.link.padEnd(7), `${r.truth.start}~${r.truth.end.slice(11)}`,
  r.hit ? `-> ${r.hit.kind} (지연 ${r.delayMin}분, ${r.hit.val})` : '-> 탐지 없음'));
R.room.forEach(r => line(r.hit ? '잡음  ' : '놓침  ', r.truth.id.padEnd(6), ('랙 ' + r.truth.rack).padEnd(7), `${r.truth.start}~${r.truth.end.slice(11)}`,
  r.hit ? `-> 온도 경고 ${ymdhm(R.msOf(r.hit.s))}~${ymdhm(R.msOf(r.hit.e)).slice(11)} 최고 ${r.hit.max}°C` : '-> 탐지 없음'));

const found = R.rows.filter(r => r.hit).length + R.room.filter(r => r.hit).length, total = R.rows.length + R.room.length;
console.log('\n=== 2. 요약 ===');
line('재현율(놓치지 않음):', `${found}/${total}`, `(${Math.round(found / total * 100)}%)`);
line('오탐(정답표·경기에 없는 확인 필요 알림):', R.falseAlarms.length + R.roomFalse.length, '건');
R.falseAlarms.forEach(a => line('   오탐 ->', a.link, a.kind, a.val));
line('전체 알림:', R.alerts.length, '건 = 확인 필요', R.alerts.length - R.tagged.length, '+ 경기 겹침', R.tagged.length);
line('경기 시간대인데 표시가 빠진 알림:', R.untaggedInWindow.length, '건 / 경기 시간대 밖인데 표시가 붙은 알림:', R.taggedOutside.length, '건');

console.log('\n=== 3. 경기 겹침으로 표시된 알림 종류 ===');
const by = {}; R.tagged.forEach(a => { const k = `${a.evName} / ${a.kind}`; by[k] = (by[k] || 0) + 1; });
Object.entries(by).forEach(([k, v]) => line(String(v).padStart(3), k));
console.log('\n※ 정답표: docs/ground_truth.md');
process.exit(found === total && !R.falseAlarms.length && !R.roomFalse.length ? 0 : 1);
