// 화면 점검: 사이트를 열어 오류 없이 뜨는지, 핵심 기능이 되는지 확인한다.
// 실행: node tests/smoke.js [주소]   (기본: site/index.html 파일)
// 필요: playwright (npm i playwright)
const { chromium } = require('playwright');
const path = require('path');

const url = process.argv[2] || 'file://' + path.resolve(__dirname, '../site/index.html');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' - ' + extra : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  const goTo = async (iso, win) => { if (win) await page.selectOption('#win', String(win)); await page.fill('#endTime', iso); await page.press('#endTime', 'Tab'); await page.waitForTimeout(150); };
  await page.waitForTimeout(400);

  check('그래프 패널 8개', (await page.locator('.panel').count()) === 8);
  check('가상 데이터 표시가 맨 위에 있음', (await page.locator('.badge').innerText()).includes('가상 데이터'));

  const box = await page.locator('#p-IDC_B_FS1_UP1 svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 60);
  await page.waitForTimeout(150);
  const tip = await page.locator('#p-IDC_B_FS1_UP1 .tip').innerText();
  check('hover하면 in/out 값이 뜸', /IN/.test(tip) && /OUT/.test(tip), tip.replace(/\n/g, ' | '));

  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csvAll')]);
  const csvPath = await csv.path();
  const text = require('fs').readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  check('전체 CSV 헤더와 96행(8회선 x 12점)', text.startsWith('time,link,in_gbps,out_gbps,out_util_pct') && text.trim().split('\n').length === 97);

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
  // 서버실-3D: 정면도가 기본, 센터 선택과 맞고, 장비를 누르면 포트·광케이블 상세가 열린다
  await page.click('[data-tab=room3d]');
  await page.click('#centerBar [data-center=ALL]');
  check('서버실-3D: 기본은 정면 (좌우 0, 상하 0)', (await page.locator('#r3Yaw').inputValue()) === '0' && (await page.locator('#r3Tilt').inputValue()) === '0');
  check('서버실-3D: 한 화면에 랙 8개까지', (await page.locator('#r3Row3d .rk').count()) === 8);
  await page.click('#centerBar [data-center=S]');
  const rowsS = await page.locator('#r3RowSel option').count();
  check('서버실-3D: 서초 랙 16개는 8개씩 2열로 나뉨', rowsS === 2 && (await page.locator('#r3List tr.click').count()) === 16, rowsS);
  await page.selectOption('#r3RowSel', '1');
  const second = await page.locator('#r3Row3d .rk').evaluateAll(els => els.map(e => e.dataset.rack));
  check('서버실-3D: 2열을 고르면 서초 R09~R16이 보임', second.length === 8 && second[0] === 'IDC_S_R09' && second[7] === 'IDC_S_R16', second.join());
  await page.click('#r3List tr[data-rack="IDC_S_R02"]');
  check('서버실-3D: 목록에서 랙을 누르면 그 랙이 있는 열로 이동하고 선택됨', (await page.locator('#r3Row3d .rk.sel').getAttribute('data-rack')) === 'IDC_S_R02');
  const devsIn = await page.locator('#r3Row3d .dv').evaluateAll(els => els.map(e => e.dataset.dev));
  check('서버실-3D: 그려진 장비가 설계도의 랙 배치와 같음', JSON.stringify(devsIn.sort()) === JSON.stringify(await page.evaluate(() => TOPOLOGY.devices.filter(d => RACKS.filter(r => r.id.startsWith('IDC_S_R0') && r.id <= 'IDC_S_R08').some(r => r.id === d.rack)).map(d => d.id).sort())), devsIn.length);
  // 드래그하면 각도가 바뀌고, 정면 버튼으로 돌아온다. 클릭만 하면 각도는 그대로.
  const sbox = await page.locator('#r3Stage').boundingBox();
  await page.mouse.move(sbox.x + 300, sbox.y + 400); await page.mouse.down(); await page.mouse.move(sbox.x + 420, sbox.y + 400, { steps: 5 }); await page.mouse.up();
  const yawAfter = +(await page.locator('#r3Yaw').inputValue());
  check('서버실-3D: 드래그하면 각도가 바뀜', yawAfter > 5, yawAfter);
  await page.mouse.move(sbox.x + 100, sbox.y + 300);
  check('서버실-3D: 마우스를 떼고 움직여도 각도가 더 바뀌지 않음', +(await page.locator('#r3Yaw').inputValue()) === yawAfter);
  await page.click('#r3Front');
  check('서버실-3D: 정면 버튼으로 돌아옴', (await page.locator('#r3Yaw').inputValue()) === '0');
  await page.click('[data-r3="2026-10-26T15:55"]');
  check('서버실-3D: 냉각 이상 버튼은 분당으로 맞추고 IDC_B_R07을 고름', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'B' && (await page.locator('#r3Row3d .rk.sel').getAttribute('data-rack')) === 'IDC_B_R07' && (await page.locator('#r3Row3d .rk.crit').count()) === 1);
  await page.click('#r3Row3d .dv[data-dev="IDC_B_FS1"]', { force: true }).catch(async () => { await page.selectOption('#r3RowSel', '0'); });
  await page.waitForTimeout(100);
  if (!(await page.locator('#r3Detail').isVisible())) { await page.click('#r3Row3d .dv[data-dev="IDC_B_FS1"]'); }
  check('서버실-3D: 장비를 누르면 상세가 열리고 연결된 포트가 표시됨', (await page.locator('#r3Detail').isVisible()) && (await page.locator('#r3Detail .pt.u').count()) >= 8 && (await page.locator('#r3Detail').innerText()).includes('IDC_B_FS1'));
  check('서버실-3D: 광케이블(선)과 이상 포트(빨강)가 그려짐', (await page.locator('#r3Detail svg path').count()) >= 8 && (await page.locator('#r3Detail .pt.x').count()) >= 1);
  await page.click('#r3Detail .pt.x >> nth=0');
  check('서버실-3D: 포트를 누르면 그 케이블의 상대 장비 표시가 강조됨', (await page.locator('#r3Detail .ctag.sel').count()) === 1);
  const [p3] = await Promise.all([ctx.waitForEvent('page'), page.click('#r3DTerm')]);
  await p3.waitForLoadState('load');
  check('서버실-3D: 상세에서 터미널 열기', (await p3.locator('#termTarget').innerText()).includes('IDC_B_FS1'));
  await p3.close();
  await page.keyboard.press('Escape');
  check('서버실-3D: Esc로 상세가 닫힘', !(await page.locator('#r3Detail').isVisible()));
  await page.click('[data-tab=monitor]');
  const barMon = await page.locator('#centerBar').innerText();
  await page.click('[data-tab=room]');
  const barRoom = await page.locator('#centerBar').innerText();
  check('센터 버튼 옆의 숫자: 관제에는 없고 서버실에서만 "랙 · 장비" 수가 보임', !/\d/.test(barMon) && /랙 10 · 장비 22/.test(barRoom) && /랙 44 · 장비 120/.test(barRoom), barRoom.replace(/\n/g, ' '));
  const expectBy = await page.evaluate(() => Object.fromEntries(Object.keys(TOPOLOGY.centers).map(c => [c, {
    panels: DATA.links.filter(l => l.id.split('_')[1] === c).map(l => l.id).sort(),
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
    const allCode = [...panels, ...racks, ...devs].every(id => id.split('_')[1] === code);
    check(`센터 ${code}: 관제 그래프 ${panels.length}와 서버실 랙 ${racks.length}(장비 ${devs.length})가 같은 센터 소속이고 설계도·데이터와 일치`,
      same(panels, e.panels) && same(racks, e.racks) && same(devs, e.devs) && allCode,
      `그래프 ${same(panels, e.panels)}, 랙 ${same(racks, e.racks)}, 이름 ${allCode}`);
  }
  // 터미널은 센터 선택과 상관없이 전체 장비를 보여 준다
  await page.click('[data-tab=monitor]'); await page.click('#centerBar [data-center=S]');
  await page.click('[data-tab=term]');
  const devCount = await page.locator('#devTbl tr.click').count();
  check('터미널·설계도는 센터 선택과 상관없이 전체 장비를 보여 줌 (서초를 골라도 120대)', devCount === (await page.evaluate(() => TOPOLOGY.devices.length)) && devCount === 120, String(devCount));
  // 고객사 13곳, 모든 회선에 고객사가 있고, 제목은 길면 줄여서 보인다
  const cust = await page.evaluate(() => ({ n: CUSTOMERS.length, keys: new Set(CUSTOMERS.map(c => c.key)).size, bad: CUSTOMERS.flatMap(c => c.links).filter(id => !LINK[id]), none: LINKS.filter(l => custOf(l.id).length === 0).map(l => l.id) }));
  check('고객사 13곳(가상), 이름·키 중복 없음, 존재하지 않는 회선 없음, 고객사가 없는 회선 없음', cust.n === 13 && cust.keys === 13 && cust.bad.length === 0 && cust.none.length === 0, JSON.stringify(cust));
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
  check('센터 선택(구로)이 새로고침 후에도 유지됨', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'G' && (await page.locator('.panel:visible').count()) === 1);
  await page.click('#centerBar [data-center=ALL]');
  check('전체를 고르면 그래프 8개가 모두 보임', (await page.locator('.panel:visible').count()) === 8);

  // 시나리오 4가지: 시간이 흘러가고, 단계(감지·확인·조치·결과)가 나오고, 닫으면 현재로 돌아온다
  const scenarios = [['calm', '평일 오후 7시', 4, ['그래프 8개 확인', '서버실 확인', '이상 없음']], ['drop', '트래픽 급감', 6, ['급감', 'IDC_B_FS2_INTL1', '광값', '예시미디어', '회복']],
    ['surge', '트래픽 폭주', 7, ['사전 연락', '분산', '하이드레이션', '경고선 80%', '사후 정리', '[사전 안내]']], ['temp', '서버실 온도 변화', 7, ['온도 경고', '빨강 깜박임', '터미널', '냉각 복구', '-40.00 dBm']]];
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
  check('채워 둔 명령이 실행됨 (광 정보 출력)', (await pop.locator('#termOut').innerText()).includes('Receiver signal'));
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
  check('Huawei 명령 출력', /RX Power|CRC/.test(await page.locator('#termOut').innerText()));
  await page.selectOption('#vendorSel', 'juniper');
  await page.click('#qcmd button');
  await page.press('#termIn', 'Enter');
  check('터미널 명령 출력', (await page.locator('#termOut').innerText()).includes('Receiver signal'));

  check('콘솔·페이지 오류 없음', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})();
