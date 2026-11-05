// 규칙 경계값 시험: 기준 바로 위·아래에서 판정이 맞는지 작은 가짜 데이터로 확인한다.
// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('../site/lib.js');

// 14일, 한 링크, 평소 out 50 / in 20 (용량 100) 으로 평평한 데이터
function make(extra) {
  const n = 14 * 288;
  return Object.assign({ start: '2026-10-19T00:00', stepMin: 5, n, events: [], racks: [],
    links: [{ id: 'L', cap: 100, out: new Array(n).fill(50), in: new Array(n).fill(20) }] }, extra);
}
const AT = 10 * 288 + 12 * 12;   // 10일째 낮 12:00 (다른 날은 평소 그대로라 중앙값이 변하지 않는다)
const kinds = d => Lib.detectTraffic(d).alerts.map(a => a.kind);
const set = (arr, from, k, v) => { for (let i = 0; i < k; i++) arr[from + i] = v; };

test('사용률: 79.9%는 경고가 아니고 80.0%는 경고', () => {
  const a = make(); a.links[0].out[AT] = 79.9;
  assert.deepEqual(kinds(a), []);
  const b = make(); b.links[0].out[AT] = 80;
  assert.deepEqual(kinds(b), ['사용률 80%+']);
});

test('급증: 평소의 2.99배는 아니고 3.0배는 급증 의심', () => {
  const a = make(); a.links[0].in[AT] = 59.9;
  assert.deepEqual(kinds(a), []);
  const b = make(); b.links[0].in[AT] = 60;
  assert.deepEqual(kinds(b), ['in 급증 의심']);
});

test('급감: 15분(3점)이어야 급감, 10분(2점)은 아니다', () => {
  const two = make(); set(two.links[0].out, AT, 2, 19.9); set(two.links[0].in, AT, 2, 7.9);
  assert.deepEqual(kinds(two), []);
  const three = make(); set(three.links[0].out, AT, 3, 19.9); set(three.links[0].in, AT, 3, 7.9);
  assert.deepEqual(kinds(three), ['in·out 동시 급감']);
});

test('급감: 평소의 정확히 40%는 급감이 아니고 40% 미만만 급감', () => {
  const at = make(); set(at.links[0].out, AT, 3, 20); set(at.links[0].in, AT, 3, 8);
  assert.deepEqual(kinds(at), []);
  const below = make(); set(below.links[0].out, AT, 3, 19.9); set(below.links[0].in, AT, 3, 7.9);
  assert.deepEqual(kinds(below), ['in·out 동시 급감']);
});

test('급감 종류: out만 / in만 / 둘 다를 구분한다', () => {
  const o = make(); set(o.links[0].out, AT, 3, 19.9);
  assert.deepEqual(kinds(o), ['out 급감']);
  const i = make(); set(i.links[0].in, AT, 3, 7.9);
  assert.deepEqual(kinds(i), ['in 급감']);
});

test('급감 구간이 끊기면 따로 센다 (3점 + 3점, 사이 1점 정상)', () => {
  const d = make(); set(d.links[0].out, AT, 3, 19.9); set(d.links[0].out, AT + 4, 3, 19.9);
  assert.deepEqual(kinds(d), ['out 급감', 'out 급감']);
});

test('경기 표시 경계: 시작 30분 전과 끝난 20분 뒤까지 붙고, 1점(5분) 더 벗어나면 안 붙는다', () => {
  const startIdx = AT, endIdx = AT + 24;   // 12:00, 14:00
  // 인접한 점은 한 구간으로 합쳐지므로, 점마다 따로 시험한다
  const tagOf = i => {
    const d = make({ events: [{ name: 'E', start: '2026-10-29T12:00', end: '2026-10-29T14:00' }] });
    d.links[0].out[i] = 90;
    const a = Lib.detectTraffic(d).alerts;
    assert.equal(a.length, 1);
    return a[0].evName;
  };
  assert.equal(tagOf(startIdx - 7), '', '시작 35분 전은 붙지 않아야 함');
  assert.equal(tagOf(startIdx - 6), 'E', '시작 30분 전은 붙어야 함');
  assert.equal(tagOf(startIdx + 6), 'E', '경기 중은 붙어야 함');
  assert.equal(tagOf(endIdx + 4), 'E', '끝난 20분 뒤는 붙어야 함');
  assert.equal(tagOf(endIdx + 5), '', '끝난 25분 뒤는 붙지 않아야 함');
});

test('기준값을 바꾸면 판정이 따라 바뀐다 (사용률 70%)', () => {
  const d = make(); d.links[0].out[AT] = 75;
  assert.deepEqual(Lib.detectTraffic(d).alerts.map(a => a.kind), []);
  assert.deepEqual(Lib.detectTraffic(d, { usage: 0.7 }).alerts.map(a => a.kind), ['사용률 80%+']);
});

test('랙 온도 단계 경계: 27 주의 / 30 경고 / 33 위험', () => {
  const table = [[26.9, 'ok'], [27, 'warn'], [29.9, 'warn'], [30, 'hot'], [32.9, 'hot'], [33, 'crit'], [40, 'crit']];
  for (const [t, want] of table) assert.equal(Lib.tempLevel(t, {}), want, `${t}°C`);
});

test('서버 LED 상태: 30°C부터 주황, 33°C부터 빨강', () => {
  const sv = { hddWarn: false };
  for (const [t, want] of [[29.9, 'ok'], [30, 'warn'], [32.9, 'warn'], [33, 'crit']])
    assert.equal(Lib.serverLed(t, sv, Lib.parseT('2026-10-22T12:00'), {}).status, want, `${t}°C`);
});

test('서버 LED 디스크: 경고 서버는 항상 주황, 아니면 초록', () => {
  const ms = Lib.parseT('2026-10-22T12:00');
  assert.equal(Lib.serverLed(22, { hddWarn: true }, ms, {}).hdd, 'warn');
  assert.equal(Lib.serverLed(22, { hddWarn: false }, ms, {}).hdd, 'ok');
});

test('서버 꺼짐 경계: 시작 시각은 꺼짐, 끝 시각은 켜짐', () => {
  const sv = { hddWarn: false, downStart: '2026-10-26T16:05', downEnd: '2026-10-26T16:25' };
  const at = s => Lib.serverLed(22, sv, Lib.parseT(s), {});
  assert.equal(at('2026-10-26T16:00').power, true);
  assert.equal(at('2026-10-26T16:05').power, false);
  assert.equal(at('2026-10-26T16:20').power, false);
  assert.equal(at('2026-10-26T16:25').power, true);
  assert.deepEqual(at('2026-10-26T16:10'), { power: false, status: 'crit', hdd: 'off' });
});

test('랙 온도 경고 구간: 30.0 이상만 구간으로 잡는다', () => {
  const racks = [{ id: 'R', temp: [29.9, 30, 30.1, 29.9, 31] }];
  const r = Lib.detectRoom(racks, {});
  assert.deepEqual(r.map(a => [a.s, a.e, a.max]), [[1, 2, 30.1], [4, 4, 31]]);
});

// 아직 해결 못 한 불일치: 랙 이름 옆 색은 27°C부터 "주의"인데 서버 LED 상태는 30°C부터 주황이다.
test('서버 LED 상태도 27°C부터 주의(주황)다 (랙 색 기준과 같다)', { todo: '2순위에서 기준 통일' }, () => {
  const lvl = Lib.tempLevel(27.5, {});
  assert.equal(lvl, 'warn');
  assert.equal(Lib.serverLed(27.5, { hddWarn: false }, Lib.parseT('2026-10-22T12:00'), {}).status, 'warn');
});
