// 설계도 일관성 시험: 장비·연결표가 서로 맞고 현장 설명(Juniper 주력, Cisco 소수, Huawei 소형 다수)과 맞는지 확인한다.
// 실행: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../site/topology.js');
const { loadData } = require('./helpers');

const data = loadData();
const ids = new Set(T.devices.map(d => d.id));
const count = v => T.devices.filter(d => d.vendor === v).length;

test('장비 이름이 겹치지 않는다', () => assert.equal(ids.size, T.devices.length));

test('연결표의 장비가 모두 장비 목록에 있다 (외부 상대는 제외)', () => {
  for (const l of T.links) assert.ok(ids.has(l.a), `${l.link}: A 장비 ${l.a} 없음`);
});

test('장비 하나에서 같은 포트를 두 번 쓰지 않는다', () => {
  const used = new Set();
  for (const l of T.links) {
    for (const [dev, port] of [[l.a, l.ap], [l.b, l.bp]]) {
      if (!ids.has(dev)) continue;
      const k = `${dev}|${port}`;
      assert.ok(!used.has(k), `포트 중복: ${k}`);
      used.add(k);
    }
  }
});

test('포트 이름이 제조사 형식과 맞다 (Juniper xe-, Cisco Te, Huawei XGigabitEthernet)', () => {
  const dev = Object.fromEntries(T.devices.map(d => [d.id, d]));
  const re = { juniper: /^xe-\d+\/\d+\/\d+$/, cisco: /^Te\d+\/\d+\/\d+$/, huawei: /^XGigabitEthernet\d+\/\d+\/\d+$/ };
  for (const l of T.links) for (const [d, port] of [[l.a, l.ap], [l.b, l.bp]]) if (dev[d]) assert.match(port, re[dev[d].vendor], `${d} ${port}`);
});

test('그래프의 링크 8개가 모두 연결표에 있다', () => {
  const names = new Set(T.links.map(l => l.link));
  for (const l of data.links) assert.ok(names.has(l.id), `${l.id}가 설계도에 없음`);
});

test('연결표의 용량이 그래프 링크 용량과 같다', () => {
  for (const l of data.links) assert.equal(T.links.find(x => x.link === l.id).gbps, l.cap, l.id);
});

test('랙 스위치(SW-랙이름)가 모든 랙에 있다', () => {
  for (const r of data.racks) assert.ok(ids.has('SW-' + r.id), `SW-${r.id} 없음`);
});

test('현장 설명과 맞다: Juniper가 가장 많고, Cisco는 백본 몇 대, Huawei는 소형이 여러 대', () => {
  assert.ok(count('juniper') >= count('huawei') && count('juniper') > count('cisco'), `J${count('juniper')} H${count('huawei')} C${count('cisco')}`);
  assert.ok(count('cisco') <= 3, 'Cisco가 너무 많음');
  assert.ok(count('huawei') >= 5, 'Huawei 소형 장비가 적음');
  for (const d of T.devices.filter(x => x.vendor === 'cisco')) assert.match(d.role, /백본/, `${d.id}는 백본이어야 함`);
});

test('중앙 백본이 2대(이중화)이고 서로 연결돼 있다', () => {
  const core = T.devices.filter(d => d.center === '중앙').map(d => d.id);
  assert.equal(core.length, 2);
  assert.ok(T.links.some(l => core.includes(l.a) && core.includes(l.b)), '중앙 백본끼리 연결이 없음');
});

test('센터 4개가 모두 중앙 백본에 연결되고, 중앙 백본 2대에 나눠 붙는다 (이중화)', () => {
  const center = Object.fromEntries(T.devices.map(d => [d.id, d.center]));
  const core = new Set(T.devices.filter(d => d.center === '중앙').map(d => d.id));
  const up = {};   // 센터 -> 연결된 중앙 백본 목록
  for (const l of T.links) {
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) if (core.has(y) && center[x] && center[x] !== '중앙') (up[center[x]] = up[center[x]] || new Set()).add(y);
  }
  const centers = ['우리 센터', '센터B', '센터C', '센터D'];
  for (const c of centers) assert.ok(up[c], `${c}가 중앙 백본에 연결되지 않음`);
  const used = new Set(); centers.forEach(c => up[c].forEach(x => used.add(x)));
  assert.equal(used.size, 2, '중앙 백본 2대가 모두 쓰여야 함');
});

test('CDN 연결이 한 곳이 아니라 여러 곳에 걸쳐 있다', () => {
  const cdn = T.links.filter(l => l.b === 'CDN-EDGE' || l.a === 'CDN-EDGE');
  assert.ok(cdn.length >= 2, 'CDN 연결이 하나뿐임');
  assert.ok(new Set(cdn.map(l => l.a === 'CDN-EDGE' ? l.b : l.a)).size >= 2, 'CDN이 서로 다른 장비 두 곳에 연결돼야 함');
});

test('심어 둔 포트 이상이 실제 포트에 있다', () => {
  const used = new Set();
  for (const l of T.links) { used.add(`${l.a}|${l.ap}`); used.add(`${l.b}|${l.bp}`); }
  for (const k of Object.keys(T.faults)) assert.ok(used.has(k), `${k} 포트가 연결표에 없음`);
});
