// 기준값 흔들어 보기: 탐지 기준을 바꿔 가며 정답표 대비 놓침·오탐이 어떻게 변하는지 본다.
// 시험이 실제로 잘못된 기준을 잡아내는지(시험의 힘), 지금 기준이 적당한지 확인하는 용도.
// 실행: node tests/sweep.js
const { loadData, loadTruth, evaluate, Lib } = require('./helpers');

const data = loadData(), truth = loadTruth();
const total = truth.must_alert.length + truth.must_alert_room.length;

function row(label, opt) {
  const R = evaluate(data, truth, opt);
  const found = R.rows.filter(r => r.hit).length + R.room.filter(r => r.hit).length;
  const miss = R.rows.filter(r => !r.hit).map(r => r.truth.id).join(',');
  const fa = R.falseAlarms.length;
  const mark = (found === total && fa === 0) ? '  <- 정답과 일치' : '';
  console.log(label.padEnd(26), `잡음 ${found}/${total}`.padEnd(10), `오탐 ${String(fa).padStart(2)}건`.padEnd(10), miss ? `놓침: ${miss}` : '', mark);
}

const D = Lib.DEFAULTS;
console.log('현재 기준:', JSON.stringify(D), '\n');
console.log('--- 급감 기준 (평소의 몇 % 미만이면 급감 후보): 현재 40% ---');
[0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8].forEach(v => row(`dropRatio = ${v}`, { dropRatio: v }));
console.log('\n--- 급감 지속 시간 (몇 점 이상 이어져야 급감): 현재 3점(15분) ---');
[1, 2, 3, 4, 6, 12].forEach(v => row(`dropMinPoints = ${v}`, { dropMinPoints: v }));
console.log('\n--- 급증 기준 (평소의 몇 배 이상): 현재 3배 ---');
[1.5, 2, 3, 5, 6, 7, 10].forEach(v => row(`spike = ${v}`, { spike: v }));
console.log('\n--- 사용률 경고선: 현재 80% (정답표에는 사용률 사건이 없어 "경기 겹침"으로만 나뉜다) ---');
[0.5, 0.6, 0.7, 0.8, 0.9].forEach(v => {
  const R = evaluate(data, truth, { usage: v });
  const u = R.alerts.filter(a => a.kind === '사용률 80%+');
  console.log(`usage = ${v}`.padEnd(26), `사용률 알림 ${String(u.length).padStart(2)}건`, `(경기 겹침 ${u.filter(a => a.evName).length}, 경기 아님 ${u.filter(a => !a.evName).length})`);
});
