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

  await page.click('[data-tab=room]');
  await page.click('[data-sr="2026-10-26T16:15"]');
  check('냉각 이상 시 위험 랙 1개', (await page.locator('.rack.hot, .rack.crit').count()) === 1);

  await page.click('[data-tab=visit]');
  await page.click('#vParse');
  await page.click('#vReg');
  check('방문 등록 후 회신 초안이 생김', (await page.locator('#vReply').inputValue()).includes('방문 등록 완료'));

  await page.click('[data-tab=term]');
  await page.click('#qcmd button');
  await page.press('#termIn', 'Enter');
  check('터미널 명령 출력', (await page.locator('#termOut').innerText()).includes('Receiver signal'));

  check('콘솔·페이지 오류 없음', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})();
