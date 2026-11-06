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
  await page.waitForTimeout(400);

  check('그래프 패널 8개', (await page.locator('.panel').count()) === 8);
  check('가상 데이터 표시가 맨 위에 있음', (await page.locator('.badge').innerText()).includes('가상 데이터'));

  const box = await page.locator('#p-OUR-A svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 60);
  await page.waitForTimeout(150);
  const tip = await page.locator('#p-OUR-A .tip').innerText();
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
  await page.click('[data-jump="2026-10-23T20:35"]');
  check('급감 구간에서 IX-1 패널에 급감 표시', (await page.locator('#p-IX-1 .chip').innerText()) === '급감');
  await page.click('[data-jump="2026-10-21T14:35"]');
  check('회선 다운 구간에서 CTR-B1 패널에 급감 표시', (await page.locator('#p-CTR-B1 .chip').innerText()) === '급감');

  await page.selectOption('#jumpEv', '4');
  await page.waitForTimeout(200);
  const marks = await page.locator('#p-OUR-A svg text', { hasText: '하프타임' }).count()
    + await page.locator('#p-OUR-A svg text', { hasText: '하이드레이션' }).count();
  check('경기 보기에서 하이드레이션·하프타임 표시', marks >= 2, String(marks));

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
    const l = LINK['OUR-A'], f = d => Math.max(...seriesFor(l, parseT(d + 'T00:00'), parseT(d + 'T23:55')).out);
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

  const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('.srv[data-server="A-03-S2"]')]);
  await pop.waitForLoadState('load');
  check('서버를 누르면 새 창에 해당 스위치 터미널이 열림', pop.url().includes('popup=term') && (await pop.locator('#termTarget').innerText()).includes('A-03-S2 → SW-A-03'), await pop.locator('#termTarget').innerText());
  check('새 창에는 터미널만 보임', (await pop.locator('#tab-term').isVisible()) && !(await pop.locator('#tab-monitor').isVisible()));
  await pop.press('#termIn', 'Enter');
  check('연결된 포트 명령 출력(빛 없음)', (await pop.locator('#termOut').innerText()).includes('-40.00 dBm'));
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
  check('제조사 기본값은 Juniper이고 Juniper 장비만 나옴', (await page.locator('#vendorSel').inputValue()) === 'juniper' && (await opts()).length === 10 && (await opts()).includes('BB-OUR') && (await opts()).includes('CORE-1'));
  await page.selectOption('#vendorSel', 'cisco');
  check('Cisco를 고르면 Cisco 장비만 나옴 (백본 2대)', JSON.stringify(await opts()) === JSON.stringify(['BB-B2', 'BB-D1']));
  await page.selectOption('#vendorSel', 'huawei');
  check('Huawei를 고르면 Huawei 장비만 나옴 (소규모 장비 8대)', (await opts()).length === 8 && (await opts()).includes('AS-1'));
  await page.selectOption('#vendorSel', 'juniper');
  await page.click('#qcmd button');
  await page.press('#termIn', 'Enter');
  check('터미널 명령 출력', (await page.locator('#termOut').innerText()).includes('Receiver signal'));

  check('콘솔·페이지 오류 없음', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})();
