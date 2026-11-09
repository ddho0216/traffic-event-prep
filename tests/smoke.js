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
  const goTab = t => page.evaluate(x => document.querySelector(`#tabs button[data-tab="${x}"]`).click(), t);   // 하위 메뉴(마우스를 올려야 보임)에 있는 탭도 직접 누른다
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  const goTo = async (iso, win) => { if (win) await page.evaluate(w => { state.win = w; }, win); await page.fill('#endTime', iso); await page.press('#endTime', 'Tab'); await page.waitForTimeout(150); };
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

  check('관제 탭에서 고객사·창·Y축 선택은 없앴고, 시나리오 버튼은 실시간 대응 화면으로 옮겼고 전체 CSV 버튼은 그대로 있음', (await page.locator('#cust, #win, #ymode').count()) === 0 && (await page.locator('#tab-live #scnBtn').count()) === 1 && (await page.locator('#tab-monitor #scnBtn').count()) === 0 && (await page.locator('#csvAll').isVisible()));
  check('관제 첫 화면에는 경고 이력·내 업무 칸이 없고 모니터만 있음', (await page.locator('#tab-monitor #alertTbl').count()) === 0 && (await page.locator('#tab-monitor #taskTbl').count()) === 0 && !(await page.locator('#alertTbl').isVisible()));
  check('종 아이콘이 있고 확인 필요 건수가 4로 뜸 (경고 3 + 온도 1)', (await page.locator('#bell').isVisible()) && (await page.locator('#bellN').innerText()) === '4');
  await page.click('#bell');
  const alertText = await page.locator('#alertTbl').innerText();
  check('종을 누르면 알림이 열리고, 기본은 확인 필요만 보임 (급감·온도 경고 포함, 경기 겹침은 숨김)', (await page.locator('#notif').isVisible()) && alertText.includes('급감') && alertText.includes('온도 경고') && !alertText.includes('월드컵'));
  await page.check('#showAllAlerts');
  check('"경기와 겹치는 알림도 보기"를 켜면 월드컵 알림이 나타남', (await page.locator('#alertTbl').innerText()).includes('월드컵'));
  await page.uncheck('#showAllAlerts');
  await page.click('[data-np=tasks]');
  check('내 업무 탭에 업무 목록이 있음', (await page.locator('#taskTbl').innerText()).includes('월간·주간 자료 발송'));
  await page.keyboard.press('Escape');
  check('Esc로 알림이 닫힘', !(await page.locator('#notif').isVisible()));
  await goTab('room');
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
  check('현재로 버튼: 가상 현재(10/22 21:00), 1시간 창으로 돌아옴', (await page.locator('#endTime').inputValue()) === '2026-10-22T21:00' && (await page.evaluate(() => state.win)) === 12);
  for (const w of [1366, 1280]) {   // 폭이 좁아져도 위쪽 도구줄이 한 줄을 유지하는가
    await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
    const spread = await page.evaluate(() => { const ys = [...document.querySelectorAll('#tab-monitor .toolbar > *')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); return Math.max(...ys) - Math.min(...ys); });
    check(`폭 ${w}px에서 위쪽 도구줄이 한 줄`, spread < 14, `높이 차 ${spread.toFixed(0)}px`);
  }
  await page.setViewportSize({ width: 1600, height: 900 });

  // 탭 순서와 센터 선택: 센터 선택은 관제·서버실에서만 보이고, 두 화면이 같은 센터로 동기화된다
  check('위 메뉴: 관제 / 서버실▾ / 장비 터미널 / 이벤트 대비 / 월간 자료 / 고객 지원▾ (하위 메뉴: 서버실·서버실 3D / 문자 전파·방문 신청·장비 반출입)', JSON.stringify(await page.locator('#tabs > button, #tabs > .tabgrp > .grpbtn').allTextContents()) === JSON.stringify(['관제', '서버실', '장비 터미널', '실시간 대응 시험판', '이벤트 대비', '월간 자료', '고객 지원']) && JSON.stringify(await page.locator('#tabs .tabgrp:nth-of-type(1) .submenu button').allTextContents()) === JSON.stringify(['서버실', '서버실 3D']) && JSON.stringify(await page.locator('#tabs .tabgrp .submenu button').allTextContents()) === JSON.stringify(['서버실', '서버실 3D', '문자 전파', '방문 신청', '장비 반출입']));
  const sub0 = await page.locator('#tabs .tabgrp >> nth=1 >> .submenu').isVisible();
  await page.hover('#tabs .tabgrp >> nth=1 >> .grpbtn');
  const sub1 = await page.locator('#tabs .tabgrp >> nth=1 >> .submenu').isVisible();
  await page.hover('#tabs .tabgrp >> nth=0 >> .grpbtn');
  await page.waitForTimeout(350);   // 하위 메뉴가 부드럽게 사라지는 시간
  const sub2 = [await page.locator('#tabs .tabgrp >> nth=0 >> .submenu').isVisible(), await page.locator('#tabs .tabgrp >> nth=1 >> .submenu').isVisible()];
  check('하위 메뉴는 평소에 숨겨져 있고, 마우스를 올리면 그 메뉴 아래에만 펼쳐짐', !sub0 && sub1 && sub2[0] && !sub2[1], JSON.stringify([sub0, sub1, sub2]));
  await page.hover('#tabs .tabgrp >> nth=1 >> .grpbtn');
  await page.click('#tabs .tabgrp >> nth=1 >> .submenu button[data-tab=gear]');
  check('고객 지원 하위 메뉴에서 장비 반출입을 누르면 그 화면이 열리고 위 메뉴(고객 지원)가 강조됨', (await page.locator('#tab-gear').isVisible()) && (await page.evaluate(() => document.querySelectorAll('#tabs .tabgrp')[1].classList.contains('on'))));
  // 문자 전파: 단계별 양식 → 초안 수정 → 휴대폰 미리보기
  await goTab('sms');
  const sm0 = await page.inputValue('#smDraft');
  check('문자 전파: 발생 양식이 채워져 있고 [TEP IDC]·[Web발신]·[주의_센터_발생] 순서임', /^\[TEP IDC\]\n\[Web발신\]\n\[주의_.+_발생\] /.test(sm0) && sm0.includes('■ 서비스영향 : 파악중') && !sm0.includes('■ 조치') && !(await page.locator('#smToRow').isVisible()));
  await page.click('#smStage [data-st=완료]');
  const sm1 = await page.inputValue('#smDraft');
  check('완료를 고르면 끝 일시·조치 입력칸이 나오고 문자에 시작~끝 일시와 조치 시간표가 들어감', (await page.locator('#smToRow').isVisible()) && /■ 일시 : \S+ \S+ ~ \S+ \S+/.test(sm1) && /■ 조치 :\n\d\d:\d\d /.test(sm1) && sm1.includes('[주의_') && sm1.includes('_완료]'));
  await page.fill('#smTitle', '회선 3개 다운');
  check('입력칸을 고치면 초안이 바로 바뀜', (await page.inputValue('#smDraft')).includes('회선 3개 다운'));
  await page.fill('#smDraft', (await page.inputValue('#smDraft')) + '\n(직접 고쳐 쓴 줄)');
  await page.click('#smPhone');
  const ph = await page.evaluate(() => ({ vis: !document.getElementById('phone').hidden, txt: document.getElementById('phBody').innerText, br: document.querySelectorAll('#phBody .ph-bubble br').length }));
  check('"휴대폰에서 보기": 휴대폰 화면에 초안(직접 고친 줄 포함)이 줄바꿈 그대로 말풍선으로 보임', ph.vis && ph.txt.includes('회선 3개 다운') && ph.txt.includes('(직접 고쳐 쓴 줄)') && ph.br >= 8, String(ph.br));
  await page.keyboard.press('Escape');
  check('Esc로 휴대폰 화면이 닫힘', await page.evaluate(() => document.getElementById('phone').hidden));
  // 장비 반출입: 필수 항목 확인, 저장, 합계, 구분 필터, 삭제
  await goTab('gear');
  const g0 = await page.locator('#gTbl tr.click, #gTbl tr').count();
  check('장비 반출입: 예시 기록(가상)이 표로 보이고 반입·반출 합계가 나옴', g0 >= 5 && /반입 \d+대/.test(await page.locator('#gSum').innerText()) && /반출 \d+대/.test(await page.locator('#gSum').innerText()));
  await page.click('#gSave');
  check('필수 항목을 비우고 저장하면 빠진 항목을 알려 주고 저장하지 않음', (await page.locator('#gMsg').innerText()).includes('빠진 항목') && (await page.locator('#gTbl tr').count()) === g0);
  await page.fill('#gName', 'IDC_B_FS10'); await page.fill('#gModel', '시험용 모델'); await page.fill('#gQty', '3'); await page.fill('#gCompany', '시험업체'); await page.fill('#gMine', '관제담당(가상)');
  await page.check('input[name=gDir][value=반출]');
  await page.click('#gSave');
  const g1 = await page.evaluate(() => ({ rows: document.querySelectorAll('#gTbl tr').length, first: document.querySelector('#gTbl tr:nth-child(2)').innerText, sum: document.getElementById('gSum').innerText }));
  check('저장하면 맨 위에 새 기록(장비 이름·모델명·3대·회사·담당자)이 생기고 합계가 오름', g1.rows === g0 + 1 && ['IDC_B_FS10', '시험용 모델', '3대', '시험업체', '관제담당(가상)', '반출'].every(w => g1.first.includes(w)), g1.first.slice(0, 80).replace(/\s+/g, ' '));
  await page.click('#gFilter [data-f=반입]');
  check('"반입"만 보기를 누르면 반출 기록이 사라짐', (await page.locator('#gTbl tr:has(.tag.warn)').count()) === 0);
  await page.click('#gFilter [data-f=전체]');
  await page.click('#gTbl tr:nth-child(2) [data-del]');
  check('삭제하면 그 기록이 없어짐', (await page.locator('#gTbl tr').count()) === g0);
  const [gcsv] = await Promise.all([page.waitForEvent('download'), page.click('#gCsv')]);
  const gtxt = require('fs').readFileSync(await gcsv.path(), 'utf8');
  check('CSV: 열 제목(일시·구분·장비 이름·모델명·수량·회사·담당자)이 있고 기록 수만큼 행이 있음', gcsv.suggestedFilename() === 'gear_log.csv' && gtxt.includes('일시,구분,장비 이름,모델명,수량,회사') && gtxt.trim().split('\n').length === g0);
  // 실시간 대응(시험판): 목업(mock3-E2)대로 가상 시계가 흐르고, 알림은 3분 늦게 뜨고, 직접 확인·판단·조치한다
  await goTab('live');
  const lv = async () => page.evaluate(() => ({ t: LIVE.state.t, now: document.getElementById('lvNow').textContent, alert: document.getElementById('lvAlert').className, comp: document.getElementById('lvComp').innerText, timer: document.getElementById('lvTimer').innerText, prog: document.getElementById('lvProg').textContent, draft: document.getElementById('lvDraft').value, term: document.getElementById('lvTermOut').textContent, log: document.getElementById('lvLog').innerText }));
  await page.evaluate(() => LIVE.reset(false));
  let L = await lv();
  check('실시간 대응: 시작 전에는 알림이 없고 공격 구성은 "알림을 확인하면 표시"로 가려져 있음, 해야 할 일 0/6', L.alert.includes('idle') && L.comp.includes('알림을 확인하면') && L.prog.includes('0 / 6'));
  await page.evaluate(() => LIVE.jump(22));
  L = await lv();
  check('급증이 시작된 뒤에도(03:22) 알림은 아직 안 뜸: 탐지 지연 3분(눈으로 먼저 알아채는 구간)', !L.alert.includes('hot') && parseFloat(L.now) > 5, L.now + ' ' + L.alert);
  await page.evaluate(() => LIVE.jump(23));
  check('03:23에 빨간 알림 줄이 뜨고 급증 시작 03:20·지연 3분이 적힘', (await page.locator('#lvAlert.hot').isVisible()) && (await page.locator('#lvAlert').innerText()).includes('지연 3분') && (await page.locator('#lvAck').isVisible()));
  check('알림을 확인하기 전에는 조치 버튼이 막혀 있음', await page.locator('#lvTodo [data-a=ev]').isDisabled());
  await page.click('#lvAck');
  L = await lv();
  check('확인하기를 누르면 공격 트래픽 구성(출발지 대역·SYN·443·패킷 크기)이 나타나고 기록에 알림 확인이 남음', L.comp.includes('203.0.113.0/24') && L.comp.includes('TCP SYN') && L.comp.includes('443') && L.log.includes('알림 확인'));
  check('발생 문자 기한 타이머: 알림 후 8분(03:31)까지 남은 시간이 보임', /8:00 남음|7:\d\d 남음/.test(L.timer), L.timer.replace(/\n/g, ' '));
  const draft0 = L.draft;
  check('발생 문자 초안: 공격량(Gbps/Mpps)이 현재 값으로 자동 채워짐, 양식은 [TEP IDC]·[Web발신]·[주의_분당_발생]', /\[주의_분당_발생\]/.test(draft0) && /■ 공격량 : TCP \(6\.\d Gbps \/ 6\.\d Mpps\)/.test(draft0) && draft0.includes('■ 서비스영향 : 파악중'));
  await page.fill('#lvTermIn', 'show interfaces xe-0/0/1 extensive | match "bps|pps"'); await page.press('#lvTermIn', 'Enter');
  await page.fill('#lvTermIn', 'show route 198.51.100.77'); await page.press('#lvTermIn', 'Enter');
  await page.fill('#lvTermIn', '엉뚱한 명령'); await page.press('#lvTermIn', 'Enter');
  L = await lv();
  check('터미널: 속도 확인은 가상 시각의 bps/pps, 경로 확인은 BGP 경로, 모르는 명령은 거절', /Input rate +: \d{9,} bps \(\d{6,} pps\)/.test(L.term) && L.term.includes('[BGP/170]') && L.term.includes('unknown command'));
  await page.click('#lvTodo [data-a=ev]'); await page.click('#lvTodo [data-a=ip]');
  await page.click('#lvTodo [data-a=clean]');
  check('클린존 우회를 누르면 미가입이라 불가라고 알려 주고 차단 방법 단계는 그대로 남음', (await page.locator('#lvSendMsg').innerText()).includes('미가입') && (await page.locator('#lvProg').innerText()).includes('2 / 6'));
  await page.click('#lvSave');
  check('"기록에 저장": 저장됨 표시가 나오고 브라우저에 사건 기록이 남음', (await page.locator('#lvSaved').isVisible()) && (await page.evaluate(() => JSON.parse(localStorage.getItem('live:records')).length)) >= 1);
  await page.evaluate(() => LIVE.jump(26));
  await page.click('#lvSend');
  const ph2 = await page.evaluate(() => ({ vis: !document.getElementById('phone').hidden, txt: document.getElementById('phBody').innerText }));
  L = await lv();
  check('발생 문자를 보내면 휴대폰 미리보기가 뜨고, 타이머가 기한 안 발송(알림 후 3분)으로 바뀌고 3번 단계가 끝남', ph2.vis && ph2.txt.includes('[주의_분당_발생]') && L.timer.includes('기한 안') && L.prog.includes('3 / 6'), L.timer.replace(/\n/g, ' '));
  await page.keyboard.press('Escape');
  await page.click('#lvTodo [data-a=bh]');
  await page.click('#lvTodo [data-a=exec]');
  const before = parseFloat((await lv()).now);
  await page.evaluate(() => LIVE.advance(3));
  L = await lv();
  check('블랙홀을 실행하면 몇 분 뒤 그래프의 in이 평소 값으로 떨어지고, 경로가 Discard로 바뀜', before > 8 && parseFloat(L.now) < 5 && (await (async () => { await page.fill('#lvTermIn', 'show route 198.51.100.77'); await page.press('#lvTermIn', 'Enter'); return (await lv()).term.includes('Discard'); })()), `${before} → ${L.now}`);
  await page.click('#lvTodo [data-a=up]');
  L = await lv();
  check('상위 연동망 요청까지 하면 5번 단계 완료, 조치 내용이 내 기록에 남음', L.prog.includes('5 / 6') && L.log.includes('블랙홀 차단') && L.log.includes('65535:666'));
  check('공격이 끝나기 전(03:30)에는 블랙홀로 버려지는 양이 구성 카드에 보임', (await page.locator('#lvCompSub').innerText()).includes('블랙홀로 버려지는 양'));
  // 공격이 끝난 뒤 해제 → 완료 문자 → 결과
  await page.evaluate(() => LIVE.jump(42));
  await page.click('#lvTodo [data-a=rel]');
  await page.evaluate(() => LIVE.advance(3));
  await page.click('#lvStage [data-st=완료]');
  const dn = await page.inputValue('#lvDraft');
  check('완료 문자: 시작~끝 일시, 직접 한 조치 시간표(블랙홀 차단·연동망 요청·해제), 블랙홀 구간이 서비스영향에 적힘', /■ 일시 : 10\/29 03:20 ~ 10\/29 03:4\d/.test(dn) && dn.includes('블랙홀 차단') && dn.includes('65535:666') && dn.includes('블랙홀 해제') && /블랙홀 구간\(03:2\d~03:4\d\)/.test(dn) && dn.includes('_완료]'));
  await page.click('#lvSend');
  await page.keyboard.press('Escape');
  const res = await page.evaluate(() => ({ vis: !document.getElementById('lvResult').hidden, txt: document.getElementById('lvResBody').innerText }));
  check('완료 문자를 보내면 대응 결과가 나옴: 알림→확인·문자·차단 시간, 블랙홀 구간, 클린존 확인 여부, 기록 저장 여부', res.vis && ['알림 → 발생 문자', '기한 8분 안', '알림 → 차단', '블랙홀 구간', '클린존 가입 확인', '확인함', '사건 기록 저장', '발생 → 완료'].every(w => res.txt.includes(w)), res.txt.slice(0, 80).replace(/\n/g, ' '));
  // 너무 일찍 해제하면 공격이 다시 들어온다, 문자를 늦게 보내면 기한 초과
  await page.evaluate(() => LIVE.reset(false));
  await page.evaluate(() => LIVE.jump(25)); await page.click('#lvAck'); await page.click('#lvTodo [data-a=bh]'); await page.click('#lvTodo [data-a=exec]');
  await page.evaluate(() => LIVE.advance(3)); const low = parseFloat((await lv()).now);
  await page.click('#lvTodo [data-a=rel]'); await page.evaluate(() => LIVE.advance(2)); const high = parseFloat((await lv()).now);
  check('공격이 끝나기 전에 블랙홀을 해제하면 그래프의 in이 다시 올라감', low < 5 && high > 8, `${low} → ${high}`);
  await page.evaluate(() => LIVE.reset(false));
  await page.evaluate(() => LIVE.jump(33)); await page.click('#lvAck'); await page.click('#lvSend');
  check('발생 문자를 8분 뒤에 보내면 "기한 초과"로 표시됨', (await lv()).timer.includes('기한 초과'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => LIVE.reset(false));
  // 실시간 대응: 업링크 회선 다운 (사이트의 실제 가상 데이터, 복구 원인은 시작할 때 고름)
  await goTab('live'); await page.click('#scnBtn'); await page.click('#scnMenu [data-scn=liveLinkDown]');
  check('업링크 회선 다운(직접 대응)을 고르면 복구 원인(정답)을 먼저 고르는 창이 뜸', await page.locator('#scnCausePop').isVisible());
  await page.click('[data-ldcause=fiber]');
  const ld0 = await page.evaluate(() => ({ id: LIVE.scenario.id, cause: LIVE.state.cause, title: document.getElementById('lvTitle').textContent, t: LIVE.state.t, vis: !!document.querySelector('#tab-live.on') }));
  check('원인을 고르면 실시간 대응 화면에서 업링크 회선 다운이 시작됨(원인=광 케이블·SFP)', ld0.id === 'linkDown' && ld0.cause === 'fiber' && ld0.title === '업링크 회선 다운' && ld0.vis);
  await page.evaluate(() => LIVE.jump(22));
  check('다운이 시작된 뒤에도(14:22) 알림은 아직 안 뜸 (지연 3분)', !(await page.locator('#lvAlert.hot').count()) && (await lv()).now.startsWith('0.'));
  await page.evaluate(() => LIVE.jump(23));
  check('14:23에 알림이 뜨고 다운 시작 14:20·전날 같은 시각 값과의 비교가 적힘', (await page.locator('#lvAlert.hot').isVisible()) && /다운 시작 14:20/.test(await page.locator('#lvAlert').innerText()) && /지연 3분/.test(await page.locator('#lvAlert').innerText()));
  await page.click('#lvAck');
  await page.click('#lvTodo [data-a=ip]');
  let ldt = (await lv()).term;
  check('회선 설명 확인: 실제 터미널 출력(IDC_A_FS1_UP1이 Admin up / Link down)이 나오고 3번까지 단계가 쌓임', /IDC_A_FS1_UP1 -> IDC_S_FS1/.test(ldt) && /xe-0\/0\/0\s+up\s+down/.test(ldt));
  await page.click('#lvTodo [data-a=tr]'); await page.click('#lvTodo [data-a=opt]'); await page.click('#lvTodo [data-a=ping]');
  ldt = (await lv()).term;
  check('광값은 -40 dBm(빛 없음), ARP 없음, ping 100% 손실이 터미널에 나옴', /-40\.00 dBm/.test(ldt) && /100% packet loss/.test(ldt));
  check('문의를 하기 전에는 원인 판단 버튼이 막혀 있음', await page.locator('#lvTodo [data-a=fix]').isDisabled());
  await page.click('#lvTodo [data-a=ask-noc]'); await page.click('#lvTodo [data-a=ask-seg]'); await page.click('#lvTodo [data-a=ask-sec]');
  const card = await page.locator('#lvComp').innerText();
  check('연동망 문의 3가지를 하면 회신이 카드에 나오고(이번 원인은 상대 작업 아님) 영향 고객사가 보임', card.includes('예시미디어') && (card.match(/없음/g) || []).length >= 3 && !card.includes('아직 문의 안 함'));
  await page.click('#lvSend');
  await page.keyboard.press('Escape');
  check('발생 문자를 보내면 3번 단계가 끝나고 기한 안 발송으로 표시됨', (await lv()).timer.includes('기한 안'));
  check('복구되기 전에는 "복구 확인" 버튼이 막혀 있음', await page.locator('#lvTodo [data-a=rec]').isDisabled());
  await page.click('#lvTodo [data-a=fix]');
  await page.evaluate(() => LIVE.jump(51));
  check('14:50에 그래프가 돌아오고 알림 줄이 "복구됨"으로 바뀜', (await page.locator('#lvAlert.ok').isVisible()) && parseFloat((await lv()).now) > 10);
  await page.click('#lvTodo [data-a=rec]');
  await page.click('#lvStage [data-st=완료]');
  const ldn = await page.inputValue('#lvDraft');
  check('완료 문자: 원인(광 케이블·SFP 불량), 조치(문의·교체 요청·복구 확인) 시간표, 시작~끝 일시가 직접 한 일대로 들어감', /\[주의_안산_완료\]/.test(ldn) && ldn.includes('광 케이블·SFP 불량') && ldn.includes('현장에 광 케이블·SFP 교체 요청') && ldn.includes('회선 복구 확인') && /■ 일시 : 10\/21 14:20 ~ 10\/21 14:5\d/.test(ldn));
  await page.click('#lvSend'); await page.keyboard.press('Escape');
  const ldr = await page.locator('#lvResBody').innerText();
  check('끝나면 결과: 실제 원인(광 케이블·SFP 고장), 내 조치가 맞았는지, 다운 구간, 문자 순서가 나옴', ldr.includes('광 케이블·SFP 고장') && ldr.includes('현장 교체 요청 (맞음)') && ldr.includes('14:20 ~ 14:40') && ldr.includes('발생 → 완료'), ldr.replace(/\s+/g, ' ').slice(0, 100));
  await page.evaluate(() => LIVE.load('linkDown', { cause: 'work' }));
  await page.evaluate(() => LIVE.jump(26)); await page.click('#lvAck'); await page.click('#lvTodo [data-a=ask-noc]'); await page.click('#lvTodo [data-a=ask-seg]'); await page.click('#lvTodo [data-a=ask-sec]');
  check('원인이 상대 구간 작업이면 NOC 문의 회신에 상대 센터 작업과 사전 공지 누락이 나옴', (await page.locator('#lvComp').innerText()).includes('사전 공지가 빠졌'));
  await page.click('#lvTodo [data-a=fix]'); await page.evaluate(() => LIVE.jump(51)); await page.click('#lvTodo [data-a=rec]');
  await page.click('#lvStage [data-st=완료]'); await page.click('#lvSend'); await page.keyboard.press('Escape');
  check('상대 작업이 원인인데 현장 교체를 요청하면 결과에 "불필요했음"으로 나옴', (await page.locator('#lvResBody').innerText()).includes('이번에는 불필요했음'));
  await page.evaluate(() => LIVE.load('ddos'));
  // 실시간 대응: 트래픽 급감 (국내 연동 IX, 사이트의 실제 가상 데이터)
  await goTab('live'); await page.click('#scnBtn'); await page.click('#scnMenu [data-scn=liveDrop]');
  check('트래픽 급감(직접 대응)을 고르면 실시간 대응 화면에서 바로 시작됨', (await page.evaluate(() => LIVE.scenario.id)) === 'drop' && (await page.locator('#lvTitle').innerText()) === '트래픽 급감' && (await page.evaluate(() => LIVE.state.t)) === 10);
  await page.evaluate(() => LIVE.jump(22));
  check('급감이 시작된 뒤에도(20:12) 알림은 아직 안 뜸 (지연 3분)', !(await page.locator('#lvAlert.hot').count()));
  await page.evaluate(() => LIVE.jump(23));
  const dal = await page.locator('#lvAlert').innerText();
  check('20:13에 알림이 뜨고 급감 시작 20:10, 전날 같은 시각 값과 평소 대비 %가 적힘', (await page.locator('#lvAlert.hot').isVisible()) && /급감 시작 20:10/.test(dal) && /지연 3분/.test(dal) && /평소의 \d+%/.test(dal), dal.replace(/\n/g, ' ').slice(0, 90));
  await page.click('#lvAck');
  check('알림을 확인하면 우회 회선(해외 연동)과 영향 고객사가 카드에 보임', (await page.locator('#lvComp').innerText()).includes('IDC_B_FS2_INTL1') && (await page.locator('#lvComp').innerText()).includes('예시미디어'));
  await page.click('#lvTodo [data-a=ev]'); await page.click('#lvTodo [data-a=tr]'); await page.click('#lvTodo [data-a=intl]');
  await page.click('#lvTodo [data-a=opt]');
  const dt = (await lv()).term;
  check('우리 쪽 광값은 정상 범위(-3 dBm대)로 나오고 터미널에 CRC 명령도 실행됨', /-3\.\d\d dBm/.test(dt) && dt.includes('match CRC'));
  check('문의를 하기 전에는 고객사 안내 버튼이 막혀 있음', await page.locator('#lvTodo [data-a=notice]').isDisabled());
  await page.click('#lvTodo [data-a=ask-noc]'); await page.click('#lvTodo [data-a=ask-seg]'); await page.click('#lvTodo [data-a=ask-sec]');
  check('상대 IX 사업자에 3가지를 문의하면 회신이 카드에 나옴(장비 이상 복구 중)', (await page.locator('#lvComp').innerText()).includes('장비 이상'));
  await page.click('#lvTodo [data-a=notice]');
  await page.click('#lvSend'); await page.keyboard.press('Escape');
  const dsm = await page.inputValue('#lvDraft');
  check('발생 문자: [주의_분당_발생] 국내 연동(IX) 트래픽 급감, 영향은 "해외 연동으로 일부 우회 중(확인 중)"', /\[주의_분당_발생\] 국내 연동\(IX\) 트래픽 급감/.test(dsm) && dsm.includes('해외 연동 회선으로 일부 우회 중'));
  check('회복되기 전에는 "회복 확인" 버튼이 막혀 있음', await page.locator('#lvTodo [data-a=rec]').isDisabled());
  await page.evaluate(() => LIVE.jump(60));
  check('회복 시각이 지나면 그래프가 돌아오고 알림 줄이 "회복됨"으로 바뀜 (대기 시간은 실제 구간의 2/3로 줄임)', (await page.locator('#lvAlert.ok').isVisible()) && parseFloat((await lv()).now) > 20);
  await page.click('#lvTodo [data-a=rec]');
  await page.click('#lvStage [data-st=완료]');
  const ddn = await page.inputValue('#lvDraft');
  check('완료 문자: 원인(상대 IX 사업자 장비 이상), 직접 한 조치(문의·고객사 안내·회복 확인)가 시간표로 들어감', ddn.includes('_완료]') && ddn.includes('상대 IX 사업자 장비 이상') && ddn.includes('고객사') && ddn.includes('회복 확인') && ddn.includes('NOC 작업'));
  await page.click('#lvSend'); await page.keyboard.press('Escape');
  const drr = await page.locator('#lvResBody').innerText();
  check('끝나면 결과: 경기 일정 확인, 우회 확인, 광값 확인, 문의 3가지, 고객사 안내, 급감 구간, 문자 순서', ['경기 일정 확인', '함 (급감과 경기 하락을 구분)', '우회 확인', '우리 쪽 광값 확인', '모두 함', '고객사 안내', '급감 구간', '발생 → 완료'].every(w => drr.includes(w)), drr.replace(/\s+/g, ' ').slice(0, 90));
  await page.evaluate(() => LIVE.load('ddos'));
  // 실시간 대응: 이중화로 무사히 넘기기 (장비 한 대가 꺼져도 짝 장비가 받는다)
  await goTab('live'); await page.click('#scnBtn'); await page.click('#scnMenu [data-scn=liveRedundancy]');
  check('이중화(직접 대응)를 고르면 실시간 대응 화면에서 시작되고, 장비 전환 버튼(꺼진 장비·짝 장비)이 터미널에 있음', (await page.evaluate(() => LIVE.scenario.id)) === 'redundancy' && (await page.locator('#lvQ [data-dev]').count()) === 2);
  await page.evaluate(() => LIVE.jump(32));
  check('장비가 꺼진 뒤에도(03:10 직후) 알림은 아직 안 뜸', !(await page.locator('#lvAlert.hot').count()));
  await page.evaluate(() => LIVE.jump(33));
  const ral = await page.locator('#lvAlert').innerText();
  check('3분 뒤 "응답 없음(전원 꺼짐 의심)" 알림이 뜨고, 그래프(고객 회선 트래픽)는 거의 그대로임', (await page.locator('#lvAlert.hot').isVisible()) && ral.includes('IDC_B_FS7') && ral.includes('지연 3분') && parseFloat((await lv()).now) > 1);
  await page.click('#lvAck');
  check('알림을 확인하면 짝 장비 카드에 서로 다른 랙·꺼짐/정상·짝 연결 상태가 보임', await page.evaluate(() => { const t = document.getElementById('lvComp').innerText; return t.includes('IDC_B_FS7') && t.includes('IDC_B_FS8') && t.includes('꺼짐') && t.includes('PAIR1'); }));
  await page.click('#lvTodo [data-a=ip]');
  check('꺼진 장비에 접속을 시도하면 접속 안 됨(응답 없음)으로 나오고, 터미널 장비가 FS7로 바뀜', ((await lv()).term).includes('Connection timed out') && (await page.locator('#lvPrompt').innerText()).includes('IDC_B_FS7'));
  await page.click('#lvTodo [data-a=partner]');
  const rt2 = (await lv()).term;
  check('짝 장비(FS8) 터미널로 바뀌고, 고객 회선 목록이 Up으로 나옴', (await page.locator('#lvPrompt').innerText()).includes('IDC_B_FS8') && (rt2.match(/\bup\s+up\b/g) || []).length >= 5);
  await page.click('#lvTodo [data-a=tr]');
  check('트래픽 비교: 꺼지기 5분 전 → 5분 뒤 변화율(%)이 기록에 남음', /\(-?\d+\.\d%\)/.test((await lv()).log));
  check('발생 문자 전에는 복구 확인·전체 확인 버튼이 막혀 있음', (await page.locator('#lvTodo [data-a=rec]').isDisabled()) && (await page.locator('#lvTodo [data-a=all]').isDisabled()));
  await page.click('#lvSend'); await page.keyboard.press('Escape');
  const rsm = await page.inputValue('#lvDraft');
  check('발생 문자: 고객 영향 없음 + 짝 장비가 같은 회선을 받고 있음이 서비스영향에 적힘', /\[주의_분당_발생\] IDC_B_FS7 장비 전원 꺼짐 \(고객 영향 없음\)/.test(rsm) && rsm.includes('없음 (짝 장비 IDC_B_FS8에서 같은 고객 회선을 받고 있음)'));
  await page.click('#lvTodo [data-a=report]'); await page.click('#lvTodo [data-a=watch]');
  check('짝 장비 ping이 정상(0% 손실)으로 나옴', /0% packet loss/.test((await lv()).term));
  await page.evaluate(() => LIVE.jump(58));
  check('전원이 돌아오면(복구 직후) 알림 줄이 노란색 "전원 복구, 이중화 복귀 확인"으로 바뀜', (await page.locator('#lvAlert.warn').isVisible()) && (await page.locator('#lvAlert').innerText()).includes('전원 복구'));
  await page.click('#lvTodo [data-a=rec]');
  check('복구 직후에는 전체 정상 확인 버튼이 아직 막혀 있고, 완료 문자도 보낼 수 없음(경과로 알리는 단계)', (await page.locator('#lvTodo [data-a=all]').isDisabled()) && (await page.locator('#lvStage [data-st=완료]').isDisabled()) && !(await page.locator('#lvStage [data-st=경과]').isDisabled()));
  await page.click('#lvStage [data-st=경과]'); await page.click('#lvSend'); await page.keyboard.press('Escape');
  await page.evaluate(() => LIVE.jump(62));
  await page.click('#lvTodo [data-a=all]');
  await page.click('#lvStage [data-st=완료]');
  const rdn = await page.inputValue('#lvDraft');
  check('완료 문자: 이중화로 고객 영향 없이 복구, 직접 한 조치(짝 장비 확인·보고·복구 확인·전체 정상)가 시간표로 들어감', rdn.includes('_완료]') && rdn.includes('이중화로 고객 영향 없이 복구') && rdn.includes('짝 장비 IDC_B_FS8 확인') && rdn.includes('전체 상태 정상 확인') && rdn.includes('전원 모듈 교체 요청'));
  await page.click('#lvSend'); await page.keyboard.press('Escape');
  const rrs = await page.locator('#lvResBody').innerText();
  check('끝나면 결과: 이중화가 없었다면 고객사·회선 수·합계 Gbps가 끊겼을 것(가정), 문자 순서 발생 → 경과 → 완료', rrs.includes('이중화가 없었다면') && /회선 \d+개\(합계 \d+G\)/.test(rrs) && rrs.includes('발생 → 경과 → 완료'), rrs.replace(/\s+/g, ' ').slice(0, 80));
  await page.evaluate(() => LIVE.load('redundancy'));
  await page.evaluate(() => LIVE.jump(34)); await page.click('#lvAck'); await page.click('#lvSend'); await page.keyboard.press('Escape');
  await page.evaluate(() => LIVE.jump(58)); await page.click('#lvTodo [data-a=rec]'); await page.evaluate(() => LIVE.jump(62)); await page.click('#lvTodo [data-a=all]');
  await page.click('#lvStage [data-st=완료]'); await page.click('#lvSend'); await page.keyboard.press('Escape');
  check('경과 문자를 건너뛰고 완료로 보내면 결과에 "복구 직후에는 경과로 먼저 알립니다"로 나옴', (await page.locator('#lvResBody').innerText()).includes("복구 직후에는 '경과'로 먼저 알립니다"));
  await page.evaluate(() => LIVE.load('ddos'));
  // 시나리오 목록은 실시간 대응 화면에 있다: 직접 대응(실시간) 4개
  await goTab('live'); await page.click('#scnBtn');
  const menuIds = await page.evaluate(() => [...document.querySelectorAll('#scnMenu [data-scn]')].map(b => b.dataset.scn));
  check('실시간 대응 화면의 시나리오 목록: 직접 대응 4개(DDoS·회선 다운·급감·이중화)만 있음 (슬라이드 방식과 평일 오후 7시·폭주·서버실 온도는 뺌, 기록은 docs/removed-scenarios.md)', JSON.stringify(menuIds) === JSON.stringify(['live', 'liveLinkDown', 'liveDrop', 'liveRedundancy']), menuIds.join(','));
  await goTab('monitor'); await goTab('live'); await page.click('#scnBtn'); await page.click('#scnMenu [data-scn=live]');
  check('목록에서 "직접 대응"을 고르면 실시간 대응이 처음 상태(03:15)로 시작함', (await page.locator('#tab-live').isVisible()) && (await page.evaluate(() => LIVE.state.t)) === 15);
  await page.evaluate(() => document.querySelector('#tabs button[data-tab=room3d]').click());
  check('서버실-3D 범례: 짧게 정상/주의/경고/위험과 기준 온도(27·30·33°C)가 보이고, 설명은 접혀 있음', await page.evaluate(() => { const t = document.querySelector('.r3legend').innerText; return ['정상', '주의', '경고', '위험', '27°C', '30°C', '33°C'].every(w => t.includes(w)) && document.getElementById('glLegTip').hidden; }));
  await page.click('#glLegQ');
  check('"? 색 설명"을 누르면 풀어쓴 설명(가장 나쁜 것 기준, 팬 경고·장비 꺼짐, 온도 보기 색)이 펼쳐지고 다시 누르면 접힘', (await page.evaluate(() => { const tip = document.getElementById('glLegTip'); return !tip.hidden && ['가장 나쁜 것', '팬 경고', '장비 꺼짐', '온도" 보기', '파랑(20°C 이하)'].every(w => tip.innerText.includes(w)); })) && (await page.evaluate(() => { document.getElementById('glLegQ').click(); return document.getElementById('glLegTip').hidden; })));
  const vis = {};
  for (const tab of ['monitor', 'room', 'room3d', 'term', 'event', 'monthly', 'visit', 'sms', 'gear', 'live']) { await goTab(tab); vis[tab] = await page.locator('#centerBar').isVisible(); }
  check('센터 선택은 관제·서버실에서만 보이고 나머지 탭에서는 숨겨짐', vis.monitor && vis.room && vis.room3d && !vis.term && !vis.event && !vis.monthly && !vis.visit && !vis.sms && !vis.gear && !vis.live, JSON.stringify(vis));
  // 서버실-3D (WebGL): 랙 8개 정면, 목록·상세·아래 영역 연동, 장비 클릭, 확대/축소, 드래그
  await goTab('room3d');
  await page.click('#centerBar [data-center=ALL]');
  await page.waitForFunction(() => window.THREE && document.querySelectorAll('#glList .gli').length > 0, null, { timeout: 15000 });
  check('서버실-3D: 전체 보기 왼쪽 목록에 랙 46개', (await page.locator('#glList .gli').count()) === 46, await page.locator('#glList .gli').count());
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
  const flyDone = () => page.waitForFunction(() => !G.fly, null, { timeout: 5000 });
  const cv0 = () => cvBox;
  const cvBox = await page.locator('#glCanvas').boundingBox();
  await page.click('#glFit'); await flyDone();
  const fitDist = await page.evaluate(() => G.cs.dist);
  await page.click('#glList .gli[data-rack="IDC_S_R03"]'); await flyDone();
  const zoomed = await page.evaluate(() => ({ dist: G.cs.dist, tx: G.cs.tx, rackIdx: G.rowRacks.findIndex(r => r.id === 'IDC_S_R03') }));
  check('서버실-3D: 랙을 누르면 그 랙으로 확대됨 (카메라가 가까워지고 그 랙 쪽으로 이동)', zoomed.dist < fitDist - 0.4 && Math.abs(zoomed.tx - zoomed.rackIdx * 0.67) < 0.05, JSON.stringify({ fitDist, ...zoomed }));
  await page.mouse.move(cv0().x + 300, cv0().y + 300);
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
  // 확대한 장비의 칸(모듈·포트 묶음) 선택 → 그 칸의 포트·광케이블 자세히 보기
  await flyDone();
  const slotSpot = key => page.evaluate(k => {
    const m = G.ray.find(o => o.userData.kind === 'cisco'), u = m.userData, sl = slotsOf('cisco', u.u, portPlan(DEV[u.id])).find(x => x.key === k), P = m.geometry.parameters;
    const v = new THREE.Vector3((sl.x + sl.w / 2) / 640 * P.width - P.width / 2, m.position.y + P.height / 2 - (sl.y + sl.h / 2) / (u.u * 40) * P.height, m.position.z + P.depth / 2);
    m.parent.localToWorld(v); v.project(G.cam); const r = G.r.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, key);
  check('칸 계산: Cisco는 I/O 8 + SUP 2 + 전원부, Juniper·Huawei는 포트 묶음이 포트 전체를 빈틈없이 덮음', await page.evaluate(() => {
    const cs = slotsOf('cisco', 14, portPlan(DEV[TOPOLOGY.devices.find(d => d.vendor === 'cisco').id])), ok = cs.filter(x => x.type === 'io' || x.type === 'empty').length === 8 && cs.filter(x => x.type === 'sup').length === 2 && cs.filter(x => x.type === 'psu').length === 1;
    return ['juniper', 'huawei'].every(v => { const d = DEV[TOPOLOGY.devices.find(x => x.vendor === v).id], pl = portPlan(d), g = slotsOf(v, v === 'juniper' ? 6 : 2, pl); let at = 0; return g.every(x => { const o = x.ports[0] === at; at = x.ports[1]; return o; }) && at === pl.total; }) && ok;
  }));
  await page.mouse.click((await slotSpot('io2')).x, (await slotSpot('io2')).y);
  const sb = await page.evaluate(() => ({ slot: G.slot && G.slot.label, box: document.getElementById('glDetail').innerText, btn: !!document.getElementById('glSlotPorts') }));
  check('확대한 장비의 칸(I/O 2)을 누르면 오른쪽에 "선택한 칸: I/O 2"와 설명, "이 칸의 포트·광케이블 자세히 보기" 버튼이 나옴', sb.slot === 'I/O 2' && sb.box.includes('선택한 칸: I/O 2') && sb.box.includes('포트 12~23') && sb.btn, JSON.stringify([sb.slot, sb.btn]));
  await page.click('#glSlotPorts');
  const sd = await page.evaluate(() => ({ vis: !document.getElementById('r3Detail').hidden, head: document.querySelector('#r3DBody .dhd').innerText, rows: document.querySelectorAll('#r3DBody table tr[data-i]').length, dim: document.querySelectorAll('#r3DBody .pt.dim').length, all: document.querySelectorAll('#r3DBody .pt').length }));
  check('버튼을 누르면 포트·광케이블 자세히 창이 열리고 "칸: I/O 2" 표시, 표에는 그 칸의 포트(최대 12개)만 나오고 나머지 포트는 흐리게 보임', sd.vis && sd.head.includes('칸: I/O 2') && sd.rows > 0 && sd.rows <= 12 && sd.dim === sd.all - 12, JSON.stringify(sd));
  await page.click('#r3SlotAll');
  const sa = await page.evaluate(() => ({ rows: document.querySelectorAll('#r3DBody table tr[data-i]').length, dim: document.querySelectorAll('#r3DBody .pt.dim').length, head: document.querySelector('#r3DBody .dhd').innerText }));
  check('"장비 전체 보기"를 누르면 모든 포트가 다시 나옴', sa.rows > sd.rows && sa.dim === 0 && !sa.head.includes('칸:'));
  await page.click('#r3DClose');
  await page.mouse.click((await slotSpot('sup1')).x, (await slotSpot('sup1')).y);
  const sp = await page.evaluate(() => ({ slot: G.slot && G.slot.label, btn: !!document.getElementById('glSlotPorts'), box: document.getElementById('glDetail').innerText }));
  check('슈퍼바이저 칸을 누르면 포트가 없다는 설명만 나오고 포트 버튼은 없음', sp.slot === '슈퍼바이저 SUP1' && !sp.btn && sp.box.includes('포트가 없습니다'));
  await page.click('#glSlotClear');
  check('"칸 선택 해제"를 누르면 칸 상자가 사라지고 안내 문구로 돌아옴', (await page.evaluate(() => G.slot)) === null && (await page.locator('#glDetail').innerText()).includes('한 번 더 앞면의 칸'));
  await page.mouse.click(cv.x + 8, cv.y + 8);
  check('서버실-3D: 빈 곳을 누르면 선택이 풀림', (await page.locator('#glDetail h3').innerText()).includes('요약'));
  // 확대/축소/드래그/정면
  await flyDone();
  const d0 = await page.evaluate(() => G.cs.dist);
  await page.click('#glZoomIn'); const d1 = await page.evaluate(() => G.cs.dist);
  check('서버실-3D: 확대 버튼이 카메라를 가깝게 함', d1 < d0, `${d0} -> ${d1}`);
  await page.click('#glFit'); await flyDone(); check('서버실-3D: 화면 맞춤으로 처음 거리로 돌아옴', Math.abs((await page.evaluate(() => G.cs.dist)) - d0) < 0.05);
  await page.mouse.move(cv.x + 300, cv.y + 300); await page.mouse.down(); await page.mouse.move(cv.x + 420, cv.y + 300, { steps: 5 }); await page.mouse.up();
  const az = await page.evaluate(() => G.cs.az);
  check('서버실-3D: 드래그하면 시점이 회전하고 좌우 70도를 넘지 않음', Math.abs(az) > 5 && Math.abs(az) <= 70, az);
  await page.mouse.move(cv.x + 100, cv.y + 200);
  check('서버실-3D: 마우스를 뗀 뒤에는 시점이 더 바뀌지 않음', (await page.evaluate(() => G.cs.az)) === az);
  await page.click('#glHome'); await flyDone(); check('서버실-3D: 초기 시점 버튼', Math.abs(await page.evaluate(() => G.cs.az)) < 0.01);
  // 사건: 냉각 이상 -> 분당 R07 선택, 위험 표시, 장비 상세에서 포트·광케이블
  await page.click('[data-r3="2026-10-26T16:15"]');
  check('서버실-3D: 장비 꺼짐 버튼은 분당으로 맞추고 IDC_B_R08을 선택', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'B' && (await page.locator('#glDetail h3').innerText()).includes('IDC_B_R08'));
  check('서버실-3D: 목록의 R07이 경고·위험 상태이고 필터에 잡힘', (await page.locator('#glList .gli[data-rack="IDC_B_R08"] .dot.crit').count()) === 1);
  await page.click('#glDevs tr[data-id="IDC_B_FS6"]');
  const t6 = await page.locator('#glDetail').innerText();
  check('서버실-3D: 아래 장비 목록에서 IDC_B_FS6을 누르면 꺼짐 상태·알림이 보임', t6.includes('IDC_B_FS6') && t6.includes('꺼짐') && t6.includes('과열 보호 종료') && t6.includes('터미널은 응답 없음'), t6.slice(0, 80));
  await page.click('[data-glmode=temp]');
  check('서버실-3D: 온도 보기로 바꿀 수 있음', (await page.locator('[data-glmode=temp].on').count()) === 1);
  await page.click('#glPorts');
  check('서버실-3D: 꺼진 장비의 포트·광케이블 창: 전원 꺼짐 표시, 포트는 전부 Down(회색)이라 사용 중(초록)이 없음', (await page.locator('#r3Detail').isVisible()) && (await page.locator('#r3Detail .tag.crit').innerText()).includes('전원 꺼짐') && (await page.locator('#r3Detail .pt.u').count()) === 0 && (await page.locator('#r3Detail .pt.d, #r3Detail .pt.x').count()) >= 10);
  await page.keyboard.press('Escape');
  check('서버실-3D: Esc로 상세 창이 닫힘', !(await page.locator('#r3Detail').isVisible()));
  const [p3] = await Promise.all([ctx.waitForEvent('page'), page.click('#glTerm')]);
  await p3.waitForLoadState('load');
  check('서버실-3D: 오른쪽 상세에서 터미널 열기', (await p3.locator('#termTarget').innerText()).includes('IDC_B_FS6'));
  check('서버실-3D: 꺼진 시각(16:15)에 연 장비 터미널은 응답 없음 (가상 시각이 팝업에 전달됨)', /Connection timed out/.test(await p3.locator('#termOut').innerText()) && (await p3.locator('#termTarget').innerText()).includes('전원 꺼짐'), (await p3.locator('#termTarget').innerText()));
  await p3.close();
  // 조작: 아이패드 같은 터치(두 손가락 확대·이동), 이동/회전 모드, 화면 버튼
  await page.click('#glFit'); await page.waitForFunction(() => !G.fly);
  const touch = await page.evaluate(() => {
    const cv = document.getElementById('glCanvas'), r = cv.getBoundingClientRect(), d0 = G.cs.dist, tx0 = G.cs.tx;
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 21, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', 21, 300, 250); ev('pointerdown', 22, 400, 250); ev('pointermove', 21, 250, 250); ev('pointermove', 22, 450, 250);   // 벌리기: 확대
    const d1 = G.cs.dist; ev('pointerup', 21, 250, 250); ev('pointerup', 22, 450, 250);
    ev('pointerdown', 21, 300, 250); ev('pointerdown', 22, 400, 250); ev('pointermove', 21, 400, 250); ev('pointermove', 22, 500, 250);   // 둘 다 오른쪽으로: 이동
    const tx1 = G.cs.tx; ev('pointerup', 21, 400, 250); ev('pointerup', 22, 500, 250);
    return { d0, d1, tx0, tx1 };
  });
  check('터치: 두 손가락을 벌리면 확대되고, 두 손가락을 같이 움직이면 이동함', touch.d1 < touch.d0 - 0.3 && touch.tx1 !== touch.tx0, JSON.stringify(touch));
  const mode = await page.evaluate(async () => {
    const cv = document.getElementById('glCanvas'), r = cv.getBoundingClientRect(), drag = (x0, x1) => { const ev = (t, x, b) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 31, pointerType: 'touch', clientX: r.left + x, clientY: r.top + 300, bubbles: true, isPrimary: true, buttons: b })); ev('pointerdown', x0, 1); ev('pointermove', x0 + (x1 - x0) / 2, 1); ev('pointermove', x1, 1); ev('pointerup', x1, 0); };
    document.querySelector('[data-gm=pan]').click(); const a = { tx: G.cs.tx, az: G.cs.az }; drag(300, 420); const b = { tx: G.cs.tx, az: G.cs.az };
    document.querySelector('[data-gm=rotate]').click(); drag(300, 420); const c = { tx: G.cs.tx, az: G.cs.az };
    return { a, b, c };
  });
  check('조작 모드: "이동"이면 한 손가락 드래그가 이동(각도 그대로), "회전"이면 각도가 바뀜', mode.b.tx !== mode.a.tx && mode.b.az === mode.a.az && mode.c.az !== mode.b.az, JSON.stringify(mode));
  await page.click('#glFit'); await page.waitForFunction(() => !G.fly);
  const pad0 = await page.evaluate(() => ({ tx: G.cs.tx, az: G.cs.az, dist: G.cs.dist }));
  const hb = async sel => { const bb = await page.locator(sel).boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up(); };
  await hb('[data-pan=right]'); const pad1 = await page.evaluate(() => G.cs.tx);
  await hb('[data-rot="1"]'); const pad2 = await page.evaluate(() => G.cs.az);
  await hb('#glPadIn'); const pad3 = await page.evaluate(() => G.cs.dist);
  check('화면 버튼: 누르고 있으면 이동(→)·회전·확대(+)가 계속 움직임', pad1 > pad0.tx && pad2 !== pad0.az && pad3 < pad0.dist, JSON.stringify({ pad0, pad1, pad2, pad3 }));
  await page.click('#glPadTog');
  check('조작판 접기: 버튼이 숨겨지고 펼치기 버튼만 남음', !(await page.locator('[data-pan=up]').isVisible()) && (await page.locator('#glPadTog').innerText()).includes('펼치기'));
  await page.click('#glPadTog');
  const big = await page.locator('[data-pan=up]').boundingBox();
  check('화면 버튼은 터치하기 쉬운 크기(44px 이상)', big.width >= 44 && big.height >= 44, `${big.width}x${big.height}`);
  await goTab('monitor');
  const barMon = await page.locator('#centerBar').innerText();
  const order = await page.locator('#centerBar .cbtn').evaluateAll(els => els.map(e => e.dataset.center));
  check('센터 순서: 전체 → 서초 → 분당 → 구로 → 안산', JSON.stringify(order) === JSON.stringify(['ALL', 'S', 'B', 'G', 'A']), order.join());
  await page.click('#centerBar [data-center=B]');
  const bPanels = await page.locator('.panel:visible').evaluateAll(els => els.map(e => e.id.replace('p-', '')));
  check('분당 관제에는 분당 회선과 함께 서초에서 들어오는 회선(IDC_S_FS2_TOB1)도 보임', bPanels.includes('IDC_S_FS2_TOB1') && bPanels.includes('IDC_B_FS1_UP1') && !bPanels.includes('IDC_G_FS1_UP1'), bPanels.join());
  await page.click('#centerBar [data-center=S]');
  check('서초 관제에도 그 회선이 보임', (await page.locator('#p-IDC_S_FS2_TOB1:visible').count()) === 1);
  await page.click('#centerBar [data-center=ALL]');
  await goTab('room');
  const barRoom = await page.locator('#centerBar').innerText();
  check('센터 버튼 옆의 숫자: 관제에는 없고 서버실에서만 "랙 · 장비" 수가 보임', !/\d/.test(barMon) && /랙 10 · 장비 22/.test(barRoom) && /랙 46 · 장비 120/.test(barRoom), barRoom.replace(/\n/g, ' '));
  const expectBy = await page.evaluate(() => Object.fromEntries(Object.keys(TOPOLOGY.centers).map(c => [c, {
    panels: DATA.links.filter(l => l.id.split('_')[1] === c || TOPOLOGY.links.some(t => t.link === l.id && t.feeds === c)).map(l => l.id).sort(),
    racks: DATA.racks.filter(r => r.id.split('_')[1] === c).map(r => r.id).sort(),
    devs: TOPOLOGY.devices.filter(d => d.id.split('_')[1] === c).map(d => d.id).sort()
  }])));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const code of ['B', 'S', 'G', 'A']) {
    await goTab('monitor');
    await page.click(`#centerBar [data-center=${code}]`);
    const panels = (await page.locator('.panel:visible').evaluateAll(els => els.map(e => e.id.replace('p-', '')))).sort();
    await goTab('room');
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
  await goTab('monitor'); await page.click('#centerBar [data-center=S]');
  await goTab('term');
  const devCount = await page.locator('#devTbl tr.click').count();
  check('터미널·설계도는 센터 선택과 상관없이 전체 장비를 보여 줌 (서초를 골라도 120대)', devCount === (await page.evaluate(() => TOPOLOGY.devices.length)) && devCount === 120, String(devCount));
  // 고객사 19곳, 모든 회선에 고객사가 있고, 제목은 길면 줄여서 보인다
  const cust = await page.evaluate(() => ({ n: CUSTOMERS.length, keys: new Set(CUSTOMERS.map(c => c.key)).size, bad: CUSTOMERS.flatMap(c => c.links).filter(id => !LINK[id]), none: LINKS.filter(l => custOf(l.id).length === 0).map(l => l.id) }));
  check('고객사 19곳(가상), 이름·키 중복 없음, 존재하지 않는 회선 없음, 고객사가 없는 회선 없음', cust.n === 19 && cust.keys === 19 && cust.bad.length === 0 && cust.none.length === 0, JSON.stringify(cust));
  await goTab('monitor'); await page.click('#centerBar [data-center=ALL]');
  const titles = await page.locator('.panel .hd b').allInnerTexts();
  check('그래프 제목에 "공용"이 없고, 고객사가 3곳 이상이면 "외 N곳"으로 줄여 보임', titles.every(t => !t.includes('공용')) && titles.some(t => /외 \d+곳/.test(t)) && titles.every(t => t.split(' · ').length <= 2 || /외 \d+곳/.test(t)), titles.join(' | '));
  // 서초를 보다가 "냉각 이상" 버튼을 누르면 사건이 있는 분당으로 센터가 맞춰진다
  await page.click('#centerBar [data-center=S]');
  await goTab('room');
  await page.click('[data-sr="2026-10-26T15:55"]');
  check('냉각 이상 버튼: 서초를 보고 있어도 사건이 있는 분당으로 맞춰지고 IDC_B_R08가 보임', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'B' && (await page.locator('.rack[data-rack="IDC_B_R08"]').count()) === 1);
  check('서버실 화면에 옛 랙 이름(A-03)이 없음', !(await page.locator('#tab-room').innerText()).includes('A-03'));
  // 서버실에서 장비를 누르면 그 장비의 터미널이 열린다 (서초)
  await page.click('#centerBar [data-center=S]');
  await goTab('room');
  const [popS] = await Promise.all([ctx.waitForEvent('page'), page.click('#racks .rdev >> nth=0')]);
  await popS.waitForLoadState('load');
  const tgt = await popS.locator('#termTarget').innerText();
  check('서초 랙의 첫 장비를 누르면 그 장비(IDC_S_FR1) 터미널이 열림', /^IDC_S_FR1 · IDC_S_R01/.test(tgt), tgt);
  await popS.close();
  // 센터 선택은 저장되어 새로고침해도 유지된다
  await page.click('#centerBar [data-center=G]');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  await goTab('monitor');   // 새로고침한 주소에 #room이 남아 있을 수 있어 관제 화면으로 간다
  check('센터 선택(구로)이 새로고침 후에도 유지됨', (await page.locator('#centerBar .cbtn.on').getAttribute('data-center')) === 'G' && (await page.locator('.panel:visible').count()) === 2);
  await page.click('#centerBar [data-center=ALL]');
  check('전체를 고르면 그래프 15개가 모두 보임', (await page.locator('.panel:visible').count()) === 15);

  // 시나리오 4가지: 시간이 흘러가고, 단계(감지·확인·조치·결과)가 나오고, 닫으면 현재로 돌아온다
  // 시나리오 이전/다음: 팝업과 위쪽 막대 모두
  await goTab('monitor');
  await page.evaluate(() => startScn('calm'));
  await page.waitForSelector('#scnPop:not([hidden])');
  check('시나리오 팝업: 1단계에서는 "이전"이 막혀 있음', await page.locator('#scnPopPrev').isDisabled());
  await page.click('#scnPopNext');
  await page.waitForFunction(() => !document.getElementById('scnPop').hidden && document.getElementById('scnPopNo').innerText.startsWith('단계 2 /'), null, { timeout: 20000 });
  const n2 = await page.locator('#scnPopTitle').innerText(), t2 = await page.locator('#scnTime').innerText();
  await page.click('#scnPopPrev');
  check('"이전"을 누르면 1단계 팝업이 다시 뜨고 화면도 그 단계 시각으로 돌아감', (await page.locator('#scnPopNo').innerText()).startsWith('단계 1 /') && (await page.locator('#scnPopPrev').isDisabled()) && (await page.locator('#endTime').inputValue()) === '2026-10-22T18:30', await page.locator('#endTime').inputValue());
  await page.click('#scnPopNext');
  check('"다음"을 누르면 2단계 팝업으로 돌아오고 화면도 2단계 시각', (await page.locator('#scnPopTitle').innerText()) === n2 && (await page.locator('#endTime').inputValue()) === '2026-10-22T18:45');
  await page.click('#scnPopNext');   // 마지막 단계에서 다음 = 닫고 진행
  check('마지막으로 본 단계에서 "계속 진행"을 누르면 팝업이 닫히고 진행 시각 화면으로 돌아옴', !(await page.locator('#scnPop').isVisible()));
  await page.click('#scnPrevStep');
  check('위쪽 막대의 "이전 단계"는 가장 최근 단계 팝업을 다시 열고, 거기서 더 이전으로 갈 수 있음', (await page.locator('#scnPop').isVisible()) && (await page.locator('#scnPopNo').innerText()).startsWith('단계 2 /') && !(await page.locator('#scnPopPrev').isDisabled()));
  await page.click('#scnPopX');
  await page.click('#scnNextStep');
  check('위쪽 막대의 "다음 단계"는 다음 단계 시각으로 바로 건너뛰어 그 단계 팝업을 띄움', (await page.locator('#scnPop').isVisible()) && (await page.locator('#scnPopNo').innerText()).startsWith('단계 3 /'));
  await page.click('#scnPopSkip'); await page.click('#scnClose');
  // 급감 시나리오 내용: 광값 기준표, [TEP IDC] 메일 제목, 복구 메일
  await page.evaluate(() => startScn('drop'));
  await page.waitForSelector('#scnPop:not([hidden])'); await page.click('#scnPopSkip');
  const dropPop = async k => { await page.click(`#scnSteps li >> nth=${k} >> [data-scnpop]`); const t = await page.locator('#scnPop').innerText(); await page.click('#scnPopX'); return t; };
  const pop3 = await dropPop(2);
  check('급감 시나리오 광값 단계: 정상 범위(약 -14.4 ~ +0.5 dBm)와 수신 광값 읽는 법 표가 나옴', /정상 범위/.test(pop3) && /-14\.4/.test(pop3) && /\+0\.5/.test(pop3) && /읽는 법/.test(pop3) && /-40 dBm/.test(pop3));
  const p4 = await dropPop(3);
  check('급감 시나리오 안내 메일 제목에 회사 이름: "[TEP IDC] 국내 연동(IX) 트래픽 감소 확인 중" ("[안내]"만 있지 않음)', p4.includes('제목: [TEP IDC] 국내 연동(IX) 트래픽 감소 확인 중') && !p4.includes('[안내]') && p4.includes('TEP IDC 관제입니다'));
  const p6 = await dropPop(5);
  check('급감 시나리오 마지막 단계에 복구 안내 메일 예시: "[TEP IDC] ... 복구 완료 안내", 발생·복구 시각과 원인', /제목: \[TEP IDC\].*복구 완료 안내/.test(p6) && /발생:/.test(p6) && /복구:/.test(p6) && /원인:/.test(p6));
  await page.click('#scnClose');
  // 장애 전파 문자 양식: [TEP IDC] / [Web발신] / [주의_센터_발생|경과|완료] 제목, ■ 대상·일시·원인·(조치)·서비스영향·VOC, 완료에만 끝 시각
  const FIELDS = ['■ 대상 : ', '■ 일시 : ', '■ 원인 : ', '■ 서비스영향 : ', '■ VOC : '];
  const smsCheck = (t, stage, center) => { const L = t.split('\n').map(x => x.trimEnd()), i = L.indexOf('[TEP IDC]'); if (i < 0) return false; const m = L.slice(i);
    const idx = FIELDS.map(f => m.findIndex(x => x.startsWith(f)));
    return m[1] === '[Web발신]' && m[2].startsWith(`[주의_${center}_${stage}] `) && m[3] === '' && idx.every(x => x > 0) && idx.every((x, k) => k === 0 || x > idx[k - 1]); };
  const sms = await page.evaluate(() => { const S = buildScenarios(), g = (id, k) => S[id].steps[k].detail; return { fa: g('linkDown', 3), pr: g('linkDown', 6), dn: g('linkDown', 8), t1: g('temp', 2), t2: g('temp', 6), r1: g('redundancy', 4), r2: g('redundancy', 6), r3: g('redundancy', 7),
    sample: smsNotice({ stage: '발생', center: '안산', title: '예시미디어, 샘플방송, 가상모빌리티 고객사 중앙 백본 업링크 단선', target: 'IDC_A_FS1(10.0.0.1)', from: '10/21 14:20', cause: '업링크가 끊겨 확인 중', impact: '파악중', voc: '파악중' }),
    ddos: smsNotice({ stage: '발생', center: '분당', title: 'DDoS 공격 수신', target: 'IDC_B_FS1(10.0.0.1)', from: '03/18 15:30', cause: '국제망 DDoS 공격', attack: 'TCP (6.5 Gbps / 5.9 Mpps)', impact: '파악중', voc: '파악중' }),
    bad: (() => { try { smsNotice({ stage: '끝', center: 'x', title: 'x', target: 'x', from: 'x', cause: 'x', impact: 'x', voc: 'x' }); return false; } catch (e) { return true; } })() }; });
  check('문자 양식(발생): 알려 준 양식과 같은 순서 [TEP IDC]·[Web발신]·[주의_안산_발생] 제목, 빈 줄, ■ 대상·일시·원인·서비스영향·VOC', smsCheck(sms.sample, '발생', '안산') && sms.sample.includes('■ 일시 : 10/21 14:20 ~\n'), sms.sample.split('\n').slice(0, 4).join(' | '));
  check('문자 양식: DDoS일 때는 ■ 공격량 줄이 원인 다음에 들어감', /■ 원인 : .+\n■ 공격량 : TCP \(6\.5 Gbps \/ 5\.9 Mpps\)\n■ 서비스영향/.test(sms.ddos));
  check('문자 단계는 발생·경과·완료만 허용됨', sms.bad);
  check('업링크 회선 다운: 발생 문자(서비스영향·VOC 파악중, 일시는 끝 없이 "~")', smsCheck(sms.fa, '발생', '안산') && sms.fa.includes('■ 서비스영향 : 파악중') && /■ 일시 : \d\d\/\d\d \d\d:\d\d ~\n/.test(sms.fa) && !sms.fa.includes('■ 조치'));
  check('업링크 회선 다운: 경과 문자는 조치 시간표(시각 + 세부)가 있고 끝 시각은 없음', smsCheck(sms.pr.split('[경과 문자 예시]')[1], '경과', '안산') && /■ 조치 :\n\d\d:\d\d .+\n - /.test(sms.pr) && !/■ 일시 : .* ~ \d/.test(sms.pr.split('[경과 문자 예시]')[1]) && !sms.pr.split('[경과 문자 예시]')[1].includes('■ 전파'));
  check('업링크 회선 다운: 완료 문자는 시작~끝 일시, 마지막 조치 "회선 복구 확인"이 있고 "전파" 항목은 없음(뜻을 몰라서 뺌)', smsCheck(sms.dn, '완료', '안산') && /■ 일시 : \d\d\/\d\d \d\d:\d\d ~ \d\d\/\d\d \d\d:\d\d\n/.test(sms.dn) && /\d\d:\d\d 회선 복구 확인/.test(sms.dn) && !sms.dn.includes('■ 전파'));
  check('서버실 온도 시나리오: 발생·완료 문자, 이중화로 영향 없음이 서비스영향에 적힘', smsCheck(sms.t1, '발생', '분당') && smsCheck(sms.t2, '완료', '분당') && /짝 장비 IDC_B_FS5/.test(sms.t2) && /영향 없음/.test(sms.t2));
  check('이중화 시나리오: 발생(영향 없음) → 경과(장비는 돌아왔지만 교체가 남음) → 완료(전체 정상 확인) 순서로 문자가 나옴', smsCheck(sms.r1.split('\n').slice(1).join('\n'), '발생', '분당') && sms.r2.includes('[주의_분당_경과]') && sms.r2.includes('아직 \'완료\'가 아니라 \'경과\'') && sms.r3.includes('[주의_분당_완료]') && sms.r3.includes('전체 상태 정상 확인') && !sms.r2.split('[경과 문자 예시]')[1].includes('■ 전파'));
  // 업링크 회선 다운: 복구 원인을 고른다 (상대 구간 작업 / 일시 오류 / 광 케이블·SFP 교체)
  await page.evaluate(() => { window.ldRoute = 'slides'; document.getElementById('scnCausePop').hidden = false; });
  check('업링크 회선 다운을 고르면 먼저 복구 원인(3가지)을 고르는 창이 뜨고 취소할 수 있음', (await page.locator('#scnCausePop').isVisible()) && (await page.locator('[data-ldcause]').count()) === 3 && !(await page.locator('#scnBar').isVisible()));
  await page.click('#ldCauseCancel');
  check('원인 선택을 취소하면 시나리오가 시작되지 않음', !(await page.locator('#scnCausePop').isVisible()) && !(await page.locator('#scnBar').isVisible()));
  const ld = await page.evaluate(() => Object.fromEntries(['work', 'transient', 'fiber'].map(c => { const S = buildScenarios({ cause: c }).linkDown, st = S.steps; return [c, { n: st.length, title: st[7].title, detail: st[7].detail, expl: st[7].explain, done: st[8].detail, doneTitle: st[8].title, allExpl: st.every(x => x.explain) }]; })));
  check('복구 원인에 따라 "원인 확인" 단계(8번째)가 다르게 나옴: 상대 구간 작업 / 일시 오류 / 광 모듈(SFP) 교체', ld.work.n === 9 && /상대/.test(ld.work.title) && /작업/.test(ld.work.title) && /일시/.test(ld.transient.title) && /SFP/.test(ld.fiber.title) && new Set([ld.work.title, ld.transient.title, ld.fiber.title]).size === 3 && Object.values(ld).every(x => x.allExpl && x.expl.length > 60), JSON.stringify([ld.work.title, ld.transient.title, ld.fiber.title]));
  check('원인별 마무리: 상대 작업은 사전 공지 재발 방지 요청, 일시 오류는 재발 감시, SFP 불량은 교체 전·후 광값을 보여 줌', /사전 공지/.test(ld.work.detail) && /재발/.test(ld.transient.detail) && /교체 전/.test(ld.fiber.detail) && /교체 후/.test(ld.fiber.detail) && /-40\.00 dBm/.test(ld.fiber.detail) && /-3\.\d\d dBm/.test(ld.fiber.detail));
  check('완료 문자의 원인과 조치가 복구 원인을 따름 (완료 문자 형식도 유지)', ['work', 'transient', 'fiber'].every(c => smsCheck(ld[c].done.split('[완료 문자 예시]\n')[1], '완료', '안산')) && /상대 구간/.test(ld.work.done) && /일시적/.test(ld.transient.done) && /SFP/.test(ld.fiber.done) && /회복/.test(ld.work.doneTitle) && ld.work.doneTitle.includes('자동 복구'));
  // DDoS 시나리오: 데이터의 일정 없는 급증, 공격량, 클린존·블랙홀, 문자(발생·경과·완료)
  const dd = await page.evaluate(() => { const S = buildScenarios().ddos, st = S.steps, a = ALERTS.find(x => x.link === 'IDC_B_FS1_UP2' && x.kind.includes('급증') && !x.evName), L = LINK.IDC_B_FS1_UP2;
    const base = L.in[a.s - 1], peak = Math.max(...L.in.slice(a.s, a.e + 1)); return { n: st.length, sms: st[3].detail, prog: st[7].detail, done: st[9].detail, t5: st[5].detail, t6: st[6].detail, t4: st[4].detail, expl: st.every(x => x.explain && x.explain.length > 40), lesson: S.def ? '' : S.lesson, atk: peak - base, kinds: st.map(x => x.kind) }; });
  const atkTxt = (dd.sms.match(/공격량 : TCP \(([\d.]+) Gbps \/ ([\d.]+) Mpps\)/) || []);
  check('DDoS 시나리오: 10단계, 모든 단계에 설명, 데이터의 일정 없는 급증(IDC_B_FS1_UP2 새벽)을 사용', dd.n === 10 && dd.expl && dd.kinds[0] === '감지' && dd.kinds[9] === '결과');
  check('DDoS 발생 문자: 양식 + ■ 공격량이 원인 다음에 나오고, 공격량이 그래프의 급증분과 같고 Mpps는 138바이트 가정에 맞음', smsCheck(dd.sms, '발생', '분당') && /■ 원인 : .+\n■ 공격량 : TCP/.test(dd.sms) && Math.abs(+atkTxt[1] - dd.atk) < 0.06 && Math.abs(+atkTxt[2] - dd.atk * 1000 / (138 * 8)) < 0.06 && /서비스영향 : 파악중/.test(dd.sms), atkTxt.slice(1).join('/') + ' vs ' + dd.atk.toFixed(1));
  check('DDoS 경과 문자: 블랙홀 중이라 대상 IP 접속 불가를 서비스영향에 쓰고, 조치 시간표에 블랙홀 차단·상위 연동망 요청이 있음', smsCheck(dd.prog.slice(dd.prog.indexOf('[TEP IDC]')), '경과', '분당') && /서비스영향 : 대상 IP.+접속 불가\(블랙홀 중\)/.test(dd.prog) && /블랙홀 차단/.test(dd.prog) && /상위 연동망에 블랙홀 요청/.test(dd.prog) && !/■ 일시 : .* ~ \d/.test(dd.prog.slice(dd.prog.indexOf('[TEP IDC]'))));
  check('DDoS 완료 문자: 블랙홀 해제까지 끝난 뒤에만 완료, 해제 조치와 블랙홀 구간이 있음', smsCheck(dd.done.slice(dd.done.indexOf('[TEP IDC]')), '완료', '분당') && /블랙홀 해제/.test(dd.done) && /블랙홀 구간\(\d\d:\d\d~\d\d:\d\d\)/.test(dd.done) && /\[주의_분당_완료\]/.test(dd.done));
  check('DDoS 시나리오: 클린존(공격만 거름)과 블랙홀(전부 버림, 대상도 접속 불가)의 차이, 블랙홀 명령 예시(discard), 상위 연동망 요청(65535:666)이 설명됨', /클린존/.test(dd.t4) && /전부 버립니다/.test(dd.t4) && /공격만 버리고 정상 트래픽은 되돌려/.test(dd.t4) && /static route .*\/32 discard/.test(dd.t5) && /65535:666/.test(dd.t6) && /연동망에 문의할 때 확인할 3가지/.test(dd.t6));
  check('모든 시나리오의 모든 단계에 설명이 있음 (팝업이 비지 않음)', await page.evaluate(() => Object.values(buildScenarios()).every(S => S.steps.every(x => x.explain && x.explain.length > 30))));
  check('모든 시나리오 본문에 글자 그대로의 "\\n"이 남아 있지 않음(줄바꿈이 깨지지 않음)', await page.evaluate(() => Object.values(buildScenarios()).every(S => S.steps.every(x => !String(x.detail || '').includes('\\n') && !String(x.explain || '').includes('\\n')))));
  // 탭 아이콘(로고)
  const icons = await page.evaluate(() => [...document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon]')].map(l => l.getAttribute('href')));
  const fsx = require('fs'), siteDir = require('path').resolve(__dirname, '../site'), png = f => fsx.readFileSync(siteDir + '/' + f).subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  check('탭 아이콘(로고): svg·32px png·아이패드용 아이콘이 연결되어 있고 파일이 올바름', icons.includes('favicon.svg') && icons.includes('favicon-32.png') && icons.includes('apple-touch-icon.png') && fsx.readFileSync(siteDir + '/favicon.svg', 'utf8').includes('<svg') && png('favicon-32.png') && png('apple-touch-icon.png'), icons.join(','));
  const mails = await page.evaluate(() => [(ev => evNoticeText(ev, evCalc(ev)))(DATA.events.find(e => e.name.includes('8강'))), replyText(parseMail(SAMPLE_MAIL))].map(x => x.split('\n')[0]));
  check('다른 메일 제목에도 [TEP IDC]가 붙음 (경기 사전 안내, 방문 회신)', mails.every(x => x.includes('[TEP IDC]')), mails.join(' | '));
  const scenarios = [['calm', '평일 오후 7시', 4, ['그래프 15개 확인', '서버실 확인', '이상 없음']], ['drop', '트래픽 급감', 6, ['급감', 'IDC_B_FS2_INTL1', '광값', '예시미디어', '회복']],
    ['redundancy', '이중화로 무사히 넘기기', 8, ['이중화', '전원 꺼짐', '트래픽은 거의 그대로', '고객 영향 없음']], ['linkDown', '업링크 회선 다운', 9, ['Admin', '트래픽(전/후)', '광값', 'ping', '연동망', '원인 확인', '회복']], ['ddos', 'DDoS 공격 수신', 10, ['DDoS', '공격량', '클린존', '블랙홀', '정상화', '해제']], ['surge', '트래픽 폭주', 7, ['사전 연락', '분산', '하이드레이션', '경고선 80%', '사후 정리', '[TEP IDC]']], ['temp', '서버실 온도 변화', 7, ['온도 경고', '빨강 깜박임', '터미널', '냉각 복구', '-40.00 dBm']]];
  for (const [id, name, n, words] of scenarios) {
    await goTab('monitor');
    await page.evaluate(([i]) => startScn(i, i === 'linkDown' ? { cause: 'work' } : undefined), [id]);   // 슬라이드 버전은 목록에서 뺐지만 코드는 남아 있다
    await page.waitForSelector('#scnPop:not([hidden])', { timeout: 30000 });   // 첫 단계가 되면 팝업이 뜬다
    const pop1 = await page.locator('#scnPop').innerText();
    check(`시나리오 "${name}": 첫 단계에 팝업이 뜨고 설명과 단계 번호가 나옴`, /단계 1 \/ \d+/.test(pop1) && pop1.length > 120, pop1.slice(0, 60).replace(/\n/g, ' '));
    const t0 = await page.locator('#scnTime').innerText();
    await page.waitForTimeout(1500);
    check(`시나리오 "${name}": 팝업이 열려 있는 동안 시간이 멈춤`, (await page.locator('#scnTime').innerText()) === t0);
    await page.click('#scnPopNext');
    await page.waitForTimeout(2600);
    const t1 = await page.locator('#scnTime').innerText();
    check(`시나리오 "${name}": '다음'을 누르면 시간이 다시 흐르거나 다음 단계 팝업이 뜸`, (await page.locator('#scnBar').isVisible()) && (t1 !== t0 || (await page.locator('#scnPop').isVisible())), `${t0} -> ${t1}`);
    if (await page.locator('#scnPop').isVisible()) await page.click('#scnPopSkip'); else await page.click('#scnSkip');
    const txt = await page.locator('#scnSteps').textContent();
    const cnt = await page.locator('#scnSteps li').count();
    check(`시나리오 "${name}": 단계 ${n}개와 핵심 내용이 나옴`, cnt === n && words.every(w => txt.includes(w)), `단계 ${cnt}/${n}, 빠진 말: ${words.filter(w => !txt.includes(w)).join(',') || '없음'}`);
    await page.click('#scnSteps li >> nth=0 >> [data-scnpop]');
    check(`시나리오 "${name}": 지난 단계 팝업에서는 '이전'이 막혀 있고(1단계), '다음'으로 다음 단계로 감`, (await page.locator('#scnPopPrev').isDisabled()) && (await page.locator('#scnPopNo').innerText()).startsWith('단계 1 /'));
    const popTxt = await page.locator('#scnPop').innerText();
    check(`시나리오 "${name}": '자세히 팝업'에 설명과 관련 장비·회선·랙 정보가 나옴`, (await page.locator('#scnPopBody .explain').count()) === 1 && /관련 (회선|랙|장비)/.test(popTxt), popTxt.slice(0, 80).replace(/\n/g, ' '));
    await page.click('#scnPopX');
    check(`시나리오 "${name}": 팝업을 닫으면 사라짐`, !(await page.locator('#scnPop').isVisible()));
    if (['linkDown', 'redundancy', 'temp', 'surge', 'calm', 'drop'].includes(id)) check(`시나리오 "${name}": 끝나면 '배울 점' 버튼이 생김`, await page.locator('#scnLesson').isVisible());
    if (id === 'drop') {
      check('급감 시나리오: IDC_B_FS2_IX1 패널이 강조 표시됨', (await page.locator('#p-IDC_B_FS2_IX1.hl').count()) === 1);
      await page.waitForTimeout(1200);   // 자동 스크롤이 끝나길 기다림
      const vis = await page.evaluate(() => { const r = document.querySelector('#p-IDC_B_FS2_IX1').getBoundingClientRect(), bar = document.querySelector('#scnBar').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, barBottom: bar.bottom, h: innerHeight }; });
      check('급감 시나리오: 강조된 IDC_B_FS2_IX1 패널이 안내 막대에 가리지 않고 화면 안에 보임', vis.top >= vis.barBottom - 2 && vis.bottom <= vis.h + 2, JSON.stringify(vis));
      check('안내 막대 높이가 화면의 30% 이하 (그래프를 가리지 않음)', vis.barBottom <= vis.h * 0.30, `막대 아래 ${vis.barBottom.toFixed(0)}px / 화면 ${vis.h}px`);
    }
    if (id === 'temp') check('온도 시나리오: 서버실 탭으로 이동하고 IDC_B_R08 랙이 강조 표시됨', (await page.locator('#tab-room').isVisible()) && (await page.locator('.rack.hl[data-rack="IDC_B_R08"]').count()) === 1);
    await page.click('#scnClose');
    check(`시나리오 "${name}": 닫으면 관제 현재(10/22 21:00)로 돌아옴`, !(await page.locator('#scnBar').isVisible()) && (await page.locator('#tab-monitor').isVisible()) && (await page.locator('#endTime').inputValue()) === '2026-10-22T21:00');
  }

  // 월간 자료: 정기 발송 고객사를 월초·월말·매주로 나눠 접어 둔다
  await goTab('monthly');
  const plan = await page.evaluate(() => [...document.querySelectorAll('#sendPlan details')].map(d => ({ open: d.open, sum: d.querySelector('summary').innerText, names: [...d.querySelectorAll('tr > td:first-child')].map(x => x.textContent.trim()), boxes: d.querySelectorAll('input[type=checkbox]').length })));
  check('이번 달 발송 현황: 월초·월말·매주 3묶음이 모두 접혀 있고, 정해 준 고객사만 나옴(월초 예시미디어·샘플게임즈 / 월말 가상은행·예시금융 / 매주 데모스트리밍)', plan.length === 3 && plan.every(g => !g.open) && JSON.stringify(plan.map(g => g.names)) === JSON.stringify([['예시미디어', '샘플게임즈'], ['가상은행', '예시금융'], ['데모스트리밍']]) && /월초 발송/.test(plan[0].sum) && /월말 발송/.test(plan[1].sum) && /매주 발송/.test(plan[2].sum), JSON.stringify(plan.map(g => g.sum)));
  check('매주 묶음은 이번 달 월요일 칸(10/5·12·19·26)이 있고 아직 안 온 날은 예정으로 표시', plan[2].boxes === 4 && (await page.evaluate(() => document.querySelector('#sendPlan details[data-plan=weekly]').textContent)).includes('10-26 (예정)'));
  await page.click('#sendPlan details[data-plan=start] > summary');
  await page.click('#sendPlan details[data-plan=start] input >> nth=0');
  check('묶음을 펼쳐 발송 완료를 체크하면 완료 수가 올라가고 묶음은 열린 채로 남음', (await page.locator('#sendPlan details[data-plan=start] > summary').innerText()).includes('완료 1/2') && (await page.evaluate(() => document.querySelector('#sendPlan details[data-plan=start]').open)));
  await goTab('event');
  const planText = await page.locator('#evPlan').innerText();
  check('센터 이름이 지명(분당·안산·구로·서초)으로 나옴', ['분당 → 중앙 백본 (A)', '안산 → 중앙 백본 (Juniper)', '구로 → 중앙 백본', '서초 센터 백본 (Cisco)'].every(w => planText.includes(w)) && !/우리 센터|센터B|센터C|센터D/.test(planText), planText.split('\n').slice(0, 3).join(' | '));
  for (const t of ['monthly', 'event', 'room', 'visit', 'term']) {
    await goTab(t);
    await page.waitForTimeout(150);
    check(`${t} 탭 열림`, await page.locator('#tab-' + t).isVisible());
  }

  await goTab('monthly');
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
  // 요약에 사용률과 총 전송량: 데이터 구간(10/20~10/21) 안에서 독립적으로 계산한 값과 비교
  await page.fill('#mFrom', '2026-10-20'); await page.press('#mFrom', 'Tab'); await page.fill('#mTo', '2026-10-21'); await page.press('#mTo', 'Tab');
  const sum = await page.evaluate(() => { const m = mState(), id = m.ids[0], L = LINK[id], a = idxOf(parseT('2026-10-20T00:00')), b = idxOf(parseT('2026-10-21T23:55'));
    let tot = 0, mx = 0; for (let i = a; i <= b; i++) { tot += L.out[i] * 300 / 8; mx = Math.max(mx, L.out[i]); }
    const row = [...document.querySelectorAll('#mSum tr:nth-child(2) td')].map(x => x.innerText); return { head: document.querySelector('#mSum tr').innerText, row, expTot: tot, expUtilMax: mx / L.cap * 100 }; });
  check('월간 요약 표에 평균·최대 사용률(%)과 총 전송량(GB) 열이 있음', /평균 사용률/.test(sum.head) && /최대 사용률/.test(sum.head) && /총 전송량\(GB\)/.test(sum.head), sum.head.replace(/\s+/g, ' '));
  check('총 전송량(GB)과 최대 사용률이 독립 계산(Σ Gbps×300초÷8, 최대÷용량)과 같음', Math.abs(+sum.row[sum.row.length - 1].replace(/,/g, '') - sum.expTot) <= 1 && Math.abs(parseFloat(sum.row[sum.row.length - 2]) - sum.expUtilMax) < 0.06, JSON.stringify({ row: sum.row.slice(-3), expTot: Math.round(sum.expTot), expUtilMax: sum.expUtilMax.toFixed(1) }));
  const [sc] = await Promise.all([page.waitForEvent('download'), page.click('#mSumCsv')]);
  const sct = require('fs').readFileSync(await sc.path(), 'utf8').replace(/^\uFEFF/, ''), sl = sct.trim().split('\n');
  check('요약 CSV 머리글에 cap_gbps, util_avg_pct, util_max_pct, util_p95_pct, total_gb가 있고 모든 줄 열 수가 같음', ['cap_gbps', 'util_avg_pct', 'util_max_pct', 'util_p95_pct', 'total_gb'].every(c => sl[0].includes(c)) && sl.every(l => l.split(',').length === sl[0].split(',').length) && sl.length > 2, sl[0]);
  await page.fill('#mFrom', '2026-10-01'); await page.press('#mFrom', 'Tab'); await page.fill('#mTo', '2026-10-31'); await page.press('#mTo', 'Tab');
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

  await goTab('room');
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
  check('꺼진 장비(IDC_B_FS6)를 누르면 새 창에 그 장비 터미널이 열림', pop.url().includes('popup=term') && (await pop.locator('#termTarget').innerText()).includes('IDC_B_FS6 · IDC_B_R08'), await pop.locator('#termTarget').innerText());
  check('새 창에는 터미널만 보임', (await pop.locator('#tab-term').isVisible()) && !(await pop.locator('#tab-monitor').isVisible()));
  await pop.press('#termIn', 'Enter');
  check('채워 둔 첫 명령(회선 설명)이 실행됨', (await pop.locator('#termOut').innerText()).includes('Admin Link Description'));
  await pop.close();

  await goTab('room');
  await page.click('#homeLink');
  check('제목을 누르면 관제(홈)로 이동', await page.locator('#tab-monitor').isVisible());

  await goTab('visit');
  await page.click('#vParse');
  await page.click('#vReg');
  check('방문 등록 후 회신 초안이 생김', (await page.locator('#vReply').inputValue()).includes('방문 등록 완료'));

  await goTab('term');
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
  // 장비 터미널 화면 정리: 접이식 매뉴얼, 목적별 명령(설명), 접이식 설계도(그림)와 PDF
  await goTab('term');
  const fold0 = await page.evaluate(() => ({ rb: document.getElementById('runbook').open, dg: document.getElementById('designBox').open, tb: document.getElementById('dgTables').open }));
  check('장애 매뉴얼과 설계도는 평소에 안 보이고 터미널이 먼저 보임', !fold0.rb && !fold0.dg && !fold0.tb, JSON.stringify(fold0));
  await page.click('#runbookBtn');
  check('"장애 매뉴얼 열기" 버튼으로 매뉴얼이 펼쳐지고 버튼 글자가 바뀜', (await page.evaluate(() => document.getElementById('runbook').open)) && (await page.locator('#runbookBtn').innerText()).includes('접기') && (await page.locator('#runbook li').count()) >= 8);
  await page.click('#termNav [data-pane=term]');   // 매뉴얼을 보는 동안 터미널 칸은 숨겨지므로 위의 보조 메뉴로 돌아온다
  check('다시 누르면 터미널로 돌아옴', !(await page.evaluate(() => document.getElementById('runbook').open)) && (await page.locator('#termOut').isVisible()));
  await page.click('#termNav [data-pane=runbook]');
  const rbTop = await page.evaluate(() => document.getElementById('runbook').getBoundingClientRect().top);
  check('터미널 위 보조 메뉴(터미널·장애 매뉴얼·설계도)로 맨 아래까지 내려가지 않고 매뉴얼이 바로 위쪽에 열림', (await page.locator('#termNav button').count()) === 3 && rbTop < 400 && !(await page.locator('#termOut').isVisible()), String(Math.round(rbTop)));
  await page.click('#termNav [data-pane=term]');
  const grp = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#qcmd .qgrp h4')].map(h => h.innerText), bad: [...document.querySelectorAll('#qcmd button')].filter(b => !b.title.includes('무엇을 위해') || !b.title.includes('읽는 법') || !b.querySelector('.why').innerText.trim()).map(b => b.dataset.c) }));
  check('명령이 목적별 묶음(1.회선 상태 확인 ~)으로 정리되고, 모든 명령에 한 줄 설명과 마우스 설명(무엇을 위해·읽는 법)이 있음', grp.groups.length >= 4 && grp.groups[0].startsWith('1. 회선 상태 확인') && grp.bad.length === 0, JSON.stringify(grp));
  await page.selectOption('#vendorSel', 'cisco');
  const cg = await page.evaluate(() => ({ n: document.querySelectorAll('#qcmd .qgrp').length, titles: [...document.querySelectorAll('#qcmd button')].map(b => b.title).join('|') }));
  check('Cisco·Huawei 장비도 같은 묶음과 설명으로 나옴', cg.n >= 3 && cg.titles.includes('읽는 법'));
  await page.selectOption('#vendorSel', 'juniper');
  // 설계도(그림)
  await page.click('#termNav [data-pane=design]');
  await page.waitForSelector('#dgView svg');   // 펼침 이벤트 뒤에 그려진다
  const dg = await page.evaluate(() => ({ svg: !!document.querySelector('#dgView svg'), txt: document.querySelector('#dgView').textContent }));
  check('설계도를 펼치면 전체 구성도(그림)가 나옴: 4개 센터와 중앙 백본 이중화 표시', dg.svg && ['서초 센터', '분당 센터', '구로 센터', '안산 센터', 'IDC_S_FS1', 'IDC_S_FS2'].every(w => dg.txt.includes(w)), dg.txt.slice(0, 60).replace(/\n/g, ' '));
  for (const c of ['S', 'B', 'G', 'A']) {
    await page.click(`#dgTabs [data-dg=${c}]`);
    const r = await page.evaluate(code => { const ids = [...document.querySelectorAll('#dgView [data-dev]')].map(e => e.dataset.dev).sort(); const want = TOPOLOGY.devices.filter(d => d.id.split('_')[1] === code).map(d => d.id).sort(); return { same: JSON.stringify(ids) === JSON.stringify(want), n: ids.length, want: want.length }; }, c);
    check(`센터별 구성도(${c}): 그 센터 장비가 하나도 빠짐없이 그려짐`, r.same, `${r.n}/${r.want}`);
  }
  await page.click('#dgTabs [data-dg=B]');
  await page.click('#dgView [data-dev="IDC_B_FS6"]');
  check('설계도의 장비를 누르면 그 장비의 터미널이 선택됨', (await page.locator('#devSel').inputValue()) === 'IDC_B_FS6');
  await page.evaluate(() => selectDevice('IDC_B_FS1'));   // 이후 시험은 꺼지지 않은 장비로 이어 간다
  await page.click('#termNav [data-pane=design]');   // 장비를 눌러 터미널로 갔으니 설계도를 다시 연다
  await page.click('#dgTables > summary');
  check('"표로 보기"를 펼치면 장비 표가 보임 (장비 120행)', (await page.locator('#devTbl tr.click').count()) === 120 && (await page.locator('#devTbl').isVisible()));
  const fs = require('fs');
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#dgPdf')]);
  const pdfPath = await pdf.path(), buf = fs.readFileSync(pdfPath), txt = buf.toString('latin1');
  const objOffsets = [...txt.matchAll(/^(\d+) 0 obj/gm)].map(m => [+m[1], m.index]);
  const xrefAt = +txt.match(/startxref\n(\d+)/)[1], xrefLines = txt.slice(xrefAt).split('\n').slice(3).filter(l => /^\d{10} 00000 n/.test(l));
  check('PDF 내려받기: 파일 이름이 영문(traffic_design_날짜.pdf)이고 %PDF로 시작해 %%EOF로 끝남', /^traffic_design_\d{8}\.pdf$/.test(pdf.suggestedFilename()) && txt.startsWith('%PDF-1.4') && txt.trim().endsWith('%%EOF'), pdf.suggestedFilename());
  check('PDF: 11쪽(전체 1 + 센터 4 + 고객사 1 + 회선 1 + 장비 4)이고 크기가 충분함', (txt.match(/\/Type \/Page \//g) || []).length === 11 && /\/Count 11/.test(txt) && buf.length > 150000, `${(txt.match(/\/Type \/Page \//g) || []).length}쪽 ${buf.length}B`);
  check('PDF: 교차 참조(xref) 표의 위치가 실제 객체 위치와 모두 맞음 (열 때 오류 없음)', txt.slice(xrefAt, xrefAt + 4) === 'xref' && xrefLines.length === objOffsets.length && xrefLines.every((l, k) => +l.slice(0, 10) === objOffsets[k][1]), `${xrefLines.length}/${objOffsets.length}`);
  check('PDF 만든 뒤 버튼이 다시 눌림', !(await page.locator('#dgPdf').isDisabled()) && (await page.locator('#dgMsg').innerText()).includes('내려받았습니다'));
  await page.click('#termNav [data-pane=term]');   // 설계도를 보고 있었으므로 터미널로 돌아온다
  await page.click('#qcmd button'); await page.press('#termIn', 'Enter');   // 위 확인 때문에 지워진 출력을 다시 만든다
  check('터미널 명령 출력 (첫 자주 쓰는 명령 = 회선 설명)', (await page.locator('#termOut').innerText()).includes('Admin Link Description'));
  // 꺼진 장비: 그 시각에는 터미널이 응답하지 않고, 옆 장비 포트는 Down·빛 없음, 복구 뒤에는 정상
  const O = await page.evaluate(() => { const ms = iso => parseT(iso), r = (id, c, iso) => runCmd(c, DEV[id], ms(iso)); return {
    off: r('IDC_B_FS6', 'show interfaces descriptions', '2026-10-26T16:15'), on: r('IDC_B_FS6', 'show interfaces descriptions', '2026-10-26T16:30'), before: r('IDC_B_FS6', 'show interfaces descriptions', '2026-10-26T16:00'),
    hub: r('IDC_B_FS1', 'show interfaces descriptions', '2026-10-26T16:15'), hubOpt: r('IDC_B_FS1', 'show interfaces diagnostics optics xe-0/0/12', '2026-10-26T16:15'), hubOk: r('IDC_B_FS1', 'show interfaces diagnostics optics xe-0/0/12', '2026-10-26T16:30'),
    partner: r('IDC_B_FS5', 'show interfaces descriptions', '2026-10-26T16:15'), fs7: r('IDC_B_FS7', 'show interfaces descriptions', '2026-10-27T03:20'), fs8: r('IDC_B_FS8', 'show interfaces descriptions', '2026-10-27T03:20'),
    after: DEV.IDC_B_FS6.ifs.every(f => f[5] === 'up' || f[11] || f[6] === 'down' || f[3] > -40) }; });
  check('꺼진 장비(IDC_B_FS6 16:15): 터미널에 접속할 수 없다 (응답 없음, 전원 꺼짐)', /Connection timed out/.test(O.off) && /전원이 꺼져/.test(O.off) && !/Admin Link Description/.test(O.off), O.off.split('\n')[0]);
  check('꺼지기 전(16:00)과 복구 뒤(16:30)에는 정상으로 터미널이 동작함', /Admin Link Description/.test(O.before) && /Admin Link Description/.test(O.on));
  check('꺼진 장비와 이어진 옆 장비(허브 xe-0/0/12)의 포트는 Link down, 광 수신 -40 dBm, 복구 뒤에는 정상', /xe-0\/0\/12\s+up\s+down/.test(O.hub) && /-40\.00 dBm/.test(O.hubOpt) && !/-40\.00 dBm/.test(O.hubOk));
  check('이중화: 짝 장비(IDC_B_FS5)는 꺼진 시간에도 정상 접속되고 고객 회선이 그대로 Up', /Admin Link Description/.test(O.partner) && /xe-1\/0\/0\s+up\s+up/.test(O.partner));
  check('이중화 시나리오 장비(IDC_B_FS7 새벽 03:20 꺼짐): 접속 안 되고 짝 IDC_B_FS8은 정상 + 같은 회선 목록', /Connection timed out/.test(O.fs7) && /Admin Link Description/.test(O.fs8));
  check('시간 덮어쓰기 뒤 원래 상태로 돌아옴 (포트 상태가 영구히 바뀌지 않음)', O.after);
  const U = await page.evaluate(() => { const ls = DEV.IDC_B_FS3.ifs.filter(f => f[10]), p = DEV.IDC_B_FS4.ifs.filter(f => f[10]); return { n: ls.length, down: ls.filter(f => f[5] === 'down').length, off: ls.filter(f => f[6] === 'down').length, mirror: JSON.stringify(ls.map(f => [f[0], f[5], f[6]])) === JSON.stringify(p.map(f => [f[0], f[5], f[6]])), bad: ls.some(f => f[11] && portBad(f)) }; });
  check('사용하지 않는 고객 회선은 Down으로 표시됨 (일부는 Link down, 일부는 Admin down), 짝 장비에도 같은 상태, 이상(빨강)으로 세지 않음', U.down >= 2 && U.down < U.n && U.mirror && !U.bad, JSON.stringify(U));
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
  check('명령 show interfaces descriptions: Admin/Link 열, 회선 속도(10G)가 보이고, 끊긴 포트는 Admin up·Link down', /xe-0\/0\/11\s+up\s+down\s+IDC_G_FS1_DN2 -> IDC_G_FS3 10G/.test(T.desc), T.desc.split('\n').slice(0, 4).join(' | '));
  const D = await page.evaluate(() => { const r = (id, c) => runCmd(c, DEV[id]); return { a: r('IDC_B_FS3', 'show interfaces descriptions'), b: r('IDC_B_FS4', 'show interfaces descriptions'), c: r('IDC_B_AS1', 'display interface description') }; });
  const cl = x => x.split('\n').filter(l => /xe-1\/0\/|ge-1\/1\//.test(l)).map(l => l.replace(/^\S+\s+/, ''));
  check('인터페이스가 10개 이상 보이고 고객 회선은 "장비 고객사 속도" 형식 (예: IDC_B_FS3 가상물산 10G)', D.a.split('\n').length - 1 >= 10 && /xe-1\/0\/0\s+up\s+up\s+IDC_B_FS3 \S+ (10|1)G/.test(D.a) && /ge-1\/1\/0/.test(D.a) === /\b1G\b/.test(D.a), D.a.split('\n').slice(0, 3).join(' | '));
  check('이중화: 짝 장비(FS4)에서도 같은 고객 회선 목록이 같은 포트로 보임', cl(D.a).length >= 10 && JSON.stringify(cl(D.a)) === JSON.stringify(cl(D.b)), cl(D.b).slice(0, 2).join(' | '));
  check('Huawei도 인터페이스 10개 이상, 고객 회선에 속도가 붙음', D.c.split('\n').length - 4 >= 10 && /IDC_B_AS1 \S+ (10|1)G/.test(D.c));
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
