// 설계도 일관성 시험: 장비·연결표가 서로 맞고 현장 설명(Juniper 주력, Cisco 4대, 화웨이 없음, 서초 중앙 백본, 랙 규칙, 고객사 접속)과 맞는지 확인한다.
// 실행: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../site/topology.js');
const { loadData } = require('./helpers');

const data = loadData();
const ids = new Set(T.devices.map(d => d.id));
const count = v => T.devices.filter(d => d.vendor === v).length;
const dev = Object.fromEntries(T.devices.map(d => [d.id, d]));

test('장비 이름이 겹치지 않는다', () => assert.equal(ids.size, T.devices.length));

test('이름 규칙: IDC_<센터 코드 B/S/G/A>_<FS/FR><번호>이고, 종류가 제조사와 맞다 (FS Juniper, FR Cisco)', () => {
  const kind = { juniper: 'FS', cisco: 'FR' };
  for (const d of T.devices) {
    const m = d.id.match(/^IDC_([BSGA])_(FS|FR)(\d+)$/);
    assert.ok(m, `${d.id}: 이름 규칙에 안 맞음`);
    assert.equal(m[2], kind[d.vendor], `${d.id}: 종류와 제조사가 안 맞음`);
  }
});

test('이름의 센터 코드가 센터와 맞다 (B 분당, S 서초, G 구로, A 안산)', () => {
  const name = { B: '분당 센터', S: '서초 센터', G: '구로 센터', A: '안산 센터' };
  for (const d of T.devices) assert.equal(name[d.id.split('_')[1]], d.center, d.id);
});

test('연결표의 장비가 모두 장비 목록에 있다 (외부 상대는 제외)', () => {
  for (const l of T.links) assert.ok(ids.has(l.a), `${l.link}: A 장비 ${l.a} 없음`);
});

test('장비 하나에서 같은 포트를 두 번 쓰지 않는다', () => {
  const used = new Set();
  for (const l of T.links) {
    for (const [d, port] of [[l.a, l.ap], [l.b, l.bp]]) {
      if (!ids.has(d)) continue;
      const k = `${d}|${port}`;
      assert.ok(!used.has(k), `포트 중복: ${k}`);
      used.add(k);
    }
  }
});

test('포트 이름이 제조사 형식과 맞다 (Juniper xe-, Cisco Te)', () => {
  const re = { juniper: /^xe-\d+\/\d+\/\d+$/, cisco: /^Te\d+\/\d+\/\d+$/ };
  for (const l of T.links) for (const [d, port] of [[l.a, l.ap], [l.b, l.bp]]) if (dev[d]) assert.match(port, re[dev[d].vendor], `${d} ${port}`);
});

test('연결 이름(회선)이 겹치지 않고, 규칙(IDC_센터_장비_용도)을 따른다', () => {
  const names = T.links.map(l => l.link);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^IDC_[BSGA]_(FS|FR)\d+_[A-Z]+\d*$/, n);
});

test('그래프의 회선 8개가 모두 연결표에 있다', () => {
  const names = new Set(T.links.map(l => l.link));
  for (const l of data.links) assert.ok(names.has(l.id), `${l.id}가 설계도에 없음`);
});

test('연결표의 용량이 그래프 회선 용량과 같다', () => {
  for (const l of data.links) assert.equal(T.links.find(x => x.link === l.id).gbps, l.cap, l.id);
});

test('모든 장비는 랙 하나에 들어 있고, 랙 이름의 센터 코드가 장비와 같다', () => {
  const racks = new Set(data.racks.map(r => r.id));
  for (const d of T.devices) {
    assert.ok(racks.has(d.rack), `${d.id}: 랙 ${d.rack}이 서버실 데이터에 없음`);
    assert.equal(d.rack.split('_')[1], d.id.split('_')[1], `${d.id}: 랙(${d.rack})과 센터 코드가 다름`);
  }
});

