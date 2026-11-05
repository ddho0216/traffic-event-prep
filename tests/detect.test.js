// 탐지 정확도 시험: 정답표(tests/ground_truth.json)와 탐지 결과를 비교한다.
// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadData, loadTruth, evaluate } = require('./helpers');

const data = loadData(), truth = loadTruth(), R = evaluate(data, truth);
const brief = a => `${a.link} ${a.kind} idx${a.s}~${a.e} (${a.val})`;

for (const row of R.rows) {
  test(`놓치지 않는다: ${row.truth.id} ${row.truth.link} ${row.truth.why}`, () => {
    assert.ok(row.hit, `정답표의 ${row.truth.id}(${row.truth.start}~${row.truth.end})를 탐지하지 못함`);
  });
  test(`너무 늦지 않다 (15분 이내): ${row.truth.id}`, () => {
    assert.ok(row.hit && row.delayMin <= 15, `탐지 지연 ${row.delayMin}분`);
  });
}
for (const r of R.room) {
  test(`서버실 온도 경고를 잡는다: ${r.truth.id} 랙 ${r.truth.rack}`, () => {
    assert.ok(r.hit, `랙 ${r.truth.rack} 냉각 이상(${r.truth.start}~${r.truth.end})을 못 잡음`);
  });
}

test('오탐 0: 정답표에도 경기에도 없는 "확인 필요" 알림이 없다', () => {
  assert.equal(R.falseAlarms.length, 0, '오탐: ' + R.falseAlarms.map(brief).join(' / '));
});
test('서버실 오탐 0: 냉각 이상 말고는 온도 경고가 없다', () => {
  assert.equal(R.roomFalse.length, 0, '오탐: ' + JSON.stringify(R.roomFalse));
});
test('경기 시간대의 알림에는 전부 "경기 겹침" 표시가 붙는다', () => {
  assert.equal(R.untaggedInWindow.length, 0, '표시 누락: ' + R.untaggedInWindow.map(brief).join(' / '));
});
test('경기 시간대가 아닌데 "경기 겹침" 표시가 붙은 알림이 없다', () => {
  assert.equal(R.taggedOutside.length, 0, '잘못 붙음: ' + R.taggedOutside.map(brief).join(' / '));
});
test('급감 알림은 정답표의 2건뿐이다 (경기 종료 후 하락·하프타임을 급감으로 잡지 않는다)', () => {
  const drops = R.alerts.filter(a => a.kind.includes('급감'));
  assert.equal(drops.length, 2, drops.map(brief).join(' / '));
});
