// 화면 점검: 사이트를 열어 오류 없이 뜨는지, 핵심 기능이 되는지 확인한다.
// 실행: node tests/smoke.js [주소]   (기본: site/index.html 파일)
// 필요: playwright (npm i playwright)
const { chromium } = require('playwright');
const path = require('path');

const url = process.argv[2] || 'file://' + path.resolve(__dirname, '../site/index.html');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' - ' + extra : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  const goTo = async (iso, win) => { if (win) await page.selectOption('#win', String(win)); await page.fill('#endTime', iso); await page.press('#endTime', 'Tab'); await page.waitForTimeout(150); };
  await page.waitForTimeout(400);

  check('그래프 패널 15개', (await page.locator('.panel').count()) === 15);
  check('가상 데이터 표시가 맨 위에 있음', (await page.locator('.badge').innerText()).includes('가상 데이터'));

  const box = await page.locator('#p-IDC_B_FS1_UP1 svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 60);
  await page.waitForTimeout(150);
  const tip = await page.locator('#p-IDC_B_FS1_UP1 .tip').innerText();
  check('hover하면 in/out 값이 뜸', /IN/.test(tip) && /OUT/.test(tip), tip.replace(/\n/g, ' | '));

  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csvAll')]);
  const csvPath = await csv.path();
  const text = require('fs').readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  check('전체 CSV 헤더와 180행(15회선 x 12점)', text.startsWith('time,link,in_gbps,out_gbps,out_util_pct') && text.trim().split('\n').length === 181);

  await page.selectOption('#cust', '샘플게임즈');
  check('고객사 선택 시 해당 그래프만 보임', (await page.locator('.panel:visible').count()) === 2);
  await page.selectOption('#cust', 'all');
  check('관제 첫 화면에는 경고 이력·내 업무 칸이 없고 모니터만 있음', (await page.locator('#tab-monitor #alertTbl').count()) === 0 && (await page.locator('#tab-monitor #taskTbl').count()) === 0 && !(await page.locator('#alertTbl').isVisible()));
  check('종 아이콘이 있고 확인 필요 건수가 4로 뜸 (경고 3 + 온도 1)', (await page.locator('#bell').isVisible()) && (await page.locator('#bellN').innerText()) === '4');
  await page.click('#bell');
  const alertText = await page.locator('#alertTbl').innerText();
  check('종을 누르면 알림이 열리고, 기본은 확인 필요만 보임 (급감·온도 경고 포함, 경기 겹침은 숨김)', (await page.locator('#notif').isVisible()) && alertText.includes('급감') && alertText.includes('온도 경고') && !alertText.includes('월드컵'));
  await page.check('#showAllAlerts');
  check('"경기와 겹치는 알림도 보기"를 켜면 월드컵 알림이 나타남', (await page.locator('#alertTbl').innerText()).includes('월드컵'));
  await page.uncheck('#showAllAlerts');
  await page.click('[data-np=tasks]');
  check('내 업무 탭에 업무 목록이 있음', (await page.locator('#taskTbl').innerText()).includes('월말 자료 발송'));
  await page.keyboard.press('Escape');
  check('Esc로 알림이 닫힘', !(await page.locator('#notif').isVisible()));
  await page.click('[data-tab=room]');
  await page.click('#bell'); await page.click('[data-np=alerts]');
  await page.locator('#alertTbl tr.click').first().click();
  check('알림 행을 누르면 닫히고 관제의 그 시각으로 이동 (10/21)', !(await page.locator('#notif').isVisible()) && (await page.locator('#tab-monitor').isVisible()) && (await page.locator('#endTime').inputValue()).startsWith('2026-10-21'));
  await goTo('2026-10-23T20:35');
  check('급감 구간에서 IDC_B_FS2_IX1 패널에 급감 표시', (await page.locator('#p-IDC_B_FS2_IX1 .chip').innerText()) === '급감');
  await goTo('2026-10-21T14:35');
  check('회선 다운 구간에서 IDC_A_FS1_UP1 패널에 급감 표시', (await page.locator('#p-IDC_A_FS1_UP1 .chip').innerText()) === '급감');

  await goTo('2026-10-30T22:05', 36);
  const marks = await page.locator('#p-IDC_B_FS1_UP1 svg text', { hasText: '하프타임' }).count()
    + await page.locator('#p-IDC_B_FS1_UP1 svg text', { hasText: '하이드레이션' }).count();
  check('경기 시간대에서 하이드레이션·하프타임 표시', marks >= 2, String(marks));

  // 빠른 이동 버튼은 없고, "현재로" 버튼 하나로 돌아온다
  check('빠른 이동 버튼과 경기 보기 선택이 없다', (await page.locator('[data-jump]').count()) === 0 && (await page.locator('#jumpEv').count()) === 0 && !(await page.locator('#tab-monitor .toolbar').innerText()).includes('빠른 이동'));
  await page.click('#goNow');
  check('현재로 버튼: 가상 현재(10/22 21:00), 1시간 창으로 돌아옴', (await page.locator('#endTime').inputValue()) === '2026-10-22T21:00' && (await page.locator('#win').inputValue()) === '12');
  for (const w of [1366, 1280]) {   // 폭이 좁아져도 위쪽 도구줄이 한 줄을 유지하는가
    await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
    const spread = await page.evaluate(() => { const ys = [...document.querySelectorAll('#tab-monitor .toolbar > *')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); return Math.max(...ys) - Math.min(...ys); });
    check(`폭 ${w}px에서 위쪽 도구줄이 한 줄`, spread < 14, `높이 차 ${spread.toFixed(0)}px`);
  }
  await page.setViewportSize({ width: 1600, height: 900 });

  // 탭 순서와 센터 선택: 센터 선택은 관제·서버실에서만 보이고, 두 화면이 같은 센터로 동기화된다
  check('탭 순서: 관제 / 서버실 / 서버실-3D / 장비 터미널 / 이벤트 대비 / 월간 자료 / 방문 신청', JSON.stringify(await page.locator('#tabs button').allInnerTexts()) === JSON.stringify(['관제', '서버실', '서버실-3D', '장비 터미널', '이벤트 대비', '월간 자료', '방문 신청']));
  const vis = {};
  for (const tab of ['monitor', 'room', 'room3d', 'term', 'event', 'monthly', 'visit']) { await page.click(`[data-tab=${tab}]`); vis[tab] = await page.locator('#centerBar').isVisible(); }
  check('센터 선택은 관제·서버실에서만 보이고 나머지 탭에서는 숨겨짐', vis.monitor && vis.room && vis.room3d && !vis.term && !vis.event && !vis.monthly && !vis.visit, JSON.stringify(vis));
  // 서버실-3D (WebGL): 랙 8개 정면, 목록·상세·아래 영역 연동, 장비 클릭, 확대/축소, 드래그
  await page.click('[data-tab=room3d]');
  await page.click('#centerBar [data-center=ALL]');
  await page.waitForFunction(() => window.THREE && document.querySelectorAll('#glList .gli').length > 0, null, { timeout: 15000 });
  check('서버실-3D: 전체 보기 왼쪽 목록에 랙 44개', (await page.locator('#glList .gli').count()) === 44, await page.locator('#glList .gli').count());
  check('서버실-3D: 3D 화면(canvas)이 그려지고 비어 있지 않음', await page.evaluate(() => { const c = document.getElementById('glCanvas'); if (!c || c.width < 100) return false; const t = document.createElement('canvas'); t.width = 64; t.height = 64; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 90) n++; return n > 100; }));
  await page.click('#centerBar [data-center=S]');
  const rowsS = await page.locator('#r3RowSel option').count();
  check('서버실-3D: 서초 랙 16개는 8개씩 2열로 나뉨', rowsS === 2 && (await page.locator('#glList .gli').count()) === 16, rowsS);
  await page.selectOption('#r3RowSel', '1');
  check('서버실-3D: 2열을 고르면 위쪽 경로 표시가 바뀜', (await page.locator('#glCrumb').innerText()).includes('S_R09~S_R16'));
  await page.fill('#glSearch', 'AS30');
  check('서버실-3D: 검색 "AS30"은 그 장비가 든 랙 1개만 남김', (await page.locator('#glList .gli').count()) === 1, await page.locator('#glList .gli').count());
  await page.fill('#glSearch', '');
  await page.click('[data-glf=crit]');
  check('서버실-3D: 필터 "경고·위험"은 평소엔 0개', (await page.locator('#glList .gli').count()) === 0);
  await page.click('[data-glf=all]');
  await page.click('#glList .gli[data-rack="IDC_S_R02"]');
  check('서버실-3D: 목록에서 랙을 누르면 오른쪽 상세·아래 목록이 그 랙으로 바뀜', (await page.locator('#glDetail').innerText()).includes('IDC_S_R02') && (await page.locator('#glDevs').innerText()).includes('IDC_S_R02'));
  // 3D 화면을 직접 눌러 장비 선택: 카메라 위치로 화면 좌표를 계산하지 않고, 화면 맞춤 상태에서 랙 한가운데를 누른다
  await page.click('#r3RowSel'); await page.selectOption('#r3RowSel', '0');
  await page.waitForTimeout(300);
  const cv = await page.locator('#glCanvas').boundingBox();
  const spot = await page.evaluate(() => {   // 첫 번째 랙의 장비(맨 아래쪽 큰 섀시)가 화면 어디에 보이는지 투영해서 구함
    const v = new THREE.Vector3(); const g = G.root.children[0]; const m = G.ray.find(o => o.userData.kind === 'cisco'); if (!m) return null;
    m.getWorldPosition(v); v.project(G.cam); const r = G.r.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  await page.mouse.click(spot.x, spot.y);
  check('서버실-3D: 3D 화면의 장비를 누르면 오른쪽에 그 장비 상세가 나옴 (Cisco 섀시)', /IDC_S_FR\d/.test(await page.locator('#glDetail h3').innerText()) && (await page.locator('#glDetail').innerText()).includes('자산 ID'), await page.locator('#glDetail h3').innerText());
  await page.mouse.click(cv.x + 8, cv.y + 8);
  check('서버실-3D: 빈 곳을 누르면 선택이 풀림', (await page.locator('#glDetail h3').innerText()).includes('요약'));
  // 확대/축소/드래그/정면
  const d0 = await page.evaluate(() => G.cs.dist);
  await page.click('#glZoomIn'); const d1 = await page.evaluate(() => G.cs.dist);
  check('서버실-3D: 확대 버튼이 카메라를 가깝게 함', d1 < d0, `${d0} -> ${d1}`);
  await page.click('#glFit'); check('서버실-3D: 화면 맞춤으로 처음 거리로 돌아옴', Math.abs((await page.evaluate(() => G.cs.dist)) - d0) < 0.01);
  await page.mouse.move(cv.x + 300, cv.y + 300); await page.mouse.down(); await page.mouse.move(cv.x + 420, cv.y + 300, { steps: 5 }); await page.mouse.up();
  const az = await page.evaluate(() => G.cs.az);
  check('서버실-3D: 드래그하면 시점이 회전하고 좌우 70도를 넘지 않음', Math.abs(az) > 5 && Math.abs(az) <= 70, az);
  await page.mouse.move(cv.x + 100, cv.y + 200);
  check('서버실-3D: 마우스를 뗀 뒤에는 시점이 더 바뀌지 않음', (await page.evaluate(() => G.cs.az)) === az);
  await page.click('#glHome'); check('서버실-3D: 초기 시점 버튼', (await page.evaluate(() => G.cs.az)) === 0);
  // 사건: 냉각 이상 -> 분당 R07 선택, 위험 표시, 장비 상세에서 포트·광케이블
  await page.click('[data-r3="2026-10-26T16:15"]');
  check('서버실-3D: 장비 꺼짐 버튼은 분당으로 맞추고 IDC_B_R07을 선택', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'B' && (await page.locator('#glDetail h3').innerText()).includes('IDC_B_R07'));
  check('서버실-3D: 목록의 R07이 경고·위험 상태이고 필터에 잡힘', (await page.locator('#glList .gli[data-rack="IDC_B_R07"] .dot.crit').count()) === 1);
  await page.click('#glDevs tr[data-id="IDC_B_FS6"]');
  const t6 = await page.locator('#glDetail').innerText();
  check('서버실-3D: 아래 장비 목록에서 IDC_B_FS6을 누르면 꺼짐 상태·알림이 보임', t6.includes('IDC_B_FS6') && t6.includes('꺼짐') && t6.includes('과열로 꺼짐'), t6.slice(0, 80));
  await page.click('[data-glmode=temp]');
  check('서버실-3D: 온도 보기로 바꿀 수 있음', (await page.locator('[data-glmode=temp].on').count()) === 1);
  await page.click('#glPorts');
  check('서버실-3D: 포트·광케이블 자세히 창이 열리고 연결 포트가 보임', (await page.locator('#r3Detail').isVisible()) && (await page.locator('#r3Detail .pt.u').count()) >= 1);
  await page.keyboard.press('Escape');
  check('서버실-3D: Esc로 상세 창이 닫힘', !(await page.locator('#r3Detail').isVisible()));
  const [p3] = await Promise.all([ctx.waitForEvent('page'), page.click('#glTerm')]);
  await p3.waitForLoadState('load');
  check('서버실-3D: 오른쪽 상세에서 터미널 열기', (await p3.locator('#termTarget').innerText()).includes('IDC_B_FS6'));
  await p3.close();
  await page.click('[data-tab=monitor]');
  const barMon = await page.locator('#centerBar').innerText();
  const order = await page.locator('#centerBar .cbtn').evaluateAll(els => els.map(e => e.dataset.center));
  check('센터 순서: 전체 → 서초 → 분당 → 구로 → 안산', JSON.stringify(order) === JSON.stringify(['ALL', 'S', 'B', 'G', 'A']), order.join());
  await page.click('#centerBar [data-center=B]');
  const bPanels = await page.locator('.panel:visible').evaluateAll(els => els.map(e => e.id.replace('p-', '')));
  check('분당 관제에는 분당 회선과 함께 서초에서 들어오는 회선(IDC_S_FS2_TOB1)도 보임', bPanels.includes('IDC_S_FS2_TOB1') && bPanels.includes('IDC_B_FS1_UP1') && !bPanels.includes('IDC_G_FS1_UP1'), bPanels.join());
  await page.click('#centerBar [data-center=S]');
  check('서초 관제에도 그 회선이 보임', (await page.locator('#p-IDC_S_FS2_TOB1:visible').count()) === 1);
  await page.click('#centerBar [data-center=ALL]');
  await page.click('[data-tab=room]');
  const barRoom = await page.locator('#centerBar').innerText();
  check('센터 버튼 옆의 숫자: 관제에는 없고 서버실에서만 "랙 · 장비" 수가 보임', !/\d/.test(barMon) && /랙 10 · 장비 22/.test(barRoom) && /랙 44 · 장비 120/.test(barRoom), barRoom.replace(/\n/g, ' '));
  const expectBy = await page.evaluate(() => Object.fromEntries(Object.keys(TOPOLOGY.centers).map(c => [c, {
    panels: DATA.links.filter(l => l.id.split('_')[1] === c || TOPOLOGY.links.some(t => t.link === l.id && t.feeds === c)).map(l => l.id).sort(),
    racks: DATA.racks.filter(r => r.id.split('_')[1] === c).map(r => r.id).sort(),
    devs: TOPOLOGY.devices.filter(d => d.id.split('_')[1] === c).map(d => d.id).sort()
  }])));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const code of ['B', 'S', 'G', 'A']) {
    await page.click('[data-tab=monitor]');
    await page.click(`#centerBar [data-center=${code}]`);
    const panels = (await page.locator('.panel:visible').evaluateAll(els => els.map(e => e.id.replace('p-', '')))).sort();
    await page.click('[data-tab=room]');
    const racks = (await page.locator('#racks .rack').evaluateAll(els => els.map(e => e.dataset.rack))).sort();
    const devs = (await page.locator('#racks .rdev').evaluateAll(els => els.map(e => e.dataset.dev))).sort();
    const e = expectBy[code];
    const feeds = await page.evaluate(() => TOPOLOGY.links.filter(t => t.feeds).map(t => t.link));   // 다른 센터에서 들어오는 회선은 예외
    const allCode = [...panels.filter(id => !feeds.includes(id)), ...racks, ...devs].every(id => id.split('_')[1] === code);
    check(`센터 ${code}: 관제 그래프 ${panels.length}와 서버실 랙 ${racks.length}(장비 ${devs.length})가 같은 센터 소속이고 설계도·데이터와 일치`,
      same(panels, e.panels) && same(racks, e.racks) && same(devs, e.devs) && allCode,
      `그래프 ${same(panels, e.panels)}, 랙 ${same(racks, e.racks)}, 이름 ${allCode}`);
  }
  // 터미널은 센터 선택과 상관없이 전체 장비를 보여 준다
  await page.click('[data-tab=monitor]'); await page.click('#centerBar [data-center=S]');
  await page.click('[data-tab=term]');
  const devCount = await page.locator('#devTbl tr.click').count();
  check('터미널·설계도는 센터 선택과 상관없이 전체 장비를 보여 줌 (서초를 골라도 120대)', devCount === (await page.evaluate(() => TOPOLOGY.devices.length)) && devCount === 120, String(devCount));
  // 고객사 19곳, 모든 회선에 고객사가 있고, 제목은 길면 줄여서 보인다
  const cust = await page.evaluate(() => ({ n: CUSTOMERS.length, keys: new Set(CUSTOMERS.map(c => c.key)).size, bad: CUSTOMERS.flatMap(c => c.links).filter(id => !LINK[id]), none: LINKS.filter(l => custOf(l.id).length === 0).map(l => l.id) }));
  check('고객사 19곳(가상), 이름·키 중복 없음, 존재하지 않는 회선 없음, 고객사가 없는 회선 없음', cust.n === 19 && cust.keys === 19 && cust.bad.length === 0 && cust.none.length === 0, JSON.stringify(cust));
  await page.click('[data-tab=monitor]'); await page.click('#centerBar [data-center=ALL]');
  const titles = await page.locator('.panel .hd b').allInnerTexts();
  check('그래프 제목에 "공용"이 없고, 고객사가 3곳 이상이면 "외 N곳"으로 줄여 보임', titles.every(t => !t.includes('공용')) && titles.some(t => /외 \d+곳/.test(t)) && titles.every(t => t.split(' · ').length <= 2 || /외 \d+곳/.test(t)), titles.join(' | '));
  // 서초를 보다가 "냉각 이상" 버튼을 누르면 사건이 있는 분당으로 센터가 맞춰진다
  await page.click('#centerBar [data-center=S]');
  await page.click('[data-tab=room]');
  await page.click('[data-sr="2026-10-26T15:55"]');
  check('냉각 이상 버튼: 서초를 보고 있어도 사건이 있는 분당으로 맞춰지고 IDC_B_R07가 보임', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'B' && (await page.locator('.rack[data-rack="IDC_B_R07"]').count()) === 1);
  check('서버실 화면에 옛 랙 이름(A-03)이 없음', !(await page.locator('#tab-room').innerText()).includes('A-03'));
  // 서버실에서 장비를 누르면 그 장비의 터미널이 열린다 (서초)
  await page.click('#centerBar [data-center=S]');
  await page.click('[data-tab=room]');
  const [popS] = await Promise.all([ctx.waitForEvent('page'), page.click('#racks .rdev >> nth=0')]);
  await popS.waitForLoadState('load');
  const tgt = await popS.locator('#termTarget').innerText();
  check('서초 랙의 첫 장비를 누르면 그 장비(IDC_S_FR1) 터미널이 열림', /^IDC_S_FR1 · IDC_S_R01/.test(tgt), tgt);
  await popS.close();
  // 센터 선택은 저장되어 새로고침해도 유지된다
  await page.click('#centerBar [data-center=G]');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.click('[data-tab=monitor]');   // 새로고침한 주소에 #room이 남아 있을 수 있어 관제 화면으로 간다
  check('센터 선택(구로)이 새로고침 후에도 유지됨', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'G' && (await page.locator('.panel:visible').count()) === 2);
  await page.click('#centerBar [data-center=ALL]');
  check('전체를 고르면 그래프 15개가 모두 보임', (await page.locator('.panel:visible').count()) === 15);

  // 시나리오 4가지: 시간이 흘러가고, 단계(감지·확인·조치·결과)가 나오고, 닫으면 현재로 돌아온다
  const scenarios = [['calm', '평일 오후 7시', 4, ['그래프 15개 확인', '서버실 확인', '이상 없음']], ['drop', '트래픽 급감', 6, ['급감', 'IDC_B_FS2_INTL1', '광값', '예시미디어', '회복']],
    ['linkDown', '업링크 회선 다운', 8, ['Admin', '트래픽(전/후)', '광값', 'ping', '연동망', '회복']], ['surge', '트래픽 폭주', 7, ['사전 연락', '분산', '하이드레이션', '경고선 80%', '사후 정리', '[사전 안내]']], ['temp', '서버실 온도 변화', 7, ['온도 경고', '빨강 깜박임', '터미널', '냉각 복구', '-40.00 dBm']]];
  for (const [id, name, n, words] of scenarios) {
    await page.click('[data-tab=monitor]');
    await page.click('#scnBtn'); await page.click(`#scnMenu [data-scn=${id}]`);
    const t0 = await page.locator('#scnTime').innerText();
    await page.waitForTimeout(2800);   // 첫 단계가 나오면 약 1.4초 멈추므로 그보다 길게 기다린다
    const t1 = await page.locator('#scnTime').innerText();
    check(`시나리오 "${name}": 시간이 자동으로 흘러감`, (await page.locator('#scnBar').isVisible()) && t0 !== t1, `${t0} -> ${t1}`);
    await page.click('#scnSkip');
    const txt = await page.locator('#scnSteps').textContent();
    const cnt = await page.locator('#scnSteps li').count();
    check(`시나리오 "${name}": 단계 ${n}개와 핵심 내용이 나옴`, cnt === n && words.every(w => txt.includes(w)), `단계 ${cnt}/${n}, 빠진 말: ${words.filter(w => !txt.includes(w)).join(',') || '없음'}`);
    if (id === 'drop') {
      check('급감 시나리오: IDC_B_FS2_IX1 패널이 강조 표시됨', (await page.locator('#p-IDC_B_FS2_IX1.hl').count()) === 1);
      await page.waitForTimeout(1200);   // 자동 스크롤이 끝나길 기다림
      const vis = await page.evaluate(() => { const r = document.querySelector('#p-IDC_B_FS2_IX1').getBoundingClientRect(), bar = document.querySelector('#scnBar').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, barBottom: bar.bottom, h: innerHeight }; });
      check('급감 시나리오: 강조된 IDC_B_FS2_IX1 패널이 안내 막대에 가리지 않고 화면 안에 보임', vis.top >= vis.barBottom - 2 && vis.bottom <= vis.h + 2, JSON.stringify(vis));
      check('안내 막대 높이가 화면의 30% 이하 (그래프를 가리지 않음)', vis.barBottom <= vis.h * 0.30, `막대 아래 ${vis.barBottom.toFixed(0)}px / 화면 ${vis.h}px`);
    }
    if (id === 'temp') check('온도 시나리오: 서버실 탭으로 이동하고 IDC_B_R07 랙이 강조 표시됨', (await page.locator('#tab-room').isVisible()) && (await page.locator('.rack.hl[data-rack="IDC_B_R07"]').count()) === 1);
    await page.click('#scnClose');
    check(`시나리오 "${name}": 닫으면 관제 현재(10/22 21:00)로 돌아옴`, !(await page.locator('#scnBar').isVisible()) && (await page.locator('#tab-monitor').isVisible()) && (await page.locator('#endTime').inputValue()) === '2026-10-22T21:00');
  }

  await page.click('[data-tab=event]');
  const planText = await page.locator('#evPlan').innerText();
  check('센터 이름이 지명(분당·안산·구로·서초)으로 나옴', ['분당 → 중앙 백본 (A)', '안산 → 중앙 백본 (Juniper)', '구로 → 중앙 백본', '서초 센터 백본 (Cisco)'].every(w => planText.includes(w)) && !/우리 센터|센터B|센터C|센터D/.test(planText), planText.split('\n').slice(0, 3).join(' | '));
  for (const t of ['monthly', 'event', 'room', 'visit', 'term']) {
    await page.click(`[data-tab=${t}]`);
    await page.waitForTimeout(150);
    check(`${t} 탭 열림`, await page.locator('#tab-' + t).isVisible());
  }

  await page.click('[data-tab=monthly]');
  const [zip] = await Promise.all([page.waitForEvent('download'), page.click('#mZip')]);
  const zbuf = require('fs').readFileSync(await zip.path());
  check('월간 자료 zip 시그니처(PK)와 영문 파일 이름', zbuf[0] === 0x50 && zbuf[1] === 0x4b && /^traffic_gasang_.*\.zip$/.test(zip.suggestedFilename()), zip.suggestedFilename());

  const monthlyText = await page.locator('#tab-monthly').innerText();
  check('월간 자료 기본값: 지난달 1일~말일 한 달치', (await page.locator('#mMonth').inputValue()) === '2026-10' && (await page.locator('#mFrom').inputValue()) === '2026-10-01' && (await page.locator('#mTo').inputValue()) === '2026-10-31');
  check('기간 단위 선택은 없다 (기본 한 달, 다른 기간은 시작일·끝나는 날)', (await page.locator('#mUnits').count()) === 0);
  check('"대상 월"이라는 이름을 쓴다 ("기준 월"은 없음)', monthlyText.includes('대상 월') && !monthlyText.includes('기준 월'));
  check('시작일 옆 안내 문구("다른 기간이 필요하면…")를 지웠다', !monthlyText.includes('다른 기간이 필요하면'));
  const look = await page.evaluate(() => { const g = id => getComputedStyle(document.querySelector(id)).backgroundColor; return { month: g('#mMonth'), from: g('#mFrom'), scheme: getComputedStyle(document.documentElement).colorScheme }; });
  check('대상 월 입력칸이 다른 입력칸처럼 검정 배경이고, 달력 아이콘이 흰색이 되는 다크 모드', look.month === look.from && look.month !== 'rgb(255, 255, 255)' && look.scheme.includes('dark'), JSON.stringify(look));
  check('시작일이 끝나는 날보다 위에 있음', await page.evaluate(() => !!(document.querySelector('#mFrom').compareDocumentPosition(document.querySelector('#mTo')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  check('메일 초안에 기간이 10/01~10/31로 들어감', (await page.locator('#mMail').inputValue()).includes('2026-10-01 ~ 2026-10-31'));
  await page.fill('#mMonth', '2026-11'); await page.press('#mMonth', 'Tab');
  check('대상 월을 바꾸면 시작일·끝나는 날이 따라 바뀜(데이터가 있는 날까지)', (await page.locator('#mFrom').inputValue()) === '2026-11-01' && (await page.locator('#mTo').inputValue()) === '2026-11-01');
  await page.fill('#mMonth', '2026-10'); await page.press('#mMonth', 'Tab');
  await page.fill('#mFrom', '2026-05-01'); await page.press('#mFrom', 'Tab');
  const [z6] = await Promise.all([page.waitForEvent('download'), page.click('#mZip')]);
  const z6buf = require('fs').readFileSync(await z6.path());
  check('긴 기간(5/1~10/31) zip: 크기가 크고(>3MB) 파일 이름에 기간이 들어감', z6buf.length > 3e6 && /2026-05-01_2026-10-31/.test(z6.suggestedFilename()), (z6buf.length / 1e6).toFixed(1) + 'MB ' + z6.suggestedFilename());
  const ratio = await page.evaluate(() => {
    const l = LINK['IDC_B_FS1_UP1'], f = d => Math.max(...seriesFor(l, parseT(d + 'T00:00'), parseT(d + 'T23:55')).out);
    return f('2026-10-12') / f('2026-10-19');
  });
  check('10/19 이전 가상 구간이 이후 실제 구간과 비슷한 크기(±10%)', Math.abs(ratio - 1) < 0.10, ratio.toFixed(3));
  await page.fill('#mFrom', '2026-11-01'); await page.press('#mFrom', 'Tab');
  await page.fill('#mTo', '2026-10-05'); await page.press('#mTo', 'Tab');
  check('시작일이 끝나는 날보다 늦으면 안내가 뜸', (await page.locator('#mSum').innerText()).includes('늦습니다'));
  await page.fill('#mMonth', '2026-10'); await page.press('#mMonth', 'Tab');

  await page.click('[data-tab=room]');
  await page.click('[data-sr="2026-10-26T16:15"]');
  check('냉각 이상 시 위험 랙 1개', (await page.locator('.rack.hot, .rack.crit').count()) === 1);

  await page.click('#cfgToggle');
  check('설정 패널이 열림', await page.locator('#cfgPanel').isVisible());
  await page.click('[data-sr="2026-10-22T21:00"]');
  const hotBefore = await page.locator('.rack.hot, .rack.crit').count();
  await page.fill('#cfgWarn', '22'); await page.press('#cfgWarn', 'Tab');
  await page.fill('#cfgHot', '23'); await page.press('#cfgHot', 'Tab');
  const hotAfter = await page.locator('.rack.hot, .rack.crit').count();
  check('경고 온도를 낮추면 평소 화면에서도 경고 랙이 생김', hotBefore === 0 && hotAfter >= 3, `${hotBefore} -> ${hotAfter}`);
  await page.fill('#cfgWarn', '40'); await page.press('#cfgWarn', 'Tab');
  check('주의 < 경고 < 위험 순서가 아니면 거절', (await page.locator('#cfgMsg').innerText()).includes('순서'));
  const t0 = await page.locator('#srTime').inputValue();
  await page.selectOption('#cfgSpeed', '400');
  await page.click('#srPlay'); await page.waitForTimeout(1500); await page.click('#srPlay');
  check('재생하면 기준 시각이 흘러감', (await page.locator('#srTime').inputValue()) !== t0);
  await page.click('#cfgReset');
  check('기본값으로 되돌리면 경고 랙이 다시 0', (await page.locator('.rack.hot, .rack.crit').count()) === 0);
  await page.click('#cfgToggle');

  const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('.rdev[data-dev="IDC_B_FS6"]')]);
  await pop.waitForLoadState('load');
  check('꺼진 장비(IDC_B_FS6)를 누르면 새 창에 그 장비 터미널이 열림', pop.url().includes('popup=term') && (await pop.locator('#termTarget').innerText()).includes('IDC_B_FS6 · IDC_B_R07'), await pop.locator('#termTarget').innerText());
  check('새 창에는 터미널만 보임', (await pop.locator('#tab-term').isVisible()) && !(await pop.locator('#tab-monitor').isVisible()));
  await pop.press('#termIn', 'Enter');
  check('채워 둔 첫 명령(회선 설명)이 실행됨', (await pop.locator('#termOut').innerText()).includes('Admin Link Description'));
  await pop.close();

  await page.click('[data-tab=room]');
  await page.click('#homeLink');
  check('제목을 누르면 관제(홈)로 이동', await page.locator('#tab-monitor').isVisible());

  await page.click('[data-tab=visit]');
  await page.click('#vParse');
  await page.click('#vReg');
  check('방문 등록 후 회신 초안이 생김', (await page.locator('#vReply').inputValue()).includes('방문 등록 완료'));

  await page.click('[data-tab=term]');
  const opts = async () => (await page.locator('#devSel option').allInnerTexts()).map(o => o.split(' · ')[0]);
  check('제조사 기본값은 Juniper이고 Juniper 장비만 나옴', (await page.locator('#vendorSel').inputValue()) === 'juniper' && (await opts()).length === 34 && (await opts()).includes('IDC_B_FS1') && (await opts()).includes('IDC_S_FS1'));
  await page.selectOption('#vendorSel', 'cisco');
  check('Cisco를 고르면 Cisco 장비만 나옴 (16대)', (await opts()).length === 16 && (await opts()).includes('IDC_S_FR6'));
  const qcmds = await page.locator('#qcmd button').allInnerTexts();
  check('자주 쓰던 명령에 같은 명령이 두 번 나오지 않음 (Cisco 장비)', qcmds.length > 0 && new Set(qcmds).size === qcmds.length, qcmds.join(' | '));
  await page.selectOption('#vendorSel', 'huawei');
  check('Huawei를 고르면 Huawei 장비만 나옴 (70대)', (await opts()).length === 70 && (await opts()).includes('IDC_B_AS1') && (await opts()).includes('IDC_S_AS30'));
  await page.click('#qcmd button');
  await page.press('#termIn', 'Enter');
  check('Huawei 명령 출력 (첫 자주 쓰는 명령 = 회선 설명)', (await page.locator('#termOut').innerText()).includes('PHY: Physical'));
  await page.selectOption('#vendorSel', 'juniper');
  await page.click('#qcmd button');
  await page.press('#termIn', 'Enter');
  check('터미널 명령 출력 (첫 자주 쓰는 명령 = 회선 설명)', (await page.locator('#termOut').innerText()).includes('Admin Link Description'));
  // 업무 메모에서 가져온 명령: Admin/Link 차이, 고객사, ARP·ping, 로그, BGP (전부 가상 출력)
  const T = await page.evaluate(() => {
    const r = (id, c) => runCmd(c, DEV[id]);
    const g = DEV.IDC_G_FS1.ifs.find(f => f[0] === 'xe-0/0/11'), ip = g[8];
    return {
      desc: r('IDC_G_FS1', 'show interfaces descriptions'), adminDown: r('IDC_B_FS1', 'show interfaces descriptions'),
      ping: r('IDC_G_FS1', `ping ${ip} rapid count 100`), pingOk: r('IDC_B_FS1', `ping ${DEV.IDC_B_FS1.ifs[0][8]} rapid count 100`),
      arpDown: r('IDC_G_FS1', 'show arp | match xe-0/0/11'), arpUp: r('IDC_B_FS1', `show arp | match ${DEV.IDC_B_FS1.ifs[0][0]}`),
      cfg: r('IDC_B_FS1', 'show configuration interfaces xe-0/0/14 | display set'), log: r('IDC_G_FS1', 'show log messages | last 20'),
      bgp: r('IDC_G_FS1', 'show bgp summary'), route: r('IDC_B_FS1', `show route ${DEV.IDC_B_FS1.ifs[0][7]}`),
      cdesc: r('IDC_S_FR1', 'show interfaces description'), cbrief: r('IDC_S_FR1', 'show interfaces brief'), clog: r('IDC_B_FR3', 'show logging last 100'), cping: r('IDC_S_FR1', `ping ${DEV.IDC_S_FR1.ifs[0][8]} repeat 100`),
      hdesc: r('IDC_B_AS1', 'display interface description'), hlog: r('IDC_B_AS5', 'display logbuffer'), hcfg: r('IDC_B_AS1', 'display current-configuration interface XGigabitEthernet0/1/10'),
      wrong: r('IDC_B_AS1', 'show interfaces descriptions')
    };
  });
  check('명령 show interfaces descriptions: Admin/Link 열과 고객사가 보이고, 끊긴 포트는 Admin up·Link down', /xe-0\/0\/11\s+up\s+down\s+IDC_G_FS1_DN2 -> IDC_G_FS3 \/ 예제교육/.test(T.desc), T.desc.split('\n').slice(0, 4).join(' | '));
  check('Admin down(관리자가 내림)은 Admin down·Link down으로 따로 보임', /xe-0\/0\/14\s+down\s+down/.test(T.adminDown) && T.cfg.includes('disable'));
  check('ping rapid count 100: 끊긴 회선은 100% 손실, 정상 회선은 0% 손실', T.ping.includes('100% packet loss') && T.pingOk.includes('0% packet loss') && T.pingOk.split('\n')[1].length === 100, T.ping.split('\n').slice(-2).join(' | '));
  check('show arp | match: 정상 회선은 항목이 있고 Down 회선은 출력 없음 (IP 확인 불가)', T.arpDown === '' && /Total entries: 1/.test(T.arpUp));
  check('show log messages: Down·Admin down 같은 상태 변화가 로그에 보임', /SNMP_TRAP_LINK_DOWN.*xe-0\/0\/11/.test(T.log) && /ifName xe-0\/0\/11/.test(T.log));
  check('show bgp summary·show route: 끊긴 상대는 Active, route는 via 회선을 알려 줌', /Active/.test(T.bgp) && /via xe-0\/0\/\d+\.0/.test(T.route), T.bgp.split('\n').slice(-1)[0]);
  check('Cisco: description·brief·logging last 100·ping repeat 100', /Status\s+Protocol Description/.test(T.cdesc) && /Intf\s+LineP/.test(T.cbrief) && /Interface Te1\/0\/10, changed state to administratively down/.test(T.clog) === false && /changed state to (down|administratively down)/.test(T.clog) && /Success rate is 100 percent/.test(T.cping), T.clog.split('\n')[0]);
  check('Huawei: display interface description·logbuffer·current-configuration (L2라 IP 없음)', /\*down: administratively down/.test(T.hdesc) && /RX_POWER_LOW/.test(T.hlog) && /interface XGigabitEthernet0\/1\/10/.test(T.hcfg) && !/\d+\.\d+\.\d+\.\d+/.test(T.hdesc));
  check('장비 종류에 안 맞는 명령은 거절됨 (Huawei에 Juniper 명령)', /Unrecognized command/.test(T.wrong));
  check('가상 데이터만 씀: 실제 IP처럼 보이는 값 없이 10.x 사설 대역만', ![T.desc, T.ping, T.bgp, T.route, T.cdesc].join('\n').match(/\b(?!10\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/));

  check('콘솔·페이지 오류 없음', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})();