test('랙 규칙: Cisco는 랙 하나를 혼자 쓰고, Juniper는 랙당 최대 2대, 중앙 백본(대형)도 랙당 1대', () => {
  const by = {}; T.devices.forEach(d => (by[d.rack] = by[d.rack] || []).push(d));
  for (const [rack, list] of Object.entries(by)) {
    assert.ok(list.length <= 2, `${rack}: 2대 초과`);
    if (list.some(d => d.vendor === 'cisco' || d.tier === 'core')) assert.equal(list.length, 1, `${rack}: 대형 장비는 랙을 혼자 써야 함`);
  }
});

test('설계도의 랙 배치 = 서버실 데이터의 랙 배치 (같은 장비, 같은 랙)', () => {
  for (const r of data.racks) {
    const fromTopo = T.devices.filter(d => d.rack === r.id).map(d => d.id).sort();
    assert.deepEqual(r.devices.map(d => d.id).sort(), fromTopo, `랙 ${r.id}`);
    for (const d of r.devices) assert.equal(d.vendor, dev[d.id].vendor, d.id);
  }
});

test('현장 설명과 맞다: Juniper가 가장 많고, Cisco는 백본 4대, 화웨이는 없다', () => {
  assert.ok(count('juniper') > count('cisco'), `J${count('juniper')} C${count('cisco')}`);
  assert.equal(count('cisco'), 4, 'Cisco는 4대');
  assert.equal(T.devices.filter(d => !['juniper', 'cisco'].includes(d.vendor)).length, 0, 'Juniper·Cisco 말고는 없어야 함');
  for (const d of T.devices.filter(x => x.vendor === 'cisco')) assert.match(d.role, /백본/, `${d.id}는 백본이어야 함`);
});

test('고객사: 13곳 모두 접속 장비가 하나씩 있고, 그 장비는 고객사 회선이 있는 센터에 있다', () => {
  assert.equal(T.customers.length, 13);
  const keys = new Set(T.customers.map(c => c.key)); assert.equal(keys.size, 13);
  const linkIds = new Set(T.links.map(l => l.link));
  for (const c of T.customers) {
    assert.ok(c.links.length >= 1 && c.links.every(l => linkIds.has(l)), `${c.name}: 회선이 설계도에 없음`);
    const hosts = T.devices.filter(d => (d.customers || []).includes(c.key));
    assert.equal(hosts.length, 1, `${c.name}: 접속 장비가 정확히 하나여야 함`);
    assert.equal(hosts[0].id.split('_')[1], c.links[0].split('_')[1], `${c.name}: 접속 장비의 센터와 첫 회선의 센터가 다름`);
    assert.equal(hosts[0].vendor, 'juniper');
  }
  for (const d of T.devices) for (const k of d.customers || []) assert.ok(keys.has(k), `${d.id}: 없는 고객사 ${k}`);
});

test('고객 접속 장비는 장비마다 고객사 1~3곳을 받는다 (장비 하나에 너무 몰리지 않음)', () => {
  for (const d of T.devices.filter(x => x.customers)) assert.ok(d.customers.length >= 1 && d.customers.length <= 3, d.id);
});

test('분당은 장비가 가장 많다', () => {
  const by = {}; T.devices.forEach(d => { by[d.center] = (by[d.center] || 0) + 1; });
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, '분당 센터', JSON.stringify(by));
});

test('서초가 가장 큰 센터: 가장 큰 용량의 회선이 서초에 있고 중앙 백본이 서초에 있다', () => {
  const big = [...T.links].filter(l => data.links.some(x => x.id === l.link)).sort((a, b) => b.gbps - a.gbps)[0];
  assert.equal(dev[big.a].center, '서초 센터', `${big.link}`);
  const core = T.devices.filter(d => d.tier === 'core');
  assert.ok(core.every(d => d.center === '서초 센터'), '중앙 백본은 서초에');
});

