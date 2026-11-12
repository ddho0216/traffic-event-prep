/* 직접 대응 · 자동 대응 (시험판): 가상 시계가 흐르는 동안 알림을 직접 확인하고, 조회·판단·조치를 직접 눌러 진행한다.
   여러 시나리오를 담는 구조: 공통 부분(시계·그래프·알림 줄·해야 할 일·터미널·문자·결과)은 이 파일 위쪽에 있고,
   시나리오마다 달라지는 부분(값·단계·명령·문자)은 아래 SCEN 안에 시나리오별로 있다.
   모든 수치·IP·절차는 가상이고, DDoS의 클린존 가입 여부와 차단 절차는 제가 정한 가정이다. */
/* 같은 코드로 화면 둘을 만든다: 직접 대응(P="lv", 사람이 누른다)과 자동 대응(P="av", 규칙표대로 스스로 진행한다) */
function makeLive(root, P, AGENT) {
  if (!root) return null;
  const pad = n => String(n).padStart(2, "0");
  const noise = m => { const x = Math.sin(m * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const gb = v => v.toFixed(1);
  const E = id => document.getElementById(P + id.slice(2));   // 화면마다 id 앞글자가 다르다 (lv… / av…)
  let S, SC, timer = null, lastMin = -1;
  const fmt = m => { const x = SC.clock0 + Math.floor(m); return `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`; };
  const cur = () => Math.floor(S.t);
  const alerted = () => S.t >= SC.alertAt;
  const done = k => !!S.done[k];

  /* ================= 시나리오 ================= */
  const SCEN = {};

  /* ---------- DDoS 공격 수신 ---------- */
  SCEN.ddos = (() => {
    const VICTIM = "198.51.100.77", DEV = "IDC_B_FS1", UPL = "IDC_B_FS1_UP2";
    const ONSET = 20, ALERT = 23, ATK_END = 40, PKT = 138;
    const base = m => 3.3 + Math.sin(m / 6) * 0.15 + (noise(m) - 0.5) * 0.25;
    const atkRaw = m => m < ONSET ? 0 : (m < ATK_END ? Math.min(1, (m - ONSET) / 1.5) * 6.8 * (1 + (noise(m + 7) - 0.5) * 0.04) : Math.max(0, 1 - (m - ATK_END)) * 6.8);
    const blocked = m => S.bh != null && m >= S.bh && (S.rel == null || m < S.rel) ? Math.min(1, Math.max(0, 1 - (m - S.bh) / 1.2)) : 1;
    const passed = m => atkRaw(m) * blocked(m);
    const valueIn = m => base(m) + passed(m);
    const discarded = m => atkRaw(m) - passed(m);
    const mpps = m => (base(m) * 1e9 / (800 * 8) + passed(m) * 1e9 / (PKT * 8)) / 1e6;
    const bar = (label, pct, c) => `<div class="lv-hb"><span class="mono">${label}</span><div><i style="width:${Math.max(1, pct)}%;background:${c || "#59b4f5"}"></i></div><span class="mono muted">${Math.round(pct)}%</span></div>`;
    function execBh(echo) {
      if (S.bh != null) return;
      S.bh = S.t; if (echo) term(`admin@${DEV}> set routing-options static route ${VICTIM}/32 discard\n[edit]\nadmin@${DEV}> commit\ncommit complete`);
      addLog(`블랙홀 차단 (${VICTIM}/32)`, true); if (!S.done.way) { S.choice = "블랙홀"; S.done.way = S.t; } if (S.upstream != null) mark("act"); else todo(); paint();
    }
    function reqUp() { if (S.bh == null || S.upstream != null) return; S.upstream = S.t; addLog("상위 연동망에 블랙홀 요청 (65535:666)", true); mark("act"); }
    const DUE_H = 48;   // 블랙홀은 바로 풀지 않고 24~48시간 유지한 뒤 푼다 (현장 원칙). 이 시나리오는 48시간 뒤로 알림을 설정한다
    const dueOf = () => parseT("2026-10-29T" + fmt(S.t)) + DUE_H * 3600000;
    const dueStr = ms => `${ymdhm(ms).slice(5, 10).replace("-", "/")} ${ymdhm(ms).slice(11)}`;
    function check() {   // 블랙홀을 걸면 공격이 버려져 링크가 평소로 돌아온다. 링크 in이 평소 범위로 돌아온 것을 확인하면 안정화로 본다 (공격이 끝나기를 기다리지 않는다)
      const m = cur(), v = valueIn(m);
      if (S.bh == null || S.checked != null) return;
      if (v >= 5) { addLog(`정상화 확인: 링크 in이 아직 평소 범위가 아님 (${gb(v)}G)`); E("lvSendMsg").textContent = `링크 in이 아직 평소 범위가 아닙니다 (${gb(v)}G). 블랙홀이 적용되기까지 1~2분 걸립니다. 잠시 뒤 다시 확인하세요`; return; }
      S.checked = S.t; addLog("정상화 확인 · 링크 in 평소 범위 복귀 (블랙홀로 공격이 버려지는 중, 블랙홀은 24~48시간 유지)", true); todo(); fill();
    }
    function setReminder() {
      if (!done("fin") || S.rem != null) return;
      const due = dueOf(), all = store.get("reminders", []).filter(x => x.key !== "ddos:" + VICTIM);
      all.push({ key: "ddos:" + VICTIM, what: "블랙홀 해제 확인", detail: `${VICTIM}/32 · ${DEV}`, set: parseT("2026-10-29T" + fmt(S.t)), due });
      store.set("reminders", all); S.rem = due; if (typeof renderTasks === "function") renderTasks(); addLog(`블랙홀 해제 알림 설정 (${dueStr(due)}, ${DUE_H}시간 뒤)`); mark("rem"); finish();
    }
    return {
      id: "ddos", name: "DDoS 공격 수신", clock0: 180, date: "10/29", start: ONSET - 2, end: 60, alertAt: ALERT, deadline: 8, stages: ["발생", "경과", "완료"], speedNote: true,
      linkTitle: `${UPL} · in`, linkDesc: "분당→서초 B · 100G · 점선=어제 같은 시각", dev: DEV, termQuick: [["속도 확인", 'show interfaces xe-0/0/1 extensive | match "bps|pps"'], ["경로 확인", `show route ${VICTIM}`]],
      cardTitle: "공격 트래픽 구성", cardSave: true,
      init: () => ({ bh: null, rel: null, checked: null, rem: null, upstream: null, choice: null, victim: false, event: false, pending: false, saved: null, early: false, wait: false }),
      sub: () => alerted() ? `알림 ${fmt(ALERT)}${S.ack != null ? ` · 내가 확인 ${fmt(S.ack)}` : ""}` : "정상 감시 중",
      intro: `가상 장비 ${DEV} (juniper)에 연결됨. 실제 장비가 아닙니다. help를 입력하면 명령이 나옵니다.`,
      chart() {
        const W = 760, H = 168, L = 36, B = 16, T = 6, R = 6, cap = 12, n = 60, upto = cur();
        const x = m => L + (W - L - R) * m / n, y = v => T + (H - T - B) * (1 - v / cap);
        let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${UPL} in 그래프">`;
        for (const v of [0, 6, 12]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#26323d"/><text x="${L - 5}" y="${y(v) + 3}" fill="#7b8a98" font-size="10" text-anchor="end">${v}G</text>`;
        for (const m of [0, 20, 40, 60]) g += `<text x="${x(m)}" y="${H - 3}" fill="#7b8a98" font-size="10" text-anchor="${m === 60 ? "end" : "middle"}">${fmt(m)}</text>`;
        const ref = []; for (let m = 0; m <= n; m++) ref.push(`${x(m)},${y(3.3 + Math.sin(m / 6) * 0.1)}`);
        g += `<polyline fill="none" stroke="#3b4f61" stroke-width="1.2" stroke-dasharray="3 3" points="${ref.join(" ")}"/>`;
        const pts = []; for (let m = 0; m <= upto; m++) pts.push(`${x(m)},${y(Math.min(cap, valueIn(m)))}`);
        const hot = valueIn(upto) > 6;
        g += `<polyline fill="none" stroke="${hot ? "#ff8f84" : "#59b4f5"}" stroke-width="2" points="${pts.join(" ")}"/><circle cx="${x(upto)}" cy="${y(Math.min(cap, valueIn(upto)))}" r="3.5" fill="${hot ? "#ff8f84" : "#59b4f5"}"/>`;
        if (upto >= ONSET) g += `<line x1="${x(ONSET)}" x2="${x(ONSET)}" y1="${T}" y2="${H - B}" stroke="#e8a23b" stroke-dasharray="3 3"/><text x="${x(ONSET) + 3}" y="${T + 10}" fill="#e8a23b" font-size="10">급증 시작</text>`;
        if (S.bh != null && S.bh <= S.t) g += `<line x1="${x(S.bh)}" x2="${x(S.bh)}" y1="${T}" y2="${H - B}" stroke="#47c28b" stroke-dasharray="3 3"/><text x="${x(S.bh) + 3}" y="${T + 22}" fill="#47c28b" font-size="10">블랙홀 ${fmt(S.bh)}</text>`;
        const v = valueIn(upto); return { svg: g + "</svg>", now: `${gb(v)}G`, bad: v > 6 };
      },
      alertBar() {
        const m = cur(), v = valueIn(m), back = S.bh != null && m >= ATK_END + 2 && v < 5;
        if (!alerted()) return ["idle", '● 알림 없음 · 정상 감시 중 <span class="muted">(급증이 기준을 넘고 1~3분이 지나야 알림이 뜹니다)</span>'];
        if (back) return ["ok", `● ${UPL} 정상 범위로 복귀 <span class="muted">${fmt(m)} · in ${gb(v)}G · 블랙홀은 유지 중 (24~48시간 뒤 해제)</span>`];
        return ["hot", `<span class="lv-dot"></span>${UPL} in 급증 감지 <span class="muted">${fmt(ALERT)} · 급증 시작 ${fmt(ONSET)} · 지연 ${ALERT - ONSET}분 · 평소 3.3G → ${gb(v)}G</span>` +
          (S.ack == null ? `<button class="btn" id="lvAck" type="button">확인하기</button>` : `<span class="muted" style="margin-left:auto">내가 확인 ${fmt(S.ack)}</span>`)];
      },
      card() {
        const m = cur();
        if (S.ack == null) return { sub: "", html: '<p class="muted lv-empty">알림을 확인하면 공격 트래픽 구성이 표시됩니다.</p>' };
        const atk = atkRaw(m);
        if (atk < 0.1) return { sub: `${fmt(m)} 기준`, html: '<p class="muted lv-empty">지금 들어오는 공격 트래픽이 없습니다.</p>' };
        const w = k => (noise(m * 3 + k) - 0.5) * 3, a = 22 + w(1), b = 14 + w(2), c = 9 + w(3), o = 100 - a - b - c, syn = 95 + w(4) * 0.3, n = 4200 + Math.round((Math.min(m, ATK_END) - ONSET) * 60), gone = discarded(m);
        return {
          sub: `${fmt(m)} 기준 · 유입 ${gb(atk)}Gbps (${(atk * 1e9 / (PKT * 8) / 1e6).toFixed(1)}Mpps)${gone > 0.05 ? ` · 블랙홀로 버려지는 양 ${gb(gone)}Gbps` : ""} · 출발지 ${n.toLocaleString()}개`,
          html: `<div class="lv-3"><div><div class="muted lv-h">출발지 대역 (상위)</div>${bar("203.0.113.0/24", a, "#e8a23b")}${bar("192.0.2.0/24", b, "#e8a23b")}${bar("203.0.114.0/24", c, "#e8a23b")}${bar("그 밖 " + Math.round(n * 0.99).toLocaleString() + "개", o, "#2b4358")}</div>
      <div><div class="muted lv-h">프로토콜 · 플래그</div>${bar("TCP SYN", syn, "#ff8f84")}${bar("TCP ACK", 3)}${bar("UDP", 1)}${bar("기타", 1)}</div>
      <div><div class="muted lv-h">목적지 포트 · 패킷 크기</div>${bar("443", 91)}${bar("80", 6)}${bar("패킷 60~80B", 93)}${bar("패킷 1000B+", 2)}</div></div>`
        };
      },
      save() {
        if (S.ack == null) { E("lvSendMsg").textContent = "알림을 먼저 확인하세요"; return; }
        const m = cur(), atk = atkRaw(m); if (atk < 0.1) { E("lvSendMsg").textContent = "저장할 공격 트래픽이 없습니다"; return; }
        const all = store.get("live:records", []); const rec = { id: all.length + 1, m, at: fmt(m), atk: +gb(atk), top: "203.0.113.0/24, 192.0.2.0/24, 203.0.114.0/24", proto: "TCP SYN 95%", port: "443 91%" };
        all.push(rec); store.set("live:records", all); S.saved = rec; addLog(`공격 트래픽 구성을 사건 기록 #${rec.id}로 저장`);
        E("lvSaved").hidden = false; E("lvSaved").textContent = `저장됨 ${rec.at} · 사건 기록 #${rec.id}`; E("lvSave").textContent = "다시 저장"; fill();
      },
      rows() {
        const can = S.ack != null;
        return [
          ["ev", "이벤트 일정인지 확인", done("ev") ? `일정 없음 (${fmt(S.done.ev)})` : "일정에 없으면 이상 징조입니다", done("ev") ? "" : `<button class="btn sm" data-a="ev" ${can ? "" : "disabled"}>일정 조회</button>`],
          ["ip", "대상·유형·공격량 파악", done("ip") ? `가상물산 ${VICTIM} · TCP · ${gb(atkRaw(Math.max(ONSET + 2, Math.min(S.done.ip, ATK_END - 1))))} Gbps (${fmt(S.done.ip)})` : "누구 IP로 오는지 조회하고, 구성 카드의 값을 봅니다", done("ip") ? "" : `<button class="btn sm" data-a="ip" ${can ? "" : "disabled"}>${VICTIM} 누구 IP?</button>`],
          ["sms", "발생 문자 보내기", done("sms") ? `발송 ${fmt(S.done.sms)} (알림 후 ${Math.round(S.done.sms - ALERT)}분)` : `알림 후 ${SC.deadline}분 안에 보냅니다`, ""],
          ["way", "차단 방법 판단", done("way") ? `블랙홀 선택 (${fmt(S.done.way)})` : "클린존 가입 여부에 따라 달라집니다",
            done("way") ? "" : `<span class="lv-opts"><button class="btn sm" data-a="clean" ${can ? "" : "disabled"}>클린존 우회</button><button class="btn sm" data-a="bh" ${can ? "" : "disabled"}>블랙홀</button><button class="btn sm" data-a="wait" ${can ? "" : "disabled"}>더 지켜보기</button></span>`],
          ["act", "차단 실행 · 상위 연동망 요청", done("act") ? `차단 ${fmt(S.bh)} · 요청 ${fmt(S.upstream)}` : "블랙홀 명령을 넣고 상위 연동망에 요청합니다",
            done("act") ? "" : `<span class="lv-opts"><button class="btn sm" data-a="exec" ${can && S.bh == null ? "" : "disabled"}>블랙홀 실행 (가상)</button><button class="btn sm" data-a="up" ${S.bh != null && S.upstream == null ? "" : "disabled"}>연동망 요청</button></span>`],
          ["fin", "정상화 확인 · 완료 문자", done("fin") ? `완료 문자 ${fmt(S.done.fin)} (블랙홀은 유지)` : S.checked != null ? "링크가 평소로 돌아온 것을 확인했습니다. 바로 완료 문자를 보냅니다 (블랙홀은 그대로 둡니다)" : "블랙홀을 걸면 공격이 버려져서 링크가 곧 평소로 돌아옵니다. 링크 in이 평소 범위로 돌아온 것을 확인하면 안정화로 보고 바로 완료 문자를 보냅니다. 공격이 끝나기를 기다리지 않고, 블랙홀은 24~48시간 유지합니다",
            done("fin") || S.checked != null ? "" : `<button class="btn sm" data-a="check" ${S.bh != null ? "" : "disabled"}>정상화 확인</button>`],
          ["rem", `블랙홀 해제 알림 설정 (${DUE_H}시간 뒤)`, done("rem") ? `설정함 · ${dueStr(S.rem)} 해제 예정 (알림 > 내 업무에서 확인)` : `블랙홀은 24~48시간 뒤에 풉니다. 해제할 때가 되면 알림을 받도록 설정합니다. 설정하면 알림(종 모양)의 "내 업무"에서 확인해 보실 수 있습니다. 해제하기 전에는 공격이 끝났는지, 같은 고객의 다른 IP로 옮겨 가지 않았는지 확인합니다`,
            done("rem") ? "" : `<button class="btn sm" data-a="rem" ${done("fin") ? "" : "disabled"}>${DUE_H}시간 뒤 알림 설정</button>`]
        ];
      },
      act(a) {
        if (a === "ev") { S.event = true; addLog("이벤트 일정 조회 → 해당 시간 일정 없음"); mark("ev"); }
        else if (a === "ip") { S.victim = true; addLog(`${VICTIM} 조회 → 가상물산 (클린존 미가입, 가정)`); mark("ip"); paint(); }
        else if (a === "clean") { S.victim = true; addLog("클린존 우회 시도 → 가상물산은 미가입이라 불가 (가정)"); E("lvSendMsg").textContent = "가상물산은 클린존 미가입이라 우회할 수 없습니다 (제가 정한 가정)"; todo(); }
        else if (a === "wait") { S.wait = true; addLog("더 지켜보기 선택"); E("lvSendMsg").textContent = "지켜보는 동안에도 시간은 흐르고 공격은 이어집니다"; }
        else if (a === "bh") { S.choice = "블랙홀"; addLog("차단 방법: 블랙홀 선택"); mark("way"); }
        else if (a === "exec") execBh(true);
        else if (a === "up") reqUp();
        else if (a === "check") check();
        else if (a === "rem") setReminder();
      },
      draft(stage) {
        const m = cur(), atk = S.bh != null && S.rel == null && atkRaw(m) > 0 ? atkRaw(m) : atkRaw(Math.min(m, ATK_END - 1)), acts = S.log.filter(x => x.act).map(x => ({ t: fmt(x.m), txt: x.text }));
        const cause = (stage === "발생" ? "국제망 DDoS 공격 (확인 중)" : "국제망 DDoS 공격") + (S.saved && stage !== "발생" ? ` · 출발지 상위 ${S.saved.top.split(", ")[0]} 등` : "");
        const impact = stage === "발생" ? "파악중" : stage === "경과" ? (S.bh != null && S.rel == null ? "일부 IP 접속 영향 (대상 IP 블랙홀 중)" : "파악중") : (S.bh != null ? `일부 IP 접속 영향 (대상 IP 블랙홀 ${fmt(S.bh)}부터 유지 중, 24~48시간 뒤 해제 예정)` : "영향 없음");
        return smsNotice({ stage, center: "분당", title: "DDoS 공격 수신", target: `${DEV}(10.0.0.1)`, from: `10/29 ${fmt(ONSET)}`, to: stage === "완료" ? `10/29 ${fmt(S.t)}` : "", cause, attack: `TCP (${gb(atk)} Gbps / ${(atk * 1e9 / (PKT * 8) / 1e6).toFixed(1)} Mpps)`, actions: stage === "발생" ? [] : acts, impact, voc: stage === "발생" ? "파악중" : "없음" });
      },
      stageOk: st => ({ 발생: true, 경과: done("sms"), 완료: S.checked != null })[st],
      onSend(st) { if (st === "발생") mark("sms"); else if (st === "완료") mark("fin"); else todo(); },
      run(c) {
        const m = cur(), pk = Math.round(mpps(m) * 1e6), bps = Math.round(valueIn(m) * 1e9);
        if (/^show interfaces xe-0\/0\/1 extensive \| match "?bps\|pps"?$/.test(c)) return `  Input rate     : ${bps} bps (${pk} pps)\n  Output rate    : ${Math.round(3.3e9)} bps (${Math.round(3.3e9 / 800 / 8)} pps)`;
        if (c === `show route ${VICTIM}`) return S.bh != null && (S.rel == null || m < S.rel) ? `${VICTIM}/32 *[Static/5] ${fmt(S.bh)}, metric 0\n                    Discard` : `${VICTIM}/32 *[BGP/170] 00:${pad(Math.max(0, m - 17))}:52, localpref 100\n                    > to 10.0.0.2 via xe-0/0/1.0   → ${UPL}`;
        if (/^set routing-options static route 198\.51\.100\.77\/32 discard$/.test(c)) { S.pending = true; return "[edit]"; }
        if (c === "commit") { if (S.pending) { S.pending = false; execBh(false); } return "commit complete"; }
        if (c === "help" || c === "?") return '사용할 수 있는 명령:\n  show interfaces xe-0/0/1 extensive | match "bps|pps"\n  show route ' + VICTIM + '\n  set routing-options static route ' + VICTIM + '/32 discard  (이어서 commit)';
        return "                     ^\nunknown command.";
      },
      finishRows() {
        const used = S.done.sms != null ? S.done.sms - ALERT : null, ackd = S.ack != null ? S.ack - ALERT : null;
        return [
          ["알림 → 내가 확인", ackd == null ? "확인 안 함" : `${ackd.toFixed(1)}분`],
          ["알림 → 발생 문자", used == null ? "안 보냄" : `${used.toFixed(1)}분 (${used <= SC.deadline ? "기한 8분 안" : "기한 초과"})`],
          ["알림 → 차단", S.bh == null ? "차단 안 함" : `${(S.bh - ALERT).toFixed(1)}분`],
          ["블랙홀", S.bh == null ? "-" : `${fmt(S.bh)}부터 유지 중 (바로 풀지 않고 24~48시간 유지)`],
          ["클린존 가입 확인", S.victim ? "확인함" : "확인 안 함 (차단 전에 확인하는 순서입니다)"],
          ["서비스영향 문구", "일부 IP 접속 영향 (블랙홀 대상 IP 1개). 서비스영향은 문제가 있을 때만 적습니다 (고객 전화·다운 등)"],
          ["블랙홀 해제 알림", S.rem ? `${dueStr(S.rem)}에 해제 확인 (알림 > 내 업무)` : "설정 안 함 (해제 시점을 놓칠 수 있습니다)"],
          ["사건 기록 저장", S.saved ? `#${S.saved.id} 저장함` : "안 함 (끝난 뒤에는 값을 다시 볼 수 없습니다)"],
          ["문자 순서", `발생${S.sent.경과 != null ? " → 경과" : ""} → 완료`]
        ];
      },
      auto: {
        trigger: `${UPL} in이 평소(약 3.3G)의 2배를 넘으면 급증으로 보고, 3분 뒤 알림이 뜨면 바로 시작합니다. (기준 값은 제가 정한 가정)`,
        guards: ["이벤트 일정이 있는 시간이면 차단하지 않고 사람에게 넘김", "클린존 가입 고객사면 블랙홀 대신 우회", "블랙홀은 공격받는 IP 1개(/32)에만 적용", "링크가 평소 범위로 돌아온 것을 확인하기 전에는 완료 문자를 보내지 않음", "블랙홀은 스스로 풀지 않고, 48시간 뒤 사람에게 해제 알림만 남김"],
        limit: "블랙홀을 걸면 그 IP의 정상 접속도 함께 끊깁니다. 실제 현장이라면 이 단계만큼은 사람 확인을 거치게 둘지 정해야 합니다. 여기서는 규칙이 끝까지 가는 모습을 보여 드리려고 자동으로 두었습니다.",
        steps: {
          ev: { rule: "알림 수신 → 이벤트 일정 조회", tool: "이벤트 일정표 조회", why: () => "10/29 03시대에 일정 없음 → 정상 증가가 아님" },
          ip: { rule: "일정 없음 → 대상 IP의 고객사·공격량 조회, 구성을 기록에 저장", tool: "IP 대장 조회 · 트래픽 구성 통계", why: () => `${VICTIM} = 가상물산 · TCP SYN 95% · ${gb(atkRaw(cur()))} Gbps`, after: () => SC.save() },
          sms: { rule: "대상 파악 완료 → 발생 문자 (기한 8분)", tool: "문자 양식 자동 채움 · 발송", why: () => `알림 후 ${(S.done.sms - ALERT).toFixed(1)}분에 발송 (기한 8분)` },
          way: { rule: "클린존 가입 → 우회 / 미가입 → 블랙홀", tool: "클린존 가입 명단 조회", pick: () => ["bh"], why: () => "가상물산은 클린존 미가입 (가정) → 블랙홀" },
          act: { rule: "블랙홀로 결정 → 장비에 /32 discard 설정 → 상위 연동망에 요청", tool: "장비 명령 (set … discard, commit) · 연동망 요청", why: () => `차단 ${fmt(S.bh)}${S.upstream != null ? ` · 연동망 요청 ${fmt(S.upstream)}` : ""}`, mid: true },
          fin: { rule: "링크 in이 5G 아래로 내려옴 → 정상화 확인 → 완료 문자", tool: "그래프 값 읽기 · 문자 발송", ready: () => S.checked != null || valueIn(cur()) < 5, waitText: "블랙홀이 적용되어 링크가 평소로 돌아오기를 기다리는 중", why: () => `링크 in ${gb(valueIn(cur()))}G (평소 범위) 확인 후 완료 문자` },
          rem: { rule: "완료 문자 발송 → 48시간 뒤 해제 알림 등록", tool: "알림(내 업무) 등록", why: () => "블랙홀은 24~48시간 유지한 뒤 사람이 풉니다" }
        }
      },
      note: "가상 시나리오의 결과입니다. 기준(8분 등)은 현장에서 들은 값이고, 클린존·차단 절차는 제가 정한 가정입니다."
    };
  })();

  /* ---------- 업링크 회선 다운 (사이트의 실제 가상 데이터를 그대로 사용) ---------- */
  SCEN.linkDown = (() => {
    const ID = "IDC_A_FS1_UP1", DV = "IDC_A_FS1", PORT = "xe-0/0/0", WIN0 = "2026-10-21T14:00", END = 60, START = 10, DEADLINE = 8;
    const t0 = () => parseT(WIN0), L = () => LINK[ID];
    const idxAt = ms => Math.floor((ms - T0) / STEP);
    const rawVal = mm => L().out[idxAt(t0() + Math.floor(mm) * 60000)];
    let rS = 20, rE = 50;   // 실제 데이터에서 다운이 시작·끝나는 분
    for (let m = 0; m <= 90; m++) { if (rawVal(m) < 3) { rS = m; break; } }
    for (let m = rS + 1; m <= 90; m++) { if (rawVal(m) > 10) { rE = m; break; } }
    const dS = rS, len = Math.round((rE - rS) * 2 / 3), dE = dS + len, ALERT = dS + 3;   // 복구까지 기다리는 시간을 2/3로 줄였다 (실제 데이터의 다운 구간을 압축)
    const dm = m => m <= dS ? m : (m <= dE ? dS + (m - dS) * 1.5 : m + (rE - rS - len));   // 가상 분 → 실제 데이터 분
    const val = m => rawVal(dm(m));
    const prev = m => L().out[idxAt(t0() + Math.floor(dm(m)) * 60000) - PER_DAY];
    const iso = m => isoLocal(t0() + Math.floor(dm(m)) * 60000);
    const CAUSE = {
      work: { name: "상대 구간 작업", cause: "상대 센터(IDC_S_FS1) 구간 작업", act: "상대 구간 작업 종료로 자동 복구", noc: "있음 · 상대 센터(IDC_S_FS1) 포트 점검 작업을 진행했고, 사전 공지가 빠졌습니다. 끝나면 연결이 자동 복구됩니다", seg: "없음", sec: "없음" },
      transient: { name: "일시적인 오류", cause: "일시적인 회선 오류 (원인 미상)", act: "자동 복구 후 재발 감시", noc: "없음 · 작업 이력이 없습니다", seg: "없음 · 구간 이슈가 없습니다", sec: "없음" },
      fiber: { name: "광 케이블·SFP 고장", cause: "광 케이블·SFP 불량", act: "예비 SFP로 교체 (현장)", noc: "없음 · 상대 쪽 작업이 없습니다", seg: "없음", sec: "없음" }
    };
    const peerIp = () => { const f = findIf(DEV[DV], PORT); return f ? f[8] : "10.100.1.2"; };
    const inDown = m => m >= dS && m < dE;
    const runLive = (cmd, m) => { const out = runOn(DV, cmd, inDown(m) ? [PORT] : [], iso(m)); return out.split("\n").slice(1).join("\n"); };
    const cust = () => (typeof CUSTOMERS !== "undefined" ? CUSTOMERS.filter(c => (c.links || []).includes(ID)).map(c => c.name) : []);
    const CMDS = { ip: "show interfaces descriptions", opt: `show interfaces diagnostics optics ${PORT}`, crc: `show interfaces extensive ${PORT} | match CRC`, arp: `show arp | match ${PORT}`, ping: `ping ${peerIp()} rapid count 100` };
    const runShow = cmd => { term(`admin@${DV}> ${cmd}`); term(runLive(cmd, cur())); };
    return {
      id: "linkDown", name: "업링크 회선 다운", clock0: 14 * 60, date: "10/21", start: Math.max(0, dS - 2), end: END, alertAt: ALERT, deadline: DEADLINE, stages: ["발생", "경과", "완료"],
      linkTitle: `${ID} · out`, linkDesc: "안산 업링크 · 점선=전날 같은 시각", dev: DV,
      termQuick: [["회선 설명", CMDS.ip], ["광값", CMDS.opt], ["CRC", CMDS.crc], ["ARP", CMDS.arp], ["ping", CMDS.ping]],
      cardTitle: "영향 고객사 · 연동망 문의 결과", cardSave: false,
      init: opts => ({ cause: (opts && opts.cause) || "work", asked: {}, fix: null, viewed: {} }),
      sub: () => alerted() ? `알림 ${fmt(ALERT)}${S.ack != null ? ` · 내가 확인 ${fmt(S.ack)}` : ""}` : "정상 감시 중",
      intro: `가상 장비 ${DV} (juniper)에 연결됨. 실제 장비가 아닙니다. 명령 결과는 가상 시계의 현재 시각 기준으로 나옵니다.`,
      chart() {
        const W = 760, H = 168, Lm = 36, B = 16, T = 6, R = 6, n = END, upto = cur(), cap = Math.ceil(Math.max(...Array.from({ length: n + 1 }, (_, m) => Math.max(val(m), prev(m) || 0))) * 1.2 / 5) * 5;
        const x = m => Lm + (W - Lm - R) * m / n, y = v => T + (H - T - B) * (1 - v / cap);
        let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${ID} out 그래프">`;
        for (const v of [0, cap / 2, cap]) g += `<line x1="${Lm}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#26323d"/><text x="${Lm - 5}" y="${y(v) + 3}" fill="#7b8a98" font-size="10" text-anchor="end">${Math.round(v)}G</text>`;
        for (let m = 0; m <= n; m += 20) g += `<text x="${x(m)}" y="${H - 3}" fill="#7b8a98" font-size="10" text-anchor="middle">${fmt(m)}</text>`;
        const ref = []; for (let m = 0; m <= n; m++) ref.push(`${x(m)},${y(prev(m) || 0)}`);
        g += `<polyline fill="none" stroke="#3b4f61" stroke-width="1.2" stroke-dasharray="3 3" points="${ref.join(" ")}"/>`;
        const pts = []; for (let m = 0; m <= upto; m++) pts.push(`${x(m)},${y(val(m))}`);
        const bad = val(upto) < 3;
        g += `<polyline fill="none" stroke="${bad ? "#ff8f84" : "#59b4f5"}" stroke-width="2" points="${pts.join(" ")}"/><circle cx="${x(upto)}" cy="${y(val(upto))}" r="3.5" fill="${bad ? "#ff8f84" : "#59b4f5"}"/>`;
        if (upto >= dS) g += `<line x1="${x(dS)}" x2="${x(dS)}" y1="${T}" y2="${H - B}" stroke="#e8a23b" stroke-dasharray="3 3"/><text x="${x(dS) + 3}" y="${T + 10}" fill="#e8a23b" font-size="10">다운 시작 ${fmt(dS)}</text>`;
        if (upto >= dE) g += `<line x1="${x(dE)}" x2="${x(dE)}" y1="${T}" y2="${H - B}" stroke="#47c28b" stroke-dasharray="3 3"/><text x="${x(dE) + 3}" y="${T + 22}" fill="#47c28b" font-size="10">복구 ${fmt(dE)}</text>`;
        return { svg: g + "</svg>", now: `${gb(val(upto))}G`, bad };
      },
      alertBar() {
        const m = cur(), v = val(m);
        if (!alerted()) return ["idle", '● 알림 없음 · 정상 감시 중 <span class="muted">(값이 기준 아래로 떨어지고 1~3분이 지나야 알림이 뜹니다)</span>'];
        if (m >= dE && v > 10) return ["ok", `● ${ID} 복구됨 <span class="muted">${fmt(m)} · out ${gb(v)}G</span>`];
        return ["hot", `<span class="lv-dot"></span>${ID} in·out 급감 (거의 0) 감지 <span class="muted">${fmt(ALERT)} · 다운 시작 ${fmt(dS)} · 지연 ${ALERT - dS}분 · 전날 같은 시각 ${gb(prev(m) || 0)}G → ${gb(v)}G</span>` +
          (S.ack == null ? `<button class="btn" id="lvAck" type="button">확인하기</button>` : `<span class="muted" style="margin-left:auto">내가 확인 ${fmt(S.ack)}</span>`)];
      },
      card() {
        if (S.ack == null) return { sub: "", html: '<p class="muted lv-empty">알림을 확인하면 영향 고객사와 연동망 문의 결과가 표시됩니다.</p>' };
        const c = CAUSE[S.cause], row = (k, q, a) => `<tr><th>${q}</th><td>${S.asked[k] ? esc(a) : '<span class="muted">아직 문의 안 함</span>'}</td></tr>`;
        return {
          sub: "연동망(상대 센터)에 3가지를 문의합니다",
          html: `<div class="muted lv-h">영향 고객사 (이 회선을 쓰는 곳)</div><p style="margin:2px 0 8px">${cust().map(esc).join(" · ") || "-"}</p><table class="kv2">${row("noc", "NOC 작업 유/무", c.noc)}${row("seg", "연동 구간 작업·이슈", c.seg)}${row("sec", "보안 관련 이슈", c.sec)}</table>`
        };
      },
      rows() {
        const can = S.ack != null, n = Object.keys(S.asked).length, rec = cur() >= dE;
        const b = (a, label, en) => `<button class="btn sm" data-a="${a}" ${can && en !== false ? "" : "disabled"}>${label}</button>`;
        return [
          ["ip", "정확한 장비·회선 확인", done("ip") ? `${DV} ${PORT}: Admin up, Link down (${fmt(S.done.ip)})` : "descriptions로 Up/Down과 고객사를 봅니다", done("ip") ? "" : b("ip", "회선 설명 확인")],
          ["tr", "트래픽 전/후 확인", done("tr") ? `5분 전 ${gb(val(dS - 5))}G → 이후 ${gb(val(dS))}G (OUT 기준)` : "Down이면 5분 전 값만 보고 이후는 0으로 적습니다", done("tr") ? "" : b("tr", "그래프 값 읽기")],
          ["sms", "발생 문자 보내기", done("sms") ? `발송 ${fmt(S.done.sms)} (알림 후 ${Math.round(S.done.sms - ALERT)}분)` : `알림 후 ${DEADLINE}분 안에 보냅니다`, ""],
          ["opt", "광값·CRC 확인", done("opt") ? `광 수신 -40 dBm: 빛이 안 들어옴 (${fmt(S.done.opt)})` : "빛이 들어오는지, 오류가 있는지 봅니다", done("opt") ? "" : b("opt", "광값·CRC 확인")],
          ["ping", "IP 확인과 ping", done("ping") ? `ARP 없음, ping 100% 손실 (${fmt(S.done.ping)})` : "상대 IP까지 닿는지 봅니다", done("ping") ? "" : b("ping", "ARP·ping 확인")],
          ["ask", "연동망(상대 센터)에 문의", done("ask") ? `3가지 문의 완료 (${fmt(S.done.ask)})` : `NOC 작업 / 구간 작업·이슈 / 보안 이슈 (${n}/3)`,
            done("ask") ? "" : `<span class="lv-opts">${b("ask-noc", "NOC 작업 유/무", !S.asked.noc)}${b("ask-seg", "구간 작업·이슈", !S.asked.seg)}${b("ask-sec", "보안 이슈", !S.asked.sec)}</span>`],
          ["cause", "원인 판단과 조치", done("cause") ? `${S.fix === "교체" ? "현장 교체 요청" : "복구 대기·재확인"} (${fmt(S.done.cause)})` : "연동망 회신과 광값을 보고 정합니다",
            done("cause") ? "" : `<span class="lv-opts">${b("wait", "복구 대기·재확인", done("ask"))}${b("fix", "현장에 케이블·SFP 교체 요청", done("ask"))}</span>`],
          ["rec", "복구 확인", done("rec") ? `복구 확인 (${fmt(S.done.rec)})` : rec ? "그래프가 돌아왔습니다. 광값·ping으로 다시 확인합니다" : "그래프가 돌아오면 광값·ping을 다시 확인합니다", done("rec") ? "" : b("rec", "광값·ping 다시 확인", rec)],
          ["fin", "완료 문자 보내기", done("fin") ? `완료 문자 ${fmt(S.done.fin)}` : "복구를 확인한 뒤에만 완료로 보냅니다", ""]
        ];
      },
      act(a) {
        const m = cur();
        if (a === "ip") { runShow(CMDS.ip); addLog(`회선 확인 → ${DV} ${PORT} Admin up / Link down`); mark("ip"); }
        else if (a === "tr") { addLog(`트래픽 전/후: ${fmt(dS - 5)} ${gb(val(dS - 5))}G → ${fmt(dS)} ${gb(val(dS))}G`); mark("tr"); }
        else if (a === "opt") { runShow(CMDS.opt); runShow(CMDS.crc); addLog("광값 -40 dBm: 빛이 안 들어옴 (케이블·SFP 의심)"); mark("opt"); }
        else if (a === "ping") { runShow(CMDS.arp); runShow(CMDS.ping); addLog("ARP 없음, ping 100% 손실"); mark("ping"); }
        else if (a.startsWith("ask-")) {
          const k = a.slice(4), q = { noc: "NOC 작업 유/무", seg: "연동 구간 작업·이슈 유/무", sec: "보안 관련 이슈 유/무" }[k];
          S.asked[k] = true; addLog(`연동망 문의: ${q} → ${CAUSE[S.cause][k]}`, true);
          if (S.asked.noc && S.asked.seg && S.asked.sec) mark("ask"); else todo(); paint();
        }
        else if (a === "wait") { S.fix = "대기"; addLog("복구 대기·재확인 (연동망 회신 기준)", true); mark("cause"); }
        else if (a === "fix") { S.fix = "교체"; addLog("현장에 광 케이블·SFP 교체 요청", true); mark("cause"); }
        else if (a === "rec") {
          term(`admin@${DV}> ${CMDS.opt}`); term(runLive(CMDS.opt, m)); term(`admin@${DV}> ${CMDS.ping}`); term(runLive(CMDS.ping, m));
          addLog("복구 확인: 광값 정상, ping 0% 손실", true); mark("rec");
        }
      },
      draft(stage) {
        const c = CAUSE[S.cause], acts = S.log.filter(x => x.act).map(x => ({ t: fmt(x.m), txt: x.text }));
        const base = { stage, center: "안산", title: "업링크 회선 다운", target: `${DV} ${PORT} (${ID})`, from: `10/21 ${fmt(dS)}`, voc: "파악중" };
        if (stage === "발생") return smsNotice({ ...base, cause: "업링크 단선, 확인 중", impact: "파악중", actions: [] });
        if (stage === "경과") return smsNotice({ ...base, cause: S.done.cause ? c.cause : "업링크 단선, 연동망 확인 중", impact: "우회 경로로 서비스 유지 (확인 중)", voc: "없음", actions: acts });
        return smsNotice({ ...base, to: `10/21 ${fmt(S.done.rec != null ? S.done.rec : S.t)}`, cause: c.cause, impact: "우회 경로로 서비스 유지, 고객 영향 없음 (가상)", voc: "없음", actions: acts.concat([{ t: fmt(S.done.rec != null ? S.done.rec : S.t), txt: "회선 복구 확인", sub: [c.act] }]) });
      },
      stageOk: st => ({ 발생: true, 경과: done("sms"), 완료: done("rec") })[st],
      onSend(st) { if (st === "발생") mark("sms"); else if (st === "완료") { mark("fin"); finish(); } else todo(); },
      run(c) {
        if (c === "help" || c === "?") return "가상 장비 명령(Juniper 형식) 예: " + Object.values(CMDS).join(" / ");
        const out = runLive(c, cur()); return out;
      },
      finishRows() {
        const used = S.done.sms != null ? S.done.sms - ALERT : null, ackd = S.ack != null ? S.ack - ALERT : null, c = CAUSE[S.cause];
        const need = S.cause === "fiber";
        return [
          ["알림 → 내가 확인", ackd == null ? "확인 안 함" : `${ackd.toFixed(1)}분`],
          ["알림 → 발생 문자", used == null ? "안 보냄" : `${used.toFixed(1)}분 (${used <= DEADLINE ? "기한 8분 안" : "기한 초과"})`],
          ["연동망 문의 3가지", done("ask") ? "모두 함" : "다 하지 않음"],
          ["실제 원인", c.name],
          ["내 조치", S.fix === "교체" ? (need ? "현장 교체 요청 (맞음)" : "현장 교체 요청 (이번에는 불필요했음)") : (need ? "복구 대기 (이번에는 교체가 필요했음)" : "복구 대기 (맞음)")],
          ["다운 구간", `${fmt(dS)} ~ ${fmt(dE)} (${dE - dS}분)`],
          ["문자 순서", `발생${S.sent.경과 != null ? " → 경과" : ""} → 완료 (복구 확인 ${done("rec") ? "후" : "전"})`]
        ];
      },
      auto: {
        trigger: `${ID}(${DV} ${PORT})가 Link down이 되고 3분 뒤 알림이 뜨면 바로 시작합니다.`,
        guards: ["우리 쪽 확인(광값·CRC·ping)을 끝낸 뒤에만 연동망에 문의", "연동망 회신을 받기 전에는 원인을 정하지 않음", "장비 설정은 바꾸지 않음 (조회 명령만 실행)", "그래프가 돌아오고 광값·ping을 다시 확인하기 전에는 완료 문자를 보내지 않음"],
        limit: "일시적인 오류와 광 케이블·SFP 고장은 연동망 회신(모두 없음)과 광값(빛 없음)이 똑같이 나와서 규칙만으로는 구분하지 못합니다. 이럴 때는 안전한 쪽인 현장 교체 요청을 고릅니다.",
        steps: {
          ip: { rule: "알림 수신 → 어느 장비·회선인지 확인", tool: CMDS.ip, why: () => `${DV} ${PORT}: Admin up / Link down` },
          tr: { rule: "회선 확인 → 다운 전·후 트래픽 읽기", tool: "그래프 값 읽기", why: () => `${gb(val(dS - 5))}G → ${gb(val(dS))}G` },
          sms: { rule: "회선·트래픽 파악 완료 → 발생 문자 (기한 8분)", tool: "문자 양식 자동 채움 · 발송", why: () => `알림 후 ${(S.done.sms - ALERT).toFixed(1)}분에 발송 (기한 ${DEADLINE}분)` },
          opt: { rule: "발생 문자 뒤 → 광값·CRC 확인", tool: "show interfaces diagnostics optics / extensive", why: () => "광 수신 -40 dBm → 빛이 안 들어옴" },
          ping: { rule: "광값 확인 → ARP·ping 확인", tool: "show arp / ping", why: () => "ARP 없음, ping 100% 손실" },
          ask: { rule: "우리 쪽 확인 끝 → 연동망에 3가지 문의", tool: "연동망 문의 (가상 요청)", why: () => `NOC 작업: ${CAUSE[S.cause].noc.split(" · ")[0]} · 구간: ${CAUSE[S.cause].seg.split(" · ")[0]} · 보안: ${CAUSE[S.cause].sec.split(" · ")[0]}` },
          cause: { rule: "회신에 작업·이슈 있음 → 복구 대기 / 3가지 모두 없음 + 빛 없음 → 현장 교체 요청", tool: "회신 내용 + 광값으로 판단", pick: () => /^있음/.test(CAUSE[S.cause].noc) || /^있음/.test(CAUSE[S.cause].seg) ? ["wait"] : ["fix"], why: () => S.fix === "교체" ? "문의 3가지 모두 '없음'이고 빛이 안 들어옴 → 현장 교체 요청" : "상대 구간 작업이 있었음 → 끝나면 자동 복구되므로 대기", mid: true },
          rec: { rule: "그래프가 돌아옴 → 광값·ping 다시 확인", tool: "show interfaces diagnostics optics / ping", waitText: "회선이 복구되기를 기다리는 중", why: () => "광값 정상, ping 0% 손실" },
          fin: { rule: "복구 확인 → 완료 문자", tool: "문자 양식 자동 채움 · 발송", why: () => "복구를 확인한 뒤에 발송" }
        }
      },
      note: "가상 데이터(사이트의 안산 업링크 다운 구간)로 만든 결과입니다. 복구 원인과 문의 회신은 제가 만든 가상 사례입니다."
    };
  })();

  /* ---------- 트래픽 급감 (국내 연동 IX, 사이트의 실제 가상 데이터를 그대로 사용) ---------- */
  SCEN.drop = (() => {
    const ID = "IDC_B_FS2_IX1", INTL = "IDC_B_FS2_INTL1", DV = "IDC_B_FS2", PORT = "xe-0/0/2", WIN0 = "2026-10-23T19:50", START = 10, DEADLINE = 8, K = 2 / 3;
    const t0 = () => parseT(WIN0), L = () => LINK[ID], LI = () => LINK[INTL];
    const idxAt = ms => Math.floor((ms - T0) / STEP);
    const rawAt = (series, mm) => series[idxAt(t0() + Math.floor(mm) * 60000)];
    const rawPrev = (series, mm) => series[idxAt(t0() + Math.floor(mm) * 60000) - PER_DAY];
    let rS = 20, rE = 70;   // 실제 데이터에서 급감이 시작·끝나는 분
    for (let m = 0; m <= 90; m++) { if (rawAt(L().out, m) < 0.4 * rawPrev(L().out, m)) { rS = m; break; } }
    for (let m = rS + 1; m <= 90; m++) { if (rawAt(L().out, m) > 0.8 * rawPrev(L().out, m)) { rE = m; break; } }
    const dS = rS, len = Math.round((rE - rS) * K), dE = dS + len, END = dE + 25, ALERT = dS + 3;   // 복구까지 기다리는 시간을 2/3로 줄였다
    const dm = m => m <= dS ? m : (m <= dE ? dS + (m - dS) / K : m + (rE - rS - len));
    const val = m => rawAt(L().out, dm(m)), prev = m => rawPrev(L().out, dm(m)), intl = m => rawAt(LI().out, dm(m)), intlPrev = m => rawPrev(LI().out, dm(m));
    const iso = m => isoLocal(t0() + Math.floor(dm(m)) * 60000);
    const runLive = (cmd, m) => runOn(DV, cmd, [], iso(m)).split("\n").slice(1).join("\n");
    const cust = () => (typeof CUSTOMERS !== "undefined" ? CUSTOMERS.filter(c => (c.links || []).includes(ID)).map(c => c.name) : []);
    const CMDS = { ip: "show interfaces descriptions", opt: `show interfaces diagnostics optics ${PORT}`, crc: `show interfaces extensive ${PORT} | match CRC`, bgp: "show bgp summary" };
    const REPLY = { noc: "있음 · 상대 IX 사업자 장비 이상으로 복구 작업 중입니다", seg: "있음 · IX 구간에서 트래픽 일부가 빠지고 있습니다 (원인 확인 중)", sec: "없음 · 공격·보안 이슈는 없습니다" };
    const runShow = cmd => { term(`admin@${DV}> ${cmd}`); term(runLive(cmd, cur())); };
    const spark = (fn, cap, w, h, upto, color) => {
      const x = m => 4 + (w - 8) * m / END, y = v => 3 + (h - 6) * (1 - v / cap), pts = []; for (let m = 0; m <= upto; m++) pts.push(`${x(m)},${y(fn(m))}`);
      return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.8" points="${pts.join(" ")}"/></svg>`;
    };
    return {
      id: "drop", name: "트래픽 급감", clock0: 19 * 60 + 50, date: "10/23", start: Math.max(0, dS - 2), end: END, alertAt: ALERT, deadline: DEADLINE, stages: ["발생", "경과", "완료"],
      linkTitle: `${ID} · out`, linkDesc: "분당 국내 연동(IX) · 점선=전날 같은 시각", dev: DV,
      termQuick: [["회선 설명", CMDS.ip], ["광값", CMDS.opt], ["CRC", CMDS.crc], ["BGP 요약", CMDS.bgp]],
      cardTitle: "우회 회선 · 영향 고객사 · 연동망 문의 결과", cardSave: false,
      init: () => ({ asked: {}, notice: false }),
      sub: () => alerted() ? `알림 ${fmt(ALERT)}${S.ack != null ? ` · 내가 확인 ${fmt(S.ack)}` : ""}` : "정상 감시 중",
      intro: `가상 장비 ${DV} (juniper)에 연결됨. 실제 장비가 아닙니다. 명령 결과는 가상 시계의 현재 시각 기준으로 나옵니다.`,
      chart() {
        const W = 760, H = 168, Lm = 36, B = 16, T = 6, R = 6, n = END, upto = cur(), cap = Math.ceil(Math.max(...Array.from({ length: n + 1 }, (_, m) => Math.max(val(m), prev(m) || 0))) * 1.2 / 10) * 10;
        const x = m => Lm + (W - Lm - R) * m / n, y = v => T + (H - T - B) * (1 - v / cap);
        let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${ID} out 그래프">`;
        for (const v of [0, cap / 2, cap]) g += `<line x1="${Lm}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#26323d"/><text x="${Lm - 5}" y="${y(v) + 3}" fill="#7b8a98" font-size="10" text-anchor="end">${Math.round(v)}G</text>`;
        for (let m = 0; m <= n; m += 20) g += `<text x="${x(m)}" y="${H - 3}" fill="#7b8a98" font-size="10" text-anchor="middle">${fmt(m)}</text>`;
        const ref = []; for (let m = 0; m <= n; m++) ref.push(`${x(m)},${y(prev(m) || 0)}`);
        g += `<polyline fill="none" stroke="#3b4f61" stroke-width="1.2" stroke-dasharray="3 3" points="${ref.join(" ")}"/>`;
        const pts = []; for (let m = 0; m <= upto; m++) pts.push(`${x(m)},${y(val(m))}`);
        const bad = val(upto) < 0.5 * (prev(upto) || 1);
        g += `<polyline fill="none" stroke="${bad ? "#ff8f84" : "#59b4f5"}" stroke-width="2" points="${pts.join(" ")}"/><circle cx="${x(upto)}" cy="${y(val(upto))}" r="3.5" fill="${bad ? "#ff8f84" : "#59b4f5"}"/>`;
        if (upto >= dS) g += `<line x1="${x(dS)}" x2="${x(dS)}" y1="${T}" y2="${H - B}" stroke="#e8a23b" stroke-dasharray="3 3"/><text x="${x(dS) + 3}" y="${T + 10}" fill="#e8a23b" font-size="10">급감 시작 ${fmt(dS)}</text>`;
        if (upto >= dE) g += `<line x1="${x(dE)}" x2="${x(dE)}" y1="${T}" y2="${H - B}" stroke="#47c28b" stroke-dasharray="3 3"/><text x="${x(dE) + 3}" y="${T + 22}" fill="#47c28b" font-size="10">회복 ${fmt(dE)}</text>`;
        return { svg: g + "</svg>", now: `${gb(val(upto))}G`, bad };
      },
      alertBar() {
        const m = cur(), v = val(m), p = prev(m) || 0;
        if (!alerted()) return ["idle", '● 알림 없음 · 정상 감시 중 <span class="muted">(전날 같은 시각보다 크게 낮아지고 1~3분이 지나야 알림이 뜹니다)</span>'];
        if (m >= dE && v > 0.8 * p) return ["ok", `● ${ID} 회복됨 <span class="muted">${fmt(m)} · out ${gb(v)}G</span>`];
        return ["hot", `<span class="lv-dot"></span>${ID} out 급감 감지 <span class="muted">${fmt(ALERT)} · 급감 시작 ${fmt(dS)} · 지연 ${ALERT - dS}분 · 전날 같은 시각 ${gb(p)}G → ${gb(v)}G (평소의 ${Math.round(v / p * 100)}%)</span>` +
          (S.ack == null ? `<button class="btn" id="lvAck" type="button">확인하기</button>` : `<span class="muted" style="margin-left:auto">내가 확인 ${fmt(S.ack)}</span>`)];
      },
      card() {
        if (S.ack == null) return { sub: "", html: '<p class="muted lv-empty">알림을 확인하면 우회 회선과 영향 고객사, 연동망 문의 결과가 표시됩니다.</p>' };
        const m = cur(), row = (k, q) => `<tr><th>${q}</th><td>${S.asked[k] ? esc(REPLY[k]) : '<span class="muted">아직 문의 안 함</span>'}</td></tr>`;
        return {
          sub: `해외 연동 ${INTL} out ${gb(intl(m))}G (전날 같은 시각 ${gb(intlPrev(m) || 0)}G)`,
          html: `<div class="lv-2"><div><div class="muted lv-h">${INTL} out (해외 연동)</div>${spark(intl, Math.ceil(Math.max(...Array.from({ length: END + 1 }, (_, k) => intl(k))) * 1.15 / 10) * 10, 300, 70, m, "#e8a23b")}<div class="muted lv-h" style="margin-top:6px">영향 고객사 (이 회선을 쓰는 곳)</div><div>${cust().map(esc).join(" · ") || "-"}</div></div>
          <div><div class="muted lv-h">상대 IX 사업자에 문의한 결과</div><table class="kv2">${row("noc", "NOC 작업 유/무")}${row("seg", "연동 구간 작업·이슈")}${row("sec", "보안 관련 이슈")}</table></div></div>`
        };
      },
      rows() {
        const can = S.ack != null, n = Object.keys(S.asked).length, rec = cur() >= dE, m = cur();
        const b = (a, label, en) => `<button class="btn sm" data-a="${a}" ${can && en !== false ? "" : "disabled"}>${label}</button>`;
        return [
          ["ev", "이벤트(경기) 일정인지 확인", done("ev") ? `일정 없음 → 경기 하프타임 같은 정상 하락이 아님 (${fmt(S.done.ev)})` : "경기 일정이 있으면 급감이 아닐 수 있습니다", done("ev") ? "" : b("ev", "일정 조회")],
          ["tr", "급감 정도 확인", done("tr") ? `전날 같은 시각 ${gb(prev(dS) || 0)}G → ${gb(val(dS))}G (평소의 ${Math.round(val(dS) / (prev(dS) || 1) * 100)}%)` : "그래프 값을 전날과 비교해 읽습니다", done("tr") ? "" : b("tr", "그래프 값 읽기")],
          ["intl", "우회 확인", done("intl") ? `해외 연동 ${gb(intlPrev(dS) || 0)}G → ${gb(intl(Math.min(m, dE - 1)))}G 증가: 빠진 트래픽 일부가 우회 중 (${fmt(S.done.intl)})` : "빠진 트래픽이 다른 회선으로 갔는지 봅니다", done("intl") ? "" : b("intl", "해외 연동 회선 보기")],
          ["opt", "우리 쪽 포트 광값·CRC 확인", done("opt") ? `광 수신 정상 범위, CRC 증가 없음 → 우리 쪽 문제는 아님 (${fmt(S.done.opt)})` : "우리 쪽 광 문제인지 먼저 확인합니다", done("opt") ? "" : b("opt", "광값·CRC 확인")],
          ["sms", "발생 문자 보내기", done("sms") ? `발송 ${fmt(S.done.sms)} (알림 후 ${Math.round(S.done.sms - ALERT)}분)` : `알림 후 ${DEADLINE}분 안에 보냅니다`, ""],
          ["ask", "상대 IX 사업자에 문의", done("ask") ? `3가지 문의 완료 (${fmt(S.done.ask)})` : `NOC 작업 / 구간 작업·이슈 / 보안 이슈 (${n}/3)`,
            done("ask") ? "" : `<span class="lv-opts">${b("ask-noc", "NOC 작업 유/무", !S.asked.noc)}${b("ask-seg", "구간 작업·이슈", !S.asked.seg)}${b("ask-sec", "보안 이슈", !S.asked.sec)}</span>`],
          ["notice", "영향 고객사에 상황 안내", done("notice") ? `${cust().join("·") || "고객사"}에 안내 (${fmt(S.done.notice)})` : "연동망 회신을 받은 뒤 고객사에 알립니다", done("notice") ? "" : b("notice", "고객사에 안내", done("ask"))],
          ["rec", "회복 확인", done("rec") ? `회복 확인 (${fmt(S.done.rec)})` : rec ? "그래프가 돌아왔습니다. 광값과 우회 회선도 다시 확인합니다" : "그래프가 돌아오면 다시 확인합니다", done("rec") ? "" : b("rec", "그래프·광값 다시 확인", rec)],
          ["fin", "완료 문자 · 복구 안내", done("fin") ? `완료 문자 ${fmt(S.done.fin)}` : "회복을 확인한 뒤에만 완료로 보냅니다", ""]
        ];
      },
      act(a) {
        const m = cur();
        if (a === "ev") { addLog("이벤트 일정 조회 → 해당 시간 경기 일정 없음"); mark("ev"); }
        else if (a === "tr") { addLog(`급감 확인: 전날 같은 시각 ${gb(prev(dS) || 0)}G → ${gb(val(dS))}G`); mark("tr"); }
        else if (a === "intl") { addLog(`해외 연동 ${INTL} 증가 확인 → 일부 우회 중`); mark("intl"); paint(); }
        else if (a === "opt") { runShow(CMDS.opt); runShow(CMDS.crc); addLog("우리 쪽 광값·CRC 정상 → 우리 쪽 문제 아님"); mark("opt"); }
        else if (a.startsWith("ask-")) {
          const k = a.slice(4), q = { noc: "NOC 작업 유/무", seg: "연동 구간 작업·이슈 유/무", sec: "보안 관련 이슈 유/무" }[k];
          S.asked[k] = true; addLog(`상대 IX 사업자 문의: ${q} → ${REPLY[k]}`, true);
          if (S.asked.noc && S.asked.seg && S.asked.sec) mark("ask"); else todo(); paint();
        }
        else if (a === "notice") { addLog(`영향 고객사(${cust().join("·")})에 상황 안내`, true); mark("notice"); }
        else if (a === "rec") { runShow(CMDS.opt); addLog("회복 확인: 그래프와 광값 정상, 우회 회선도 평소로 돌아옴", true); mark("rec"); }
      },
      draft(stage) {
        const acts = S.log.filter(x => x.act).map(x => ({ t: fmt(x.m), txt: x.text }));
        const base = { stage, center: "분당", title: "국내 연동(IX) 트래픽 급감", target: `${DV} ${PORT} (${ID})`, from: `10/23 ${fmt(dS)}`, voc: "파악중" };
        if (stage === "발생") return smsNotice({ ...base, cause: "국내 연동 트래픽 급감, 확인 중", impact: "해외 연동 회선으로 일부 우회 중 (확인 중)", actions: [] });
        if (stage === "경과") return smsNotice({ ...base, cause: S.done.ask ? "상대 IX 사업자 장비 이상 (복구 작업 중)" : "국내 연동 트래픽 급감, 상대 구간 확인 중", impact: "해외 연동으로 우회해 서비스 유지 (일부 구간 지연 가능)", voc: "없음", actions: acts });
        const t = fmt(S.done.rec != null ? S.done.rec : S.t);
        return smsNotice({ ...base, to: `10/23 ${t}`, cause: "상대 IX 사업자 장비 이상", impact: "해외 연동 우회로 서비스 유지, 고객 영향 없음 (가상)", voc: "없음", actions: acts.concat([{ t, txt: "회복 확인", sub: ["상대 IX 사업자 복구 작업 완료로 회복"] }]) });
      },
      stageOk: st => ({ 발생: true, 경과: done("sms"), 완료: done("rec") })[st],
      onSend(st) { if (st === "발생") mark("sms"); else if (st === "완료") { addLog("복구 안내 메일 발송 (가상)"); mark("fin"); finish(); } else todo(); },
      run(c) {
        if (c === "help" || c === "?") return "가상 장비 명령(Juniper 형식) 예: " + Object.values(CMDS).join(" / ");
        return runLive(c, cur());
      },
      finishRows() {
        const used = S.done.sms != null ? S.done.sms - ALERT : null, ackd = S.ack != null ? S.ack - ALERT : null;
        return [
          ["알림 → 내가 확인", ackd == null ? "확인 안 함" : `${ackd.toFixed(1)}분`],
          ["알림 → 발생 문자", used == null ? "안 보냄" : `${used.toFixed(1)}분 (${used <= DEADLINE ? "기한 8분 안" : "기한 초과"})`],
          ["경기 일정 확인", done("ev") ? "함 (급감과 경기 하락을 구분)" : "안 함 (하프타임 같은 정상 하락인지 먼저 봅니다)"],
          ["우회 확인", done("intl") ? "함" : "안 함"],
          ["우리 쪽 광값 확인", done("opt") ? "함 (우리 쪽 문제 아님)" : "안 함"],
          ["상대 IX 문의 3가지", done("ask") ? "모두 함" : "다 하지 않음"],
          ["고객사 안내", done("notice") ? "함" : "안 함"],
          ["급감 구간", `${fmt(dS)} ~ ${fmt(dE)} (${dE - dS}분)`],
          ["문자 순서", `발생${S.sent.경과 != null ? " → 경과" : ""} → 완료 (회복 확인 ${done("rec") ? "후" : "전"})`]
        ];
      },
      auto: {
        trigger: `${ID} 트래픽이 전날 같은 시각보다 크게 줄고, 3분 뒤 알림이 뜨면 바로 시작합니다. (기준 값은 제가 정한 가정)`,
        guards: ["경기 일정이 있는 시간이면 정상 하락일 수 있어 사람에게 넘김", "우리 쪽 광값·CRC를 먼저 확인한 뒤에만 상대 사업자에 문의", "회신을 받은 뒤에만 고객사에 안내", "장비 설정은 바꾸지 않음 (조회 명령만 실행)", "회복을 확인하기 전에는 완료 문자를 보내지 않음"],
        limit: "상대 사업자에게 묻고 답을 받는 일은 실제로는 전화·메신저라서 자동화하기 어렵습니다. 여기서는 가상 회신으로 대신했습니다.",
        steps: {
          ev: { rule: "알림 수신 → 경기 일정 조회", tool: "이벤트 일정표 조회", why: () => "해당 시간 경기 일정 없음 → 하프타임 같은 정상 하락이 아님" },
          tr: { rule: "일정 없음 → 전날 같은 시각과 비교", tool: "그래프 값 읽기", why: () => `전날 ${gb(prev(dS) || 0)}G → ${gb(val(dS))}G` },
          intl: { rule: "급감 확인 → 다른 회선으로 우회했는지 확인", tool: `${INTL} 그래프`, why: () => "해외 연동 회선이 늘어남 → 일부가 우회 중" },
          opt: { rule: "우회 확인 → 우리 쪽 포트 광값·CRC 확인", tool: "show interfaces diagnostics optics / extensive", why: () => "광값 정상, CRC 증가 없음 → 우리 쪽 문제 아님" },
          sms: { rule: "우리 쪽 확인 완료 → 발생 문자 (기한 8분)", tool: "문자 양식 자동 채움 · 발송", why: () => `알림 후 ${(S.done.sms - ALERT).toFixed(1)}분에 발송 (기한 ${DEADLINE}분)` },
          ask: { rule: "우리 쪽 문제 아님 → 상대 IX 사업자에 3가지 문의", tool: "상대 사업자 문의 (가상 요청)", why: () => `NOC 작업: ${REPLY.noc.split(" · ")[0]} · 구간: ${REPLY.seg.split(" · ")[0]} · 보안: ${REPLY.sec.split(" · ")[0]}` },
          notice: { rule: "회신 받음 → 영향 고객사에 상황 안내", tool: "고객사 연락처 조회 · 안내 메일", why: () => `${cust().join("·") || "영향 고객사"}에 안내`, mid: true },
          rec: { rule: "그래프가 돌아옴 → 광값·우회 회선 다시 확인", tool: "그래프 · show interfaces diagnostics optics", waitText: "상대 사업자 복구로 트래픽이 돌아오기를 기다리는 중", why: () => "그래프와 광값 정상, 우회 회선도 평소로 돌아옴" },
          fin: { rule: "회복 확인 → 완료 문자 · 복구 안내", tool: "문자·메일 발송", why: () => "회복을 확인한 뒤에 발송" }
        }
      },
      note: "가상 데이터(사이트의 국내 연동 급감 구간)로 만든 결과입니다. 상대 IX 사업자의 회신 내용은 제가 만든 가상 사례입니다."
    };
  })();

  /* ---------- 이중화로 무사히 넘기기 (장비 한 대가 꺼져도 짝 장비가 받는다, 사이트의 실제 가상 데이터) ---------- */
  SCEN.redundancy = (() => {
    const OUT = OUTAGES.find(o => o.dev === "IDC_B_FS7") || OUTAGES.find(o => o.dev !== "IDC_B_FS6"), D1 = OUT.dev, D2 = DEV[D1].partner, DEADLINE = 8, K = 2 / 3;
    const lu = DEV[D1].ifs.filter(f => f[10] && !f[11]), sumG = lu.reduce((q, f) => q + f[9], 0), custOn = [...new Set(lu.map(f => f[10].customer))];
    const rLinks = [...new Set(CUSTOMERS.filter(c => custOn.includes(c.name)).flatMap(c => c.links).filter(id => LINK[id] && codeOf(id) === codeOf(D1)))].slice(0, 3), MAIN = rLinks[0] || "IDC_B_FS1_UP2";
    const w0 = OUT.s - 30 * 60000, realMin = Math.round((OUT.e - OUT.s) / 60000), dS = 30, len = Math.round(realMin * K), dE = dS + len, ALERT = dS + 3, START = 20, END = dE + 12;
    const dm = m => m <= dS ? m : (m <= dE ? dS + (m - dS) / K : m + (realMin - len));   // 가상 분 → 실제 데이터 분 (복구까지 기다리는 시간을 2/3로 줄임)
    const idxAt = ms => Math.floor((ms - T0) / STEP);
    const outAtM = (id, m) => LINK[id].out[idxAt(w0 + Math.floor(dm(m)) * 60000)], prevAtM = (id, m) => LINK[id].out[idxAt(w0 + Math.floor(dm(m)) * 60000) - PER_DAY];
    const iso = m => isoLocal(w0 + Math.floor(dm(m)) * 60000);
    const off = m => m >= dS && m < dE;
    const runLive = (dev, cmd, m) => runOn(dev, cmd, [], iso(m)).split("\n").slice(1).join("\n");
    const clock0 = Math.floor((w0 % 86400000) / 60000), date = ymdhm(OUT.s).slice(5, 10).replace("-", "/");
    const hubIp = withTime(OUT.s + 20 * 60000, () => (DEV[D2].ifs.find(f => f[8] && f[5] === "up") || [])[8]);
    const CMDS = { desc: "show interfaces descriptions", ping: `ping ${hubIp} rapid count 100` };
    const runShow = (dev, cmd) => { setDev(dev); term(`admin@${dev}> ${cmd}`); term(runLive(dev, cmd, cur())); };
    const traffic = (a, b) => rLinks.map(id => `${id}: ${gb(outAtM(id, a))}G → ${gb(outAtM(id, b))}G (${((outAtM(id, b) / outAtM(id, a) - 1) * 100).toFixed(1)}%)`).join("\n");
    const why = OUT.why || "전원 이상";
    return {
      id: "redundancy", name: "이중화로 무사히 넘기기", clock0, date, start: Math.max(0, dS - 2), end: END, alertAt: ALERT, deadline: DEADLINE, stages: ["발생", "경과", "완료"],
      linkTitle: `${MAIN} · out`, linkDesc: `${D1}에 꽂힌 고객 회선 · 점선=전날 같은 시각`, dev: D1, devs: [D1, D2],
      termQuick: [["회선 설명", CMDS.desc], ["ping", CMDS.ping]],
      cardTitle: `짝 장비 상태 · ${D1} ↔ ${D2}`, cardSave: false,
      init: () => ({ dev: D1, replaced: false }),
      sub: () => alerted() ? `알림 ${fmt(ALERT)}${S.ack != null ? ` · 내가 확인 ${fmt(S.ack)}` : ""}` : "정상 감시 중",
      intro: `가상 장비에 연결됨. 실제 장비가 아닙니다. 위의 장비 버튼으로 ${D1}과 짝 장비 ${D2}를 오가며 확인할 수 있습니다.`,
      chart() {
        const W = 760, H = 168, Lm = 36, B = 16, T = 6, R = 6, n = END, upto = cur(), cap = Math.ceil(Math.max(...Array.from({ length: n + 1 }, (_, m) => Math.max(outAtM(MAIN, m), prevAtM(MAIN, m) || 0))) * 1.25 / 5) * 5;
        const x = m => Lm + (W - Lm - R) * m / n, y = v => T + (H - T - B) * (1 - v / cap);
        let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${MAIN} out 그래프">`;
        for (const v of [0, cap / 2, cap]) g += `<line x1="${Lm}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#26323d"/><text x="${Lm - 5}" y="${y(v) + 3}" fill="#7b8a98" font-size="10" text-anchor="end">${Math.round(v)}G</text>`;
        for (let m = 0; m <= n; m += 20) g += `<text x="${x(m)}" y="${H - 3}" fill="#7b8a98" font-size="10" text-anchor="middle">${fmt(m)}</text>`;
        const ref = []; for (let m = 0; m <= n; m++) ref.push(`${x(m)},${y(prevAtM(MAIN, m) || 0)}`);
        g += `<polyline fill="none" stroke="#3b4f61" stroke-width="1.2" stroke-dasharray="3 3" points="${ref.join(" ")}"/>`;
        const pts = []; for (let m = 0; m <= upto; m++) pts.push(`${x(m)},${y(outAtM(MAIN, m))}`);
        g += `<polyline fill="none" stroke="#59b4f5" stroke-width="2" points="${pts.join(" ")}"/><circle cx="${x(upto)}" cy="${y(outAtM(MAIN, upto))}" r="3.5" fill="#59b4f5"/>`;
        if (upto >= dS) g += `<line x1="${x(dS)}" x2="${x(dS)}" y1="${T}" y2="${H - B}" stroke="#e8a23b" stroke-dasharray="3 3"/><text x="${x(dS) + 3}" y="${T + 10}" fill="#e8a23b" font-size="10">${D1} 꺼짐 ${fmt(dS)}</text>`;
        if (upto >= dE) g += `<line x1="${x(dE)}" x2="${x(dE)}" y1="${T}" y2="${H - B}" stroke="#47c28b" stroke-dasharray="3 3"/><text x="${x(dE) + 3}" y="${T + 22}" fill="#47c28b" font-size="10">전원 복구 ${fmt(dE)}</text>`;
        return { svg: g + "</svg>", now: `${gb(outAtM(MAIN, upto))}G`, bad: false };
      },
      alertBar() {
        const m = cur();
        if (!alerted()) return ["idle", '● 알림 없음 · 정상 감시 중 <span class="muted">(장비가 꺼지고 1~3분이 지나야 알림이 뜹니다)</span>'];
        if (m >= dE + 3) return ["ok", `● ${D1} 정상 복귀 <span class="muted">${fmt(m)} · 이중화가 원래 상태로 돌아왔습니다</span>`];
        if (m >= dE) return ["warn", `● ${D1} 전원 복구 <span class="muted">${fmt(m)} · 이중화 복귀를 확인하세요</span>`];
        return ["hot", `<span class="lv-dot"></span>${D1} 응답 없음 (전원 꺼짐 의심) 감지 <span class="muted">${fmt(ALERT)} · 꺼진 시각 ${fmt(dS)} · 지연 ${ALERT - dS}분 · 서버실 경고</span>` +
          (S.ack == null ? `<button class="btn" id="lvAck" type="button">확인하기</button>` : `<span class="muted" style="margin-left:auto">내가 확인 ${fmt(S.ack)}</span>`)];
      },
      card() {
        if (S.ack == null) return { sub: "", html: '<p class="muted lv-empty">알림을 확인하면 짝 장비의 상태가 표시됩니다.</p>' };
        const m = cur(), st = (ok, t1, t2) => `<span class="tag ${ok ? "ok" : "bad"}">${ok ? t1 : t2}</span>`;
        return {
          sub: `고객 회선 ${lu.length}개 · 고객사 ${custOn.length}곳 · 합계 ${sumG}G`,
          html: `<table class="kv2"><tr><th>${D1} (${DEV[D1].rack})</th><td>${st(!off(m), "정상", "꺼짐")} 전원</td></tr><tr><th>${D2} (${DEV[D2].rack})</th><td>${st(true, "정상", "")} 고객 회선 ${lu.length}개를 받고 있음${off(m) ? " (한 대로 버티는 중)" : ""}</td></tr><tr><th>짝 연결(PAIR1)</th><td>${st(!off(m), "Up", "Down")} ${off(m) ? "꺼진 장비와 이어진 연결만 Down" : ""}</td></tr></table><p class="muted" style="margin:6px 0 0;font-size:12.5px">두 장비는 서로 다른 랙에 있어, 한쪽 전기가 나가도 반대쪽이 받습니다.</p>`
        };
      },
      rows() {
        const can = S.ack != null, rec = cur() >= dE, all = cur() >= dE + 3;
        const b = (a, label, en) => `<button class="btn sm" data-a="${a}" ${can && en !== false ? "" : "disabled"}>${label}</button>`;
        return [
          ["ip", "꺼진 장비 확인", done("ip") ? `${D1} 터미널 접속 안 됨 (${fmt(S.done.ip)})` : "꺼진 장비는 터미널로 확인할 수 없습니다", done("ip") ? "" : b("ip", `${D1}에 접속 시도`)],
          ["partner", "짝 장비 확인", done("partner") ? `${D2}의 고객 회선은 그대로 Up, 짝 연결만 Down (${fmt(S.done.partner)})` : "짝 장비로 가서 같은 명령을 칩니다", done("partner") ? "" : b("partner", `${D2} 회선 목록 확인`)],
          ["tr", "트래픽 비교", done("tr") ? `꺼지기 5분 전 → 5분 뒤 거의 그대로 (${fmt(S.done.tr)})` : "그래프가 변했는지 봅니다", done("tr") ? "" : b("tr", "그래프 값 읽기")],
          ["sms", "발생 문자 보내기", done("sms") ? `발송 ${fmt(S.done.sms)} (알림 후 ${Math.round(S.done.sms - ALERT)}분)` : `고객 영향이 없어도 장비가 꺼진 것은 알립니다 (${DEADLINE}분 안)`, ""],
          ["report", "조장 보고 · 전원 모듈 교체 요청", done("report") ? `보고와 교체 요청 (${fmt(S.done.report)})` : "고객 안내는 필요 없지만 보고는 합니다", done("report") ? "" : b("report", "보고·교체 요청")],
          ["watch", "짝 장비를 더 주의해서 확인", done("watch") ? `${D2} ping 정상 (${fmt(S.done.watch)})` : "지금은 한 대로 버티는 위험한 시간입니다", done("watch") ? "" : b("watch", `${D2} ping 확인`)],
          ["rec", "전원 복구 · 이중화 복귀 확인", done("rec") ? `${D1} 회선 목록이 다시 Up (${fmt(S.done.rec)})` : rec ? "전원이 돌아왔습니다. 회선 목록으로 확인합니다" : "전원이 돌아오면 확인합니다", done("rec") ? "" : b("rec", `${D1} 회선 목록 다시 확인`, rec)],
          ["all", "전체 상태 정상 확인", done("all") ? `전체 정상 확인 (${fmt(S.done.all)})` : all ? "두 장비와 짝 연결이 모두 정상인지 봅니다" : "복구 직후에는 '경과'로 알리고, 잠시 뒤 전체를 확인합니다", done("all") ? "" : b("all", "전체 상태 확인", all && done("rec"))],
          ["fin", "완료 문자 보내기", done("fin") ? `완료 문자 ${fmt(S.done.fin)}` : "전체 정상을 확인한 뒤에만 완료로 보냅니다", ""]
        ];
      },
      act(a) {
        const m = cur();
        if (a === "ip") { runShow(D1, CMDS.desc); addLog(`${D1} 접속 시도 → 응답 없음 (전원 꺼짐)`); mark("ip"); }
        else if (a === "partner") { runShow(D2, CMDS.desc); addLog(`짝 장비 ${D2} 확인 → 고객 회선 그대로 Up, 짝 연결만 Down`, true); mark("partner"); }
        else if (a === "tr") { addLog(`트래픽 비교 (꺼지기 5분 전 → 5분 뒤): ${traffic(dS - 5, dS + 5).replace(/\n/g, " / ")}`); mark("tr"); }
        else if (a === "report") { addLog(`조장에게 보고, ${D1} 전원 모듈 교체 요청(티켓)`, true); mark("report"); }
        else if (a === "watch") { runShow(D2, CMDS.ping); addLog(`${D2} ping 정상 → 한 대로 버티는 중이라 더 주의`, true); mark("watch"); }
        else if (a === "rec") { runShow(D1, CMDS.desc); addLog(`${D1} 전원 복구, 이중화 복귀 확인 (회선 목록 다시 Up)`, true); mark("rec"); }
        else if (a === "all") { runShow(D1, CMDS.desc); runShow(D2, CMDS.desc); addLog("전체 상태 정상 확인 (두 장비·짝 연결)", true); mark("all"); }
      },
      draft(stage) {
        const acts = S.log.filter(x => x.act).map(x => ({ t: fmt(x.m), txt: x.text }));
        const base = { stage, center: TOPOLOGY.centers[D1.split("_")[1]].replace(" 센터", ""), title: `${D1} 장비 전원 꺼짐 (고객 영향 없음)`, target: `${D1}(${DEV[D1].rack})`, from: `${date} ${fmt(dS)}`, voc: "없음" };
        if (stage === "발생") return smsNotice({ ...base, cause: `${why}으로 보임`, impact: `없음 (짝 장비 ${D2}에서 같은 고객 회선을 받고 있음)`, actions: [] });
        if (stage === "경과") return smsNotice({ ...base, cause: `${why}으로 보임`, impact: `없음 (짝 장비 ${D2}에서 같은 고객 회선을 받음). 전원 모듈 교체 일정 협의 중`, actions: acts });
        return smsNotice({ ...base, to: `${date} ${fmt(S.done.all != null ? S.done.all : S.t)}`, cause: `${why}, 이중화로 고객 영향 없이 복구`, impact: "없음 (이중화로 고객 회선 유지)", actions: acts });
      },
      stageOk: st => ({ 발생: true, 경과: done("sms"), 완료: done("all") })[st],
      onSend(st) { if (st === "발생") mark("sms"); else if (st === "완료") { mark("fin"); finish(); } else todo(); },
      run(c) {
        const d = devNow();
        if (c === "help" || c === "?") return `가상 장비 명령(Juniper 형식) 예: ${CMDS.desc} / ${CMDS.ping}  (위 장비 버튼으로 ${D1}·${D2} 전환)`;
        return runLive(d, c, cur());
      },
      finishRows() {
        const used = S.done.sms != null ? S.done.sms - ALERT : null, ackd = S.ack != null ? S.ack - ALERT : null, y = k => done(k) ? "함" : "안 함";
        return [
          ["알림 → 내가 확인", ackd == null ? "확인 안 함" : `${ackd.toFixed(1)}분`],
          ["알림 → 발생 문자", used == null ? "안 보냄" : `${used.toFixed(1)}분 (${used <= DEADLINE ? "기한 8분 안" : "기한 초과"})`],
          ["꺼진 장비 접속 시도 / 짝 장비 확인", `${y("ip")} / ${y("partner")}`],
          ["트래픽 비교 (그래프 변화 없음 확인)", y("tr")],
          ["조장 보고·교체 요청 / 짝 장비 주의 확인", `${y("report")} / ${y("watch")}`],
          ["이중화 복귀·전체 정상 확인", `${y("rec")} / ${y("all")}`],
          ["이중화가 없었다면 (가정)", `고객사 ${custOn.length}곳의 회선 ${lu.length}개(합계 ${sumG}G)가 ${dE - dS}분 끊겼을 것`],
          ["문자 순서", S.sent.경과 != null ? "발생 → 경과 → 완료" : "발생 → 완료 (복구 직후에는 '경과'로 먼저 알립니다)"]
        ];
      },
      auto: {
        trigger: `${D1}이 응답하지 않고, 3분 뒤 알림이 뜨면 바로 시작합니다.`,
        guards: ["고객 영향이 없어도 장비가 꺼진 것은 반드시 알림 (발생 문자)", "전원 모듈 교체는 사람이 하므로 요청(티켓)만 올림", "한 대로 버티는 동안 짝 장비를 따로 확인", "두 장비와 짝 연결이 모두 정상인 것을 확인하기 전에는 완료 문자를 보내지 않음"],
        limit: "전원 모듈 교체처럼 손으로 해야 하는 일은 자동화할 수 없습니다. 자동 대응은 확인·보고·요청까지만 합니다.",
        steps: {
          ip: { rule: "알림 수신 → 꺼진 장비에 접속 시도", tool: `${D1} ${CMDS.desc}`, why: () => `${D1} 응답 없음 (전원 꺼짐)` },
          partner: { rule: "접속 안 됨 → 짝 장비에서 같은 명령", tool: `${D2} ${CMDS.desc}`, why: () => `${D2}의 고객 회선은 그대로 Up, 짝 연결만 Down` },
          tr: { rule: "짝 장비 정상 → 꺼지기 전·후 트래픽 비교", tool: "그래프 값 읽기", why: () => "꺼지기 5분 전과 5분 뒤가 거의 같음 → 고객 영향 없음" },
          sms: { rule: "영향 없음 확인 → 발생 문자 (기한 8분)", tool: "문자 양식 자동 채움 · 발송", why: () => `알림 후 ${(S.done.sms - ALERT).toFixed(1)}분에 발송 (기한 ${DEADLINE}분)` },
          report: { rule: "발생 문자 뒤 → 조장 보고 · 전원 모듈 교체 요청", tool: "보고 · 교체 요청(티켓)", why: () => "교체는 사람이 해야 해서 요청만 올림", mid: true },
          watch: { rule: "한 대로 버티는 중 → 짝 장비 ping 확인", tool: `${D2} ping`, why: () => `${D2} ping 정상` },
          rec: { rule: "전원이 돌아옴 → 회선 목록 다시 확인", tool: `${D1} ${CMDS.desc}`, waitText: "전원 모듈 교체로 장비가 켜지기를 기다리는 중", why: () => `${D1} 회선 목록이 다시 Up` },
          all: { rule: "복구 3분 뒤 → 두 장비·짝 연결 전체 확인", tool: `${D1}·${D2} ${CMDS.desc}`, waitText: "복구 직후라 잠시 뒤 전체 상태를 확인하려고 기다리는 중", why: () => "두 장비와 짝 연결 모두 정상" },
          fin: { rule: "전체 정상 확인 → 완료 문자", tool: "문자 양식 자동 채움 · 발송", why: () => "전체 정상을 확인한 뒤에 발송" }
        }
      },
      note: "가상 데이터(사이트의 장비 꺼짐 구간)로 만든 결과입니다. 꺼진 원인과 교체 일정은 제가 만든 가정입니다."
    };
  })();

  /* ================= 공통 화면 ================= */
  root.innerHTML = (`
<div class="lv-bar"><h2><span id="lvTitle"></span> <span class="tag warn">시험판</span>${AGENT ? ' <span class="tag">자동 대응 · 규칙 기반 (AI 호출 없음)</span>' : ' <span class="tag">직접 대응</span>'}</h2>
  <span class="muted" id="lvSub"></span>
  <span class="seg" id="lvScen"></span>
  <span class="lv-ctl"><button class="btn primary" id="lvPlay" type="button">▶ 시작</button><button class="btn" id="lvStep" type="button" title="가상 시계를 1분 앞으로">+1분</button>
    <select id="lvSpeed" aria-label="속도"><option value="6">느리게 (1분=6초)</option><option value="3" selected>보통 (1분=3초)</option><option value="1">빠르게 (1분=1초)</option></select>
    <button class="btn" id="lvReset" type="button">처음부터</button></span>
  <span class="lv-clock"><span class="muted">가상 시각</span> <b class="mono" id="lvClock"></b></span></div>
<div class="lv-alert idle" id="lvAlert"></div>
<div class="lv-grid">
  ${AGENT ? '<div class="card lv-how"><h3>자동 대응이 움직이는 방법 <span class="muted">사람이 하던 순서를 규칙표로 옮겨 그대로 실행합니다. ▶ 시작을 누르면 알림이 뜬 뒤부터 스스로 진행합니다</span></h3><div id="lvHow"></div></div>' : ""}
  <div class="card lv-graph"><h3 id="lvGraphH"></h3><div id="lvChart"></div></div>
  <div class="card lv-term"><h3 id="lvTermH"></h3>
    <pre id="lvTermOut"></pre>
    <div class="lv-termin"><span class="mono" id="lvPrompt"></span><input type="text" id="lvTermIn" autocomplete="off" spellcheck="false" placeholder="${AGENT ? "자동 대응이 넣는 명령이 위에 나옵니다" : "명령 입력 후 Enter (help)"}" ${AGENT ? "disabled" : ""}></div>
    <div class="lv-q" id="lvQ"></div></div>
  <div class="card lv-comp"><h3><span id="lvCardTitle"></span> <span class="muted" id="lvCompSub"></span><span class="lv-save"><span class="tag ok" id="lvSaved" hidden></span><button class="btn primary sm" id="lvSave" type="button">기록에 저장</button></span></h3><div id="lvComp"></div></div>
  <div class="card lv-log"><h3>${AGENT ? "자동 대응 기록" : "내 기록"}</h3><div id="lvLog" class="lv-logl"></div></div>
  <div class="card lv-todo"><h3>${AGENT ? "진행 상황과 근거" : "지금 해야 할 일"} <span class="tag" id="lvProg"></span></h3><div id="lvTodo"></div></div>
  <div class="card lv-sms"><div class="lv-timer" id="lvTimer"></div>
    <h3>문자 초안 <span class="seg" id="lvStage"></span></h3>
    <textarea id="lvDraft" rows="9" spellcheck="false"></textarea>
    <div class="toolbar" style="margin-top:6px"><button class="btn primary" id="lvSend" type="button">보내기</button><button class="btn" id="lvFill" type="button" title="지금 시각·상황에 맞춰 문자 내용을 처음부터 다시 만듭니다. 직접 고친 내용은 사라집니다.">초안 다시 만들기</button><span class="muted" id="lvSendMsg"></span></div></div>
</div>
<div class="scnpop" id="lvResult" hidden><div class="scnpop-box" role="dialog" aria-modal="true" style="width:min(560px,100%)"><h3>${AGENT ? "자동 대응 결과" : "대응 결과"}</h3><div id="lvResBody"></div><div class="scnpop-foot"><span class="sp"></span><button class="btn primary" id="lvResClose" type="button">닫기</button></div></div></div>`).replace(/id="lv/g, `id="${P}`);
  if (AGENT) { root.classList.add("lv-agent"); ["lvSend", "lvFill", "lvSave"].forEach(k => { E(k).style.display = "none"; }); E("lvDraft").readOnly = true; }
  const wrap = document.querySelector(".scn-wrap");   // 시나리오 목록은 이 화면에 있다 (관제 화면에서는 뺐다)
  if (wrap && !AGENT) root.appendChild(wrap);   // 예전 드롭다운 목록은 숨겨 두고(원인 고르기 창만 계속 쓴다), 시나리오는 위 버튼 줄에서 고른다

  /* ----- 기록·터미널 ----- */
  const addLog = (text, act) => { S.log.push({ m: S.t, text, act: !!act }); renderLog(); };
  function renderLog() { E("lvLog").innerHTML = S.log.length ? S.log.map(x => `<div><span class="mono muted">${fmt(x.m)}</span> ${esc(x.text)}</div>`).join("") : '<span class="muted">아직 없습니다. 하는 일이 시각과 함께 쌓입니다.</span>'; E("lvLog").scrollTop = 1e6; }
  function term(t) { S.term.push(...String(t).split("\n")); if (S.term.length > 80) S.term = S.term.slice(-80); const o = E("lvTermOut"); o.textContent = S.term.join("\n"); o.scrollTop = 1e6; }
  function devNow() { return (S && S.dev) || SC.dev; }
  function setDev(d) { S.dev = d; E("lvPrompt").textContent = `admin@${d}>`; E("lvTermH").innerHTML = `터미널 · admin@${esc(d)}&gt; <span class="muted">입력한 명령에 가상 시각의 값이 나옵니다</span>`; E("lvQ").querySelectorAll("[data-dev]").forEach(b => b.classList.toggle("primary", b.dataset.dev === d)); }
  function run(cmd) {
    const c = cmd.replace(/\s+/g, " ").trim(); term(`admin@${devNow()}> ${cmd}`); if (!c) return;
    const out = SC.run(c); if (out) term(out);
  }
  E("lvTermIn").addEventListener("keydown", e => { if (e.key === "Enter") { const v = e.target.value; e.target.value = ""; run(v); } });
  E("lvQ").addEventListener("click", e => { const b = e.target.closest("button"); if (!b || AGENT) return; if (b.dataset.dev) { setDev(b.dataset.dev); term(`${b.dataset.dev}에 접속합니다 (가상)`); } else run(b.dataset.c); });

  /* ----- 그리기 ----- */
  function paintChart() { const c = SC.chart(); E("lvChart").innerHTML = c.svg; E("lvNow").textContent = c.now; E("lvNow").className = "tag " + (c.bad ? "bad" : "ok"); }
  function paintAlert() { const [cls, html] = SC.alertBar(); const el = E("lvAlert"); el.className = "lv-alert " + cls; el.innerHTML = AGENT ? html.replace(/<button class="btn" id="lvAck"[^>]*>[^<]*<\/button>/, '<span class="muted" style="margin-left:auto">자동 대응이 곧 확인합니다</span>').replace("내가 확인", "자동 확인") : html; }
  function paintCard() { const c = SC.card(); E("lvCompSub").textContent = c.sub || ""; E("lvComp").innerHTML = c.html; }
  function timerBar() {
    const el = E("lvTimer"), left = SC.alertAt + SC.deadline - S.t;
    if (!alerted()) { el.className = "lv-timer"; el.innerHTML = `<span>발생 문자 기한 (${SC.deadline}분)</span><b class="mono muted">알림 대기 중</b>`; return; }
    if (done("sms")) { const used = S.done.sms - SC.alertAt, ok = used <= SC.deadline; el.className = "lv-timer " + (ok ? "ok" : "late"); el.innerHTML = `<span>발생 문자</span><b class="mono">${fmt(S.done.sms)} 발송</b><span class="muted">알림 후 ${used.toFixed(1)}분 · ${ok ? "기한 안" : "기한 초과"}</span>`; return; }
    const late = left < 0, s = Math.abs(Math.round(left * 60));
    el.className = "lv-timer " + (late ? "late" : left < 2 ? "warn" : "");
    el.innerHTML = `<span>발생 문자 기한 (${SC.deadline}분)</span><b class="mono">${Math.floor(s / 60)}:${pad(s % 60)} ${late ? "초과" : "남음"}</b><div class="pb"><i style="width:${Math.max(0, Math.min(100, (1 - left / SC.deadline) * 100))}%"></i></div>`;
  }
  function paint() { E("lvClock").textContent = `${SC.date} ${fmt(S.t)}`; E("lvSub").textContent = AGENT ? SC.sub().replace("내가 확인", "자동 확인") : SC.sub(); paintChart(); paintAlert(); paintCard(); timerBar(); }
  function mark(k) { S.done[k] = S.t; todo(); }
  function todo() {
    const rows = SC.rows(), n = Object.keys(S.done).length;
    E("lvProg").textContent = `${n} / ${rows.length}`;
    const first = rows.findIndex(r => !done(r[0]));
    E("lvTodo").innerHTML = rows.map((r, i) => `<div class="lv-step"><div class="lv-d ${done(r[0]) ? "done" : i === first ? "now" : ""}">${done(r[0]) ? "✓" : i + 1}</div><div><div class="t">${r[1]}${r[0] === "sms" && !done("sms") && alerted() && S.t - SC.alertAt > SC.deadline - 2 ? ' <span class="tag bad">기한 임박</span>' : ""}</div><div class="s">${r[2]}</div>${AGENT ? agentLine(r[0], i === first) : r[3] ? `<div class="lv-act">${r[3]}</div>` : ""}</div></div>`).join("");
    timerBar(); stageBtns(); if (AGENT) renderHow();
  }
  E("lvTodo").addEventListener("click", e => { const b = e.target.closest("button[data-a]"); if (b && !b.disabled && !AGENT) SC.act(b.dataset.a); });
  E("lvSave").onclick = () => { if (SC.save) SC.save(); };

  /* ----- 문자 ----- */
  function fill() { E("lvDraft").value = SC.draft(S.stage); }
  function stageBtns() {
    E("lvStage").querySelectorAll("button").forEach(b => { b.disabled = !SC.stageOk(b.dataset.st); b.classList.toggle("primary", b.dataset.st === S.stage); });
    E("lvSend").disabled = !alerted() || S.finished || (S.stage === "발생" && done("sms")) || (S.stage === "완료" && done("fin"));
  }
  E("lvStage").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !b.disabled) { S.stage = b.dataset.st; fill(); stageBtns(); } });
  E("lvFill").onclick = fill;
  E("lvSend").onclick = () => {
    const st = S.stage, text = E("lvDraft").value.trim(); if (!text) return;
    openPhone(text, fmt(S.t)); S.sent[st] = S.t; addLog(`${st} 문자 발송 (가상)`);
    SC.onSend(st); E("lvSendMsg").textContent = `${st} 문자를 보냈습니다`;
  };

  /* ----- 끝 ----- */
  function finish() {
    S.finished = true; stop(); addLog("대응 끝");
    const used = S.done.sms != null ? +(S.done.sms - SC.alertAt).toFixed(1) : null, total = +(S.t - SC.alertAt).toFixed(1), last = store.get("live:last", {});
    if (!AGENT) { last[SC.id] = { sms: used, total }; store.set("live:last", last); }
    let fr = SC.finishRows();
    if (AGENT) {
      const me = last[SC.id];
      fr = fr.map(r => [r[0].replace("내가 ", "자동 ").replace("내 조치", "자동 조치"), r[1]]).concat([
        ["자동 대응이 걸린 시간", `발생 문자 ${used == null ? "안 보냄" : used + "분"} · 끝까지 ${total}분 (알림 기준)`],
        ["직접 대응했을 때 (최근 기록)", me ? `발생 문자 ${me.sms == null ? "안 보냄" : me.sms + "분"} · 끝까지 ${me.total}분` : "아직 없음 ('직접 대응'에서 같은 시나리오를 끝내면 여기에 비교됩니다)"]]);
    }
    E("lvResBody").innerHTML = `<table class="kv2">${fr.map(r => `<tr><th>${r[0]}</th><td>${esc(r[1])}</td></tr>`).join("")}</table>${AGENT && SC.auto.limit ? `<p class="note"><b>자동화의 한계</b> ${esc(SC.auto.limit)}</p>` : ""}<p class="note">${SC.note}</p>`;
    E("lvResult").hidden = false; E("lvPlay").textContent = "▶ 다시"; stageBtns();
  }
  E("lvResClose").onclick = () => { E("lvResult").hidden = true; };

  /* ----- 시계 ----- */
  let speed = 3;
  function tick(dt) {
    if (S.t >= SC.end) { stop(); return; }
    S.t = Math.min(SC.end, S.t + dt); const mm = cur();
    if (mm !== lastMin) { lastMin = mm; paint(); todo(); } else { E("lvClock").textContent = `${SC.date} ${fmt(S.t)}`; timerBar(); }
    if (AGENT) agentStep();
  }
  function loop() { if (timer) return; timer = setInterval(() => { if (root.classList.contains("on")) tick(0.25 / speed); }, 250); S.running = true; E("lvPlay").textContent = "⏸ 일시정지"; }
  function stop() { if (timer) clearInterval(timer); timer = null; if (S) S.running = false; E("lvPlay").textContent = S && S.finished ? "▶ 다시" : "▶ 계속"; }
  E("lvPlay").onclick = () => { if (S.finished) return reset(true); S.running ? stop() : loop(); };
  E("lvStep").onclick = () => tick(1);
  E("lvSpeed").onchange = e => { speed = +e.target.value; S.speed = speed; };
  E("lvReset").onclick = () => reset(false);
  root.addEventListener("click", e => { if (!AGENT && e.target.id === "lvAck" && S.ack == null) { S.ack = S.t; addLog(`알림 확인 (알림 후 ${(S.t - SC.alertAt).toFixed(1)}분)`); fill(); paint(); todo(); } });

  /* ----- 자동 대응 (규칙 기반): 사람이 누르던 단계를 규칙표(SC.auto.steps) 순서대로 대신 실행한다. AI 호출은 없다 -----
     0.3분(가상)마다 "아직 안 끝난 첫 단계"를 찾는다 → 조건이 맞으면 그 단계의 행동을 하나 실행하고, 맞지 않으면 기다린다. */
  const BEAT = 0.3;
  const MAN_LIST = [["ddos", null, "DDoS 공격 수신"], ["linkDown", "ask", "업링크 회선 다운"], ["drop", null, "트래픽 급감"], ["redundancy", null, "이중화"]];   // 직접 대응: 회선 다운은 복구 원인을 먼저 고른다
  const AG_LIST = [["ddos", null, "DDoS 공격 수신"], ["linkDown", { cause: "work" }, "회선 다운 · 상대 작업"], ["linkDown", { cause: "fiber" }, "회선 다운 · 광 고장"], ["drop", null, "트래픽 급감"], ["redundancy", null, "이중화"]];
  function agentSend(st) { S.stage = st; fill(); S.sent[st] = S.t; addLog(`${st} 문자 발송 (자동 · 가상)`); E("lvSendMsg").textContent = `${st} 문자를 자동으로 보냈습니다 (${fmt(S.t)})`; SC.onSend(st); }
  function agentNote(key, did) { const p = SC.auto.steps[key] || {}; S.ag.did[key] = { did, why: p.why ? p.why() : "" }; }
  function agentStep() {
    if (!AGENT || S.finished || !alerted() || S.t < S.ag.next) return;
    S.ag.next = S.t + BEAT;
    if (S.ack == null) { S.ack = S.t; addLog("알림 수신 → 자동 대응 시작"); fill(); paint(); todo(); return; }
    if (S.ag.mid) { S.ag.mid = false; if (S.sent.경과 == null && SC.stageOk("경과")) { agentSend("경과"); todo(); return; } }
    const r = SC.rows().find(x => !done(x[0])); if (!r) return;
    const key = r[0], p = SC.auto.steps[key] || {}, wait = () => { const w = p.waitText || "조건이 맞을 때까지 기다리는 중"; if (S.ag.wait !== w) { S.ag.wait = w; todo(); } };
    if (p.ready && !p.ready()) return wait();
    const btns = [...String(r[3] || "").matchAll(/<button[^>]*data-a="([^"]+)"([^>]*)>([^<]*)</g)].filter(m => !m[2].includes("disabled")).map(m => [m[1], m[3]]);
    const b = p.pick ? btns.find(x => p.pick().includes(x[0])) : btns[0];
    S.ag.wait = "";
    if (b) { SC.act(b[0]); agentNote(key, b[1]); }
    else if (key === "sms") { agentSend("발생"); agentNote(key, "발생 문자 발송"); }
    else if (key === "fin" && SC.stageOk("완료")) { agentNote(key, "완료 문자 발송"); agentSend("완료"); }
    else return wait();
    if (done(key)) { if (p.mid) S.ag.mid = true; if (p.after) p.after(); }
    if (!S.finished) todo();
  }
  function agentLine(key, isNow) {
    const d = S.ag.did[key], p = SC.auto.steps[key] || {};
    if (d && done(key)) return `<div class="lv-why"><b>근거</b> ${esc(d.why)} <span class="muted">· 한 일: ${esc(d.did)}</span></div>`;
    if (isNow && S.ack != null) return `<div class="lv-why now"><b>규칙</b> ${esc(p.rule || "")}${S.ag.wait ? ` <span class="muted">· ${esc(S.ag.wait)}</span>` : ""}</div>`;
    return "";
  }
  function renderHow() {
    const a = SC.auto, rows = SC.rows(), first = rows.findIndex(r => !done(r[0]));
    const st = (k, i) => done(k) ? `<span class="tag ok">완료 ${fmt(S.done[k])}</span>` : i === first && S.ack != null && !S.finished ? (S.ag.wait ? '<span class="tag warn">기다리는 중</span>' : '<span class="tag bad">진행 중</span>') : '<span class="tag">대기</span>';
    E("lvHow").innerHTML = `<div class="lv-howg"><div>
      <h4>① 무엇을 보고 시작하나</h4><p>${esc(a.trigger)}</p>
      <h4>③ 안전장치 <span class="muted">이럴 땐 하지 않거나 사람에게 넘깁니다</span></h4><ul>${a.guards.map(g => `<li>${esc(g)}</li>`).join("")}</ul>
      <h4>④ 자동화한 방법</h4><p>'직접 대응'에서 사람이 누르던 단계를 그대로 규칙표(조건 → 행동)로 옮겼습니다. 0.3분(가상)마다 아직 안 끝난 첫 단계를 찾아, 조건이 맞으면 실행하고 맞지 않으면 기다립니다. 정해 둔 규칙만 따르고 AI는 부르지 않아서, 같은 상황이면 항상 같은 결과가 나옵니다.</p>
    </div><div>
      <h4>② 규칙표 <span class="muted">사람이 하던 순서 그대로</span></h4>
      <table class="lv-rule"><tr><th>#</th><th>단계</th><th>조건 → 행동</th><th>쓰는 것</th><th>상태</th></tr>${rows.map((r, i) => { const p = a.steps[r[0]] || {}; return `<tr class="${i === first && S.ack != null && !S.finished ? "now" : ""}"><td>${i + 1}</td><td>${r[1]}</td><td>${esc(p.rule || "")}</td><td class="muted">${esc(p.tool || "")}</td><td>${st(r[0], i)}</td></tr>`; }).join("")}</table>
    </div></div>`;
  }
  function renderScen() { E("lvScen").innerHTML = (AGENT ? AG_LIST : MAN_LIST).map((x, i) => `<button class="btn${x[0] === SC.id && (!AGENT || !x[1] || x[1].cause === S.cause) ? " primary" : ""}" data-i="${i}" type="button">${x[2]}</button>`).join(""); }
  E("lvScen").addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    const x = (AGENT ? AG_LIST : MAN_LIST)[+b.dataset.i];
    if (x[1] === "ask") { window.ldRoute = "live"; document.getElementById("scnCausePop").hidden = false; } else loadPub(x[0], x[1]);
  });

  /* ----- 시나리오 불러오기 ----- */
  function load(id, opts) {
    stop(); SC = SCEN[id] || SCEN.ddos; S = Object.assign({ t: SC.start, running: false, speed, ack: null, done: {}, log: [], sent: {}, stage: "발생", finished: false, term: [] }, SC.init(opts)); if (AGENT) S.ag = { next: 0, did: {}, mid: false, wait: "" };
    lastMin = -1; E("lvResult").hidden = true;
    E("lvTitle").textContent = SC.name;
    E("lvGraphH").innerHTML = `${esc(SC.linkTitle)} <span class="muted">${esc(SC.linkDesc)}</span><span class="tag" id="${P}Now"></span>`;
    E("lvQ").innerHTML = (SC.devs || []).map(d => `<button class="btn sm" data-dev="${d}">${d}</button>`).join("") + SC.termQuick.map(q => `<button class="btn sm" data-c="${esc(q[1])}">${esc(q[0])}</button>`).join("");
    setDev(devNow());
    E("lvCardTitle").textContent = SC.cardTitle; E("lvSave").hidden = !SC.cardSave; E("lvSaved").hidden = true; E("lvSave").textContent = "기록에 저장";
    E("lvStage").innerHTML = SC.stages.map((s, i) => `<button class="btn${i === 0 ? " primary" : ""}" data-st="${s}" type="button">${s}</button>`).join("");
    E("lvTermOut").textContent = ""; E("lvSendMsg").textContent = ""; E("lvPlay").textContent = "▶ 시작";
    term(SC.intro); fill(); renderLog(); paint(); todo(); renderScen();
  }
  function reset(autoplay) { load(SC.id, SC.lastOpts); if (autoplay) loop(); }
  const origLoad = load;
  const loadPub = (id, opts) => { origLoad(id, opts); if (SCEN[id]) SCEN[id].lastOpts = opts; };
  const api = { get state() { return S; }, get scenario() { return SC; }, advance: m => { let n = Math.round(m * 4); while (n-- > 0) tick(0.25); }, jump: m => { S.t = Math.min(SC.end, m); lastMin = -1; tick(0); }, reset, load: loadPub, consts: { get alertAt() { return SC.alertAt; } } };
  SC = SCEN.ddos; loadPub("ddos");
  return api;
}
window.LIVE = makeLive(document.getElementById("tab-live"), "lv", false);
window.AUTO = makeLive(document.getElementById("tab-soar"), "av", true);