test('중앙 백본이 2대(이중화)이고 서로 연결돼 있다', () => {
  const core = T.devices.filter(d => d.tier === 'core').map(d => d.id);
  assert.equal(core.length, 2);
  assert.ok(T.links.some(l => core.includes(l.a) && core.includes(l.b)), '중앙 백본끼리 연결이 없음');
});

test('센터 4개가 모두 중앙 백본에 연결되고, 중앙 백본 2대에 나눠 붙는다 (이중화)', () => {
  const core = new Set(T.devices.filter(d => d.tier === 'core').map(d => d.id));
  const up = {};   // 센터 -> 연결된 중앙 백본 목록
  for (const l of T.links) {
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) if (core.has(y) && dev[x] && !core.has(x) && !/CDN/.test(l.link)) (up[dev[x].center] = up[dev[x].center] || new Set()).add(y);
  }
  const centers = ['분당 센터', '안산 센터', '구로 센터', '서초 센터'];
  for (const c of centers) assert.ok(up[c], `${c}가 중앙 백본에 연결되지 않음`);
  const used = new Set(); centers.forEach(c => up[c].forEach(x => used.add(x)));
  assert.equal(used.size, 2, '중앙 백본 2대가 모두 쓰여야 함');
});

test('CDN 연결이 한 곳이 아니라 여러 곳에 걸쳐 있다', () => {
  const cdn = T.links.filter(l => /CDN/.test(l.link));
  assert.ok(cdn.length >= 2, 'CDN 연결이 하나뿐임');
  const peers = new Set(cdn.map(l => dev[l.a] && dev[l.a].role.includes('CDN 연결 장비') ? l.b : l.a));
  assert.ok(peers.size >= 2, 'CDN이 서로 다른 장비 두 곳에 연결돼야 함');
});

test('심어 둔 포트 이상이 실제 포트에 있다', () => {
  const used = new Set();
  for (const l of T.links) { used.add(`${l.a}|${l.ap}`); used.add(`${l.b}|${l.bp}`); }
  for (const k of Object.keys(T.faults)) assert.ok(used.has(k), `${k} 포트가 연결표에 없음`);
});

// ---------- 동기화: 센터·장비·랙·회선이 한 곳의 정보에서 나오는가 ----------
test('센터 이름 목록(centers)이 장비의 센터와 맞다', () => {
  assert.deepEqual(Object.values(T.centers).sort(), [...new Set(T.devices.map(d => d.center))].sort());
});

test('동기화: 센터마다 장비 수에 맞는 랙이 있다 (분당 6, 서초 4, 구로 2, 안산 2)', () => {
  const n = c => data.racks.filter(r => r.id.split('_')[1] === c).length;
  assert.deepEqual([n('B'), n('S'), n('G'), n('A')], [6, 4, 2, 2]);
  for (const code of Object.keys(T.centers)) {
    const used = new Set(T.devices.filter(d => d.id.split('_')[1] === code).map(d => d.rack));
    assert.equal(used.size, n(code), `${code}: 빈 랙이 있거나 랙이 모자람`);
  }
});

test('동기화: 그래프 회선의 센터 코드가 설계도 A장비의 센터와 같다', () => {
  for (const l of data.links) {
    const tl = T.links.find(x => x.link === l.id);
    assert.equal(l.id.split('_')[1], tl.a.split('_')[1], l.id);
  }
});

test('동기화: 고객 접속 장비는 같은 센터의 백본에 올라간다', () => {
  for (const d of T.devices.filter(x => x.customers)) {
    const up = T.links.find(l => l.b === d.id && dev[l.a] && dev[l.a].center === d.center);
    assert.ok(up, `${d.id}: 같은 센터 백본으로 가는 업링크가 없음`);
  }
});

test('동기화: 모든 연결의 A장비는 연결 이름의 센터 코드와 같은 센터다', () => {
  for (const l of T.links) assert.equal(l.link.split('_')[1], l.a.split('_')[1], l.link);
});
