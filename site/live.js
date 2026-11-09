/* 실시간 대응 (시험판): DDoS 공격 수신 상황을 가상 시계로 흘려 보내며 직접 확인·판단·조치한다.
   목업(docs/mockups/mock3-E2.png)대로 만든 첫 화면이다. 모든 수치·IP·절차는 가상이고, 클린존 가입 여부와 차단 절차는 제가 정한 가정이다.
   시계: 가상 1분 = 실제 몇 초(속도 선택). 그래프는 1분마다 값이 쌓이고, 알림은 급증 시작 3분 뒤에 뜬다. */
(function initLive() {
  const root = document.getElementById("tab-live");
  if (!root) return;
  const VICTIM = "198.51.100.77", DEV = "IDC_B_FS1", UPL = "IDC_B_FS1_UP2";
  const START = 15, ONSET = 20, ALERT = 23, ATK_END = 40, END = 60, DEADLINE = 8, PKT = 138;   // 분(03:00부터)
  const pad = n => String(n).padStart(2, "0");
  const fmt = m => `${pad(3 + Math.floor(m / 60))}:${pad(Math.floor(m % 60))}`;
  const noise = m => { const x = Math.sin(m * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const gb = v => v.toFixed(1);
  let S, timer = null;
  const fresh = () => ({ t: START, running: false, speed: 3, ack: null, done: {}, log: [], bh: null, rel: null, upstream: null, choice: null, victim: false, event: false, pending: false, sent: {}, stage: "발생", saved: null, finished: false, early: false, wait: false, term: [] });
  S = fresh();

  /* ----- 시뮬레이션 값 ----- */
  const base = m => 3.3 + Math.sin(m / 6) * 0.15 + (noise(m) - 0.5) * 0.25;
  const atkRaw = m => m < ONSET ? 0 : (m < ATK_END ? Math.min(1, (m - ONSET) / 1.5) * 6.8 * (1 + (noise(m + 7) - 0.5) * 0.04) : Math.max(0, 1 - (m - ATK_END)) * 6.8);
  const blocked = m => S.bh != null && m >= S.bh && (S.rel == null || m < S.rel) ? Math.min(1, Math.max(0, 1 - (m - S.bh) / 1.2)) : 1;   // 1 = 그대로 들어옴, 0 = 막힘
  const passed = m => atkRaw(m) * blocked(m);
  const valueIn = m => base(m) + passed(m);
  const discarded = m => atkRaw(m) - passed(m);
  const mpps = (m) => (base(m) * 1e9 / (800 * 8) + passed(m) * 1e9 / (PKT * 8)) / 1e6;
  const alerted = () => S.t >= ALERT;
  const cur = () => Math.floor(S.t);

  /* ----- 화면 뼈대 ----- */
  root.innerHTML = `
<div class="lv-bar"><h2>DDoS 공격 수신 대응 <span class="tag warn">시험판</span></h2>
  <span class="muted" id="lvSub"></span>
  <span class="seg"><button class="btn primary" type="button">내가 대응</button><button class="btn" type="button" disabled title="다음 단계에서 만듭니다">자동 대응(에이전트)</button></span>
  <span class="lv-ctl"><button class="btn primary" id="lvPlay" type="button">▶ 시작</button><button class="btn" id="lvStep" type="button" title="가상 시계를 1분 앞으로">+1분</button>
    <select id="lvSpeed" aria-label="속도"><option value="6">느리게 (1분=6초)</option><option value="3" selected>보통 (1분=3초)</option><option value="1">빠르게 (1분=1초)</option></select>
    <button class="btn" id="lvReset" type="button">처음부터</button></span>
  <span class="lv-clock"><span class="muted">가상 시각</span> <b class="mono" id="lvClock"></b></span></div>
<div class="lv-alert idle" id="lvAlert"></div>
<div class="lv-grid">
  <div class="card lv-graph"><h3>${UPL} · in <span class="muted">분당→서초 B · 100G · 점선=어제 같은 시각</span><span class="tag" id="lvNow"></span></h3><div id="lvChart"></div></div>
  <div class="card lv-term"><h3>터미널 · admin@${DEV}&gt; <span class="muted">입력한 명령에 가상 시각의 값이 나옵니다</span></h3>
    <pre id="lvTermOut"></pre>
    <div class="lv-termin"><span class="mono">admin@${DEV}&gt;</span><input type="text" id="lvTermIn" autocomplete="off" spellcheck="false" placeholder="명령 입력 후 Enter (help)"></div>
    <div class="lv-q" id="lvQ"><button class="btn sm" data-c='show interfaces xe-0/0/1 extensive | match "bps|pps"'>속도 확인</button><button class="btn sm" data-c="show route ${VICTIM}">경로 확인</button></div></div>
  <div class="card lv-comp"><h3>공격 트래픽 구성 <span class="muted" id="lvCompSub"></span><span class="lv-save"><span class="tag ok" id="lvSaved" hidden></span><button class="btn primary sm" id="lvSave" type="button">기록에 저장</button></span></h3><div id="lvComp"></div></div>
  <div class="card lv-log"><h3>내 기록</h3><div id="lvLog" class="lv-logl"></div></div>
  <div class="card lv-todo"><h3>지금 해야 할 일 <span class="tag" id="lvProg"></span></h3><div id="lvTodo"></div></div>
  <div class="card lv-sms"><div class="lv-timer" id="lvTimer"></div>
    <h3>문자 초안 <span class="seg" id="lvStage"><button class="btn primary" data-st="발생" type="button">발생</button><button class="btn" data-st="경과" type="button">경과</button><button class="btn" data-st="완료" type="button">완료</button></span></h3>
    <textarea id="lvDraft" rows="9" spellcheck="false"></textarea>
    <div class="toolbar" style="margin-top:6px"><button class="btn primary" id="lvSend" type="button">보내기 (가상)</button><button class="btn" id="lvFill" type="button">숫자 자동 채우기</button><span class="muted" id="lvSendMsg"></span></div></div>
</div>
<div class="scnpop" id="lvResult" hidden><div class="scnpop-box" role="dialog" aria-modal="true" style="width:min(560px,100%)"><h3>대응 결과</h3><div id="lvResBody"></div><div class="scnpop-foot"><span class="sp"></span><button class="btn primary" id="lvResClose" type="button">닫기</button></div></div></div>`;
  const E = id => document.getElementById(id);
  const wrap = document.querySelector(".scn-wrap");   // 시나리오 목록은 이 화면으로 옮겼다 (관제 화면에서는 뺐다)
  if (wrap) { const bar = root.querySelector(".lv-bar"); bar.insertBefore(wrap, bar.querySelector(".seg")); }

  /* ----- 기록 ----- */
  const addLog = (text, act) => { S.log.push({ m: S.t, text, act: !!act }); renderLog(); };
  function renderLog() { E("lvLog").innerHTML = S.log.length ? S.log.map(x => `<div><span class="mono muted">${fmt(x.m)}</span> ${esc(x.text)}</div>`).join("") : '<span class="muted">아직 없습니다. 하는 일이 시각과 함께 쌓입니다.</span>'; E("lvLog").scrollTop = 1e6; }

  /* ----- 그래프 ----- */
  function chart() {
    const W = 760, H = 168, L = 36, B = 16, T = 6, R = 6, cap = 12, n = END, upto = cur();
    const x = m => L + (W - L - R) * m / n, y = v => T + (H - T - B) * (1 - v / cap);
    let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${UPL} in 그래프">`;
    for (const v of [0, 6, 12]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#26323d"/><text x="${L - 5}" y="${y(v) + 3}" fill="#7b8a98" font-size="10" text-anchor="end">${v}G</text>`;
    for (const m of [0, 20, 40, 60]) g += `<text x="${x(m)}" y="${H - 3}" fill="#7b8a98" font-size="10" text-anchor="${m === 60 ? "end" : "middle"}">${m === 60 ? "04:00" : fmt(m)}</text>`;
    const ref = []; for (let m = 0; m <= n; m++) ref.push(`${x(m)},${y(3.3 + Math.sin(m / 6) * 0.1)}`);
    g += `<polyline fill="none" stroke="#3b4f61" stroke-width="1.2" stroke-dasharray="3 3" points="${ref.join(" ")}"/>`;
    const pts = []; for (let m = 0; m <= upto; m++) pts.push(`${x(m)},${y(Math.min(cap, valueIn(m)))}`);
    const hot = valueIn(upto) > 6;
    g += `<polyline fill="none" stroke="${hot ? "#ff8f84" : "#59b4f5"}" stroke-width="2" points="${pts.join(" ")}"/><circle cx="${x(upto)}" cy="${y(Math.min(cap, valueIn(upto)))}" r="3.5" fill="${hot ? "#ff8f84" : "#59b4f5"}"/>`;
    if (upto >= ONSET) g += `<line x1="${x(ONSET)}" x2="${x(ONSET)}" y1="${T}" y2="${H - B}" stroke="#e8a23b" stroke-dasharray="3 3"/><text x="${x(ONSET) + 3}" y="${T + 10}" fill="#e8a23b" font-size="10">급증 시작</text>`;
    if (S.bh != null && S.bh <= S.t) g += `<line x1="${x(S.bh)}" x2="${x(S.bh)}" y1="${T}" y2="${H - B}" stroke="#47c28b" stroke-dasharray="3 3"/><text x="${x(S.bh) + 3}" y="${T + 22}" fill="#47c28b" font-size="10">블랙홀 ${fmt(S.bh)}</text>`;
    E("lvChart").innerHTML = g + "</svg>";
    const v = valueIn(upto); E("lvNow").textContent = `${gb(v)}G`; E("lvNow").className = "tag " + (v > 6 ? "bad" : "ok");
  }

  /* ----- 알림 줄 ----- */
  function alertBar() {
    const el = E("lvAlert"), m = cur(), v = valueIn(m), back = S.rel != null && m >= ATK_END + 2 && v < 5;
    if (!alerted()) { el.className = "lv-alert idle"; el.innerHTML = '● 알림 없음 · 정상 감시 중 <span class="muted">(급증이 기준을 넘고 1~3분이 지나야 알림이 뜹니다)</span>'; return; }
    if (back) { el.className = "lv-alert ok"; el.innerHTML = `● ${UPL} 정상 범위로 복귀 <span class="muted">${fmt(m)} · in ${gb(v)}G</span>`; return; }
    el.className = "lv-alert hot";
    el.innerHTML = `<span class="lv-dot"></span>${UPL} in 급증 감지 <span class="muted">${fmt(ALERT)} · 급증 시작 ${fmt(ONSET)} · 지연 ${ALERT - ONSET}분 · 평소 3.3G → ${gb(v)}G</span>` +
      (S.ack == null ? `<button class="btn" id="lvAck" type="button">확인하기</button>` : `<span class="muted" style="margin-left:auto">내가 확인 ${fmt(S.ack)}</span>`);
  }

  /* ----- 공격 트래픽 구성 (쌓이는 원시 값) ----- */
  const bar = (label, pct, c) => `<div class="lv-hb"><span class="mono">${label}</span><div><i style="width:${Math.max(1, pct)}%;background:${c || "#59b4f5"}"></i></div><span class="mono muted">${Math.round(pct)}%</span></div>`;
  function comp() {
    const m = cur(), box = E("lvComp");
    if (S.ack == null) { E("lvCompSub").textContent = ""; box.innerHTML = '<p class="muted lv-empty">알림을 확인하면 공격 트래픽 구성이 표시됩니다.</p>'; return; }
    const atk = atkRaw(m);
    if (atk < 0.1) { E("lvCompSub").textContent = `${fmt(m)} 기준`; box.innerHTML = '<p class="muted lv-empty">지금 들어오는 공격 트래픽이 없습니다.</p>'; return; }
    const w = k => (noise(m * 3 + k) - 0.5) * 3, a = 22 + w(1), b = 14 + w(2), c = 9 + w(3), o = 100 - a - b - c, syn = 95 + w(4) * 0.3, n = 4200 + Math.round((Math.min(m, ATK_END) - ONSET) * 60);
    const gone = discarded(m);
    E("lvCompSub").textContent = `${fmt(m)} 기준 · 유입 ${gb(atk)}Gbps (${(atk * 1e9 / (PKT * 8) / 1e6).toFixed(1)}Mpps)${gone > 0.05 ? ` · 블랙홀로 버려지는 양 ${gb(gone)}Gbps` : ""} · 출발지 ${n.toLocaleString()}개`;
    box.innerHTML = `<div class="lv-3"><div><div class="muted lv-h">출발지 대역 (상위)</div>${bar("203.0.113.0/24", a, "#e8a23b")}${bar("192.0.2.0/24", b, "#e8a23b")}${bar("203.0.114.0/24", c, "#e8a23b")}${bar("그 밖 " + Math.round(n * 0.99).toLocaleString() + "개", o, "#2b4358")}</div>
      <div><div class="muted lv-h">프로토콜 · 플래그</div>${bar("TCP SYN", syn, "#ff8f84")}${bar("TCP ACK", 3)}${bar("UDP", 1)}${bar("기타", 1)}</div>
      <div><div class="muted lv-h">목적지 포트 · 패킷 크기</div>${bar("443", 91)}${bar("80", 6)}${bar("패킷 60~80B", 93)}${bar("패킷 1000B+", 2)}</div></div>`;
  }
  E("lvSave").onclick = () => {
    if (S.ack == null) { E("lvSendMsg").textContent = "알림을 먼저 확인하세요"; return; }
    const m = cur(), atk = atkRaw(m); if (atk < 0.1) { E("lvSendMsg").textContent = "저장할 공격 트래픽이 없습니다"; return; }
    const all = store.get("live:records", []); const rec = { id: all.length + 1, m, at: fmt(m), atk: +gb(atk), top: "203.0.113.0/24, 192.0.2.0/24, 203.0.114.0/24", proto: "TCP SYN 95%", port: "443 91%" };
    all.push(rec); store.set("live:records", all); S.saved = rec; addLog(`공격 트래픽 구성을 사건 기록 #${rec.id}로 저장`);
    E("lvSaved").hidden = false; E("lvSaved").textContent = `저장됨 ${rec.at} · 사건 기록 #${rec.id}`; E("lvSave").textContent = "다시 저장"; fill();
  };

  /* ----- 해야 할 일 ----- */
  const done = k => !!S.done[k];
  function mark(k) { S.done[k] = S.t; todo(); }
  function todo() {
    const can = S.ack != null, m = cur(), n = Object.keys(S.done).length;
    E("lvProg").textContent = `${n} / 6`;
    const rows = [
      ["ev", "이벤트 일정인지 확인", done("ev") ? `일정 없음 (${fmt(S.done.ev)})` : "일정에 없으면 이상 징조입니다", done("ev") ? "" : `<button class="btn sm" data-a="ev" ${can ? "" : "disabled"}>일정 조회</button>`],
      ["ip", "대상·유형·공격량 파악", done("ip") ? `가상물산 ${VICTIM} · TCP · ${gb(atkRaw(Math.max(ONSET + 2, Math.min(S.done.ip, ATK_END - 1))))} Gbps (${fmt(S.done.ip)})` : "누구 IP로 오는지 조회하고, 구성 카드의 값을 봅니다", done("ip") ? "" : `<button class="btn sm" data-a="ip" ${can ? "" : "disabled"}>${VICTIM} 누구 IP?</button>`],
      ["sms", "발생 문자 보내기", done("sms") ? `발송 ${fmt(S.done.sms)} (알림 후 ${Math.round(S.done.sms - ALERT)}분)` : `알림 후 ${DEADLINE}분 안에 보냅니다`, ""],
      ["way", "차단 방법 판단", done("way") ? `블랙홀 선택 (${fmt(S.done.way)})` : "클린존 가입 여부에 따라 달라집니다",
        done("way") ? "" : `<span class="lv-opts"><button class="btn sm" data-a="clean" ${can ? "" : "disabled"}>클린존 우회</button><button class="btn sm" data-a="bh" ${can ? "" : "disabled"}>블랙홀</button><button class="btn sm" data-a="wait" ${can ? "" : "disabled"}>더 지켜보기</button></span>`],
      ["act", "차단 실행 · 상위 연동망 요청", done("act") ? `차단 ${fmt(S.bh)} · 요청 ${fmt(S.upstream)}` : "블랙홀 명령을 넣고 상위 연동망에 요청합니다",
        done("act") ? "" : `<span class="lv-opts"><button class="btn sm" data-a="exec" ${can && S.bh == null ? "" : "disabled"}>블랙홀 실행 (가상)</button><button class="btn sm" data-a="up" ${S.bh != null && S.upstream == null ? "" : "disabled"}>연동망 요청</button></span>`],
      ["fin", "정상화 확인 · 해제 · 완료 문자", done("fin") ? `완료 문자 ${fmt(S.done.fin)}` : S.rel != null ? "블랙홀을 풀었습니다. 정상이면 완료 문자를 보냅니다" : "버려지는 공격량이 0이 되면 해제하고 완료 문자를 보냅니다",
        done("fin") ? "" : `<button class="btn sm" data-a="rel" ${S.bh != null && S.rel == null ? "" : "disabled"}>블랙홀 해제</button>`]
    ];
    const first = rows.findIndex(r => !done(r[0]));
    E("lvTodo").innerHTML = rows.map((r, i) => `<div class="lv-step"><div class="lv-d ${done(r[0]) ? "done" : i === first ? "now" : ""}">${done(r[0]) ? "✓" : i + 1}</div><div><div class="t">${r[1]}${r[0] === "sms" && !done("sms") && alerted() && S.t - ALERT > DEADLINE - 2 ? ' <span class="tag bad">기한 임박</span>' : ""}</div><div class="s">${r[2]}</div>${r[3] ? `<div class="lv-act">${r[3]}</div>` : ""}</div></div>`).join("");
    timerBar(); stageBtns();
  }
  E("lvTodo").addEventListener("click", e => {
    const b = e.target.closest("button[data-a]"); if (!b || b.disabled) return; const a = b.dataset.a;
    if (a === "ev") { S.event = true; addLog("이벤트 일정 조회 → 해당 시간 일정 없음"); mark("ev"); }
    else if (a === "ip") { S.victim = true; addLog(`${VICTIM} 조회 → 가상물산 (클린존 미가입, 가정)`); mark("ip"); comp(); }
    else if (a === "clean") { S.victim = true; addLog("클린존 우회 시도 → 가상물산은 미가입이라 불가 (가정)"); E("lvSendMsg").textContent = "가상물산은 클린존 미가입이라 우회할 수 없습니다 (제가 정한 가정)"; todo(); }
    else if (a === "wait") { S.wait = true; addLog("더 지켜보기 선택"); E("lvSendMsg").textContent = "지켜보는 동안에도 시간은 흐르고 공격은 이어집니다"; }
    else if (a === "bh") { S.choice = "블랙홀"; addLog("차단 방법: 블랙홀 선택"); mark("way"); }
    else if (a === "exec") execBh(true);
    else if (a === "up") reqUp();
    else if (a === "rel") release();
  });
  function execBh(echo) {
    if (S.bh != null) return;
    S.bh = S.t; if (echo) term(`admin@${DEV}> set routing-options static route ${VICTIM}/32 discard\n[edit]\nadmin@${DEV}> commit\ncommit complete`);
    addLog(`블랙홀 차단 (${VICTIM}/32)`, true); if (!S.done.way) { S.choice = "블랙홀"; S.done.way = S.t; } if (S.upstream != null) mark("act"); else todo(); chart();
  }
  function reqUp() { if (S.bh == null || S.upstream != null) return; S.upstream = S.t; addLog("상위 연동망에 블랙홀 요청 (65535:666)", true); mark("act"); }
  function release() {
    if (S.bh == null || S.rel != null) return;
    S.early = atkRaw(cur()) > 0.1; S.rel = S.t; addLog(S.early ? "블랙홀 해제 (공격이 아직 이어지는 중)" : "공격 종료 확인 · 블랙홀 해제", true);
    term(`admin@${DEV}> delete routing-options static route ${VICTIM}/32\nadmin@${DEV}> commit\ncommit complete`); todo(); chart();
  }

  /* ----- 문자 ----- */
  function draft(stage) {
    const m = cur(), atk = S.bh != null && S.rel == null && atkRaw(m) > 0 ? atkRaw(m) : atkRaw(Math.min(m, ATK_END - 1)), acts = S.log.filter(x => x.act).map(x => ({ t: fmt(x.m), txt: x.text }));
    const cause = (stage === "발생" ? "국제망 DDoS 공격 (확인 중)" : "국제망 DDoS 공격") + (S.saved && stage !== "발생" ? ` · 출발지 상위 ${S.saved.top.split(", ")[0]} 등` : "");
    const impact = stage === "발생" ? "파악중" : stage === "경과" ? (S.bh != null && S.rel == null ? "대상 IP 접속 불가(블랙홀 중)" : "파악중") : (S.bh != null ? `블랙홀 구간(${fmt(S.bh)}~${fmt(S.rel != null ? S.rel : S.t)}) 대상 IP 접속 불가` : "영향 없음");
    return smsNotice({ stage, center: "분당", title: "DDoS 공격 수신", target: `${DEV}(10.0.0.1)`, from: `10/29 ${fmt(ONSET)}`, to: stage === "완료" ? `10/29 ${fmt(S.t)}` : "", cause, attack: `TCP (${gb(atk)} Gbps / ${(atk * 1e9 / (PKT * 8) / 1e6).toFixed(1)} Mpps)`, actions: stage === "발생" ? [] : acts, impact, voc: stage === "발생" ? "파악중" : "없음" });
  }
  function fill() { E("lvDraft").value = draft(S.stage); }
  function stageBtns() {
    const ok = { 발생: true, 경과: done("sms"), 완료: S.rel != null };
    E("lvStage").querySelectorAll("button").forEach(b => { b.disabled = !ok[b.dataset.st]; b.classList.toggle("primary", b.dataset.st === S.stage); });
    E("lvSend").disabled = !alerted() || S.finished || (S.stage === "발생" && done("sms")) || (S.stage === "완료" && done("fin"));
  }
  E("lvStage").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !b.disabled) { S.stage = b.dataset.st; fill(); stageBtns(); } });
  E("lvFill").onclick = fill;
  function timerBar() {
    const el = E("lvTimer"), left = ALERT + DEADLINE - S.t;
    if (!alerted()) { el.className = "lv-timer"; el.innerHTML = `<span>발생 문자 기한 (${DEADLINE}분)</span><b class="mono muted">알림 대기 중</b>`; return; }
    if (done("sms")) { const used = S.done.sms - ALERT, ok = used <= DEADLINE; el.className = "lv-timer " + (ok ? "ok" : "late"); el.innerHTML = `<span>발생 문자</span><b class="mono">${fmt(S.done.sms)} 발송</b><span class="muted">알림 후 ${used.toFixed(1)}분 · ${ok ? "기한 안" : "기한 초과"}</span>`; return; }
    const late = left < 0, s = Math.abs(Math.round(left * 60));
    el.className = "lv-timer " + (late ? "late" : left < 2 ? "warn" : "");
    el.innerHTML = `<span>발생 문자 기한 (${DEADLINE}분)</span><b class="mono">${Math.floor(s / 60)}:${pad(s % 60)} ${late ? "초과" : "남음"}</b><div class="pb"><i style="width:${Math.max(0, Math.min(100, (1 - left / DEADLINE) * 100))}%"></i></div>`;
  }
  E("lvSend").onclick = () => {
    const st = S.stage, text = E("lvDraft").value.trim(); if (!text) return;
    openPhone(text, fmt(S.t)); S.sent[st] = S.t;
    addLog(`${st} 문자 발송 (가상)`);
    if (st === "발생") mark("sms"); else if (st === "완료") { mark("fin"); finish(); } else todo();
    E("lvSendMsg").textContent = `${st} 문자를 보냈습니다`;
  };

  /* ----- 터미널 ----- */
  function term(t) { S.term.push(...String(t).split("\n")); if (S.term.length > 60) S.term = S.term.slice(-60); const o = E("lvTermOut"); o.textContent = S.term.join("\n"); o.scrollTop = 1e6; }
  function run(cmd) {
    const c = cmd.replace(/\s+/g, " ").trim(); term(`admin@${DEV}> ${cmd}`); if (!c) return;
    const m = cur(), pk = Math.round(mpps(m) * 1e6), bps = Math.round(valueIn(m) * 1e9);
    if (/^show interfaces xe-0\/0\/1 extensive \| match "?bps\|pps"?$/.test(c)) term(`  Input rate     : ${bps} bps (${pk} pps)\n  Output rate    : ${Math.round(3.3e9)} bps (${Math.round(3.3e9 / 800 / 8)} pps)`);
    else if (c === `show route ${VICTIM}`) term(S.bh != null && (S.rel == null || m < S.rel) ? `${VICTIM}/32 *[Static/5] ${fmt(S.bh)}, metric 0\n                    Discard` : `${VICTIM}/32 *[BGP/170] 00:${pad(Math.max(0, m - 17))}:52, localpref 100\n                    > to 10.0.0.2 via xe-0/0/1.0   → ${UPL}`);
    else if (/^set routing-options static route 198\.51\.100\.77\/32 discard$/.test(c)) { S.pending = true; term("[edit]"); }
    else if (c === "commit") { term("commit complete"); if (S.pending) { S.pending = false; execBh(false); } }
    else if (c === "help" || c === "?") term('사용할 수 있는 명령:\n  show interfaces xe-0/0/1 extensive | match "bps|pps"\n  show route ' + VICTIM + '\n  set routing-options static route ' + VICTIM + '/32 discard  (이어서 commit)');
    else term("                     ^\nunknown command.");
  }
  E("lvTermIn").addEventListener("keydown", e => { if (e.key === "Enter") { const v = e.target.value; e.target.value = ""; run(v); } });
  E("lvQ").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { run(b.dataset.c); } });

  /* ----- 끝 ----- */
  function finish() {
    S.finished = true; stop();
    const used = (S.done.sms != null ? S.done.sms - ALERT : null), ackd = S.ack != null ? S.ack - ALERT : null;
    const rows = [
      ["알림 → 내가 확인", ackd == null ? "확인 안 함" : `${ackd.toFixed(1)}분`],
      ["알림 → 발생 문자", used == null ? "안 보냄" : `${used.toFixed(1)}분 (${used <= DEADLINE ? "기한 8분 안" : "기한 초과"})`],
      ["알림 → 차단", S.bh == null ? "차단 안 함" : `${(S.bh - ALERT).toFixed(1)}분`],
      ["블랙홀 구간", S.bh == null ? "-" : `${fmt(S.bh)} ~ ${fmt(S.rel)} (${(S.rel - S.bh).toFixed(1)}분)`],
      ["클린존 가입 확인", S.victim ? "확인함" : "확인 안 함 (차단 전에 확인하는 순서입니다)"],
      ["공격이 끝나기 전에 해제", S.early ? "예 → 공격이 다시 들어왔습니다" : "아니오"],
      ["사건 기록 저장", S.saved ? `#${S.saved.id} 저장함` : "안 함 (끝난 뒤에는 값을 다시 볼 수 없습니다)"],
      ["문자 순서", `발생${S.sent.경과 != null ? " → 경과" : ""} → 완료`]
    ];
    E("lvResBody").innerHTML = `<table class="kv2">${rows.map(r => `<tr><th>${r[0]}</th><td>${esc(r[1])}</td></tr>`).join("")}</table><p class="note">가상 시나리오의 결과입니다. 기준(8분 등)은 현장에서 들은 값이고, 클린존·차단 절차는 제가 정한 가정입니다.</p>`;
    E("lvResult").hidden = false; addLog("대응 끝"); E("lvPlay").textContent = "▶ 다시"; stageBtns();
  }
  E("lvResClose").onclick = () => { E("lvResult").hidden = true; };

  /* ----- 시계 ----- */
  function paint() {
    E("lvClock").textContent = `10/29 ${fmt(S.t)}`; E("lvSub").textContent = alerted() ? `알림 ${fmt(ALERT)}${S.ack != null ? ` · 내가 확인 ${fmt(S.ack)}` : ""}` : "정상 감시 중";
    chart(); alertBar(); comp(); timerBar();
  }
  let lastMin = -1;
  function tick(dt) {
    if (S.t >= END) { stop(); return; }
    S.t = Math.min(END, S.t + dt); const mm = cur();
    if (mm !== lastMin) { lastMin = mm; paint(); todo(); } else { E("lvClock").textContent = `10/29 ${fmt(S.t)}`; timerBar(); }
  }
  function loop() { if (timer) return; timer = setInterval(() => { if (root.classList.contains("on")) tick(0.25 / S.speed); }, 250); S.running = true; E("lvPlay").textContent = "⏸ 일시정지"; }
  function stop() { if (timer) clearInterval(timer); timer = null; S.running = false; E("lvPlay").textContent = S.finished ? "▶ 다시" : "▶ 계속"; }
  E("lvPlay").onclick = () => { if (S.finished) return reset(true); S.running ? stop() : loop(); };
  E("lvStep").onclick = () => tick(1);
  E("lvSpeed").onchange = e => { S.speed = +e.target.value; };
  E("lvReset").onclick = () => reset(false);
  root.addEventListener("click", e => { if (e.target.id === "lvAck" && S.ack == null) { S.ack = S.t; addLog(`알림 확인 (알림 후 ${(S.t - ALERT).toFixed(1)}분)`); fill(); paint(); todo(); } });
  function reset(autoplay) {
    stop(); const sp = S.speed; S = fresh(); S.speed = sp; lastMin = -1; E("lvResult").hidden = true;
    E("lvTermOut").textContent = ""; E("lvSaved").hidden = true; E("lvSave").textContent = "기록에 저장"; E("lvSendMsg").textContent = ""; E("lvPlay").textContent = "▶ 시작";
    term('가상 장비 ' + DEV + ' (juniper)에 연결됨. 실제 장비가 아닙니다. help를 입력하면 명령이 나옵니다.');
    fill(); renderLog(); paint(); todo(); if (autoplay) loop();
  }
  window.LIVE = { get state() { return S; }, advance: m => { let n = Math.round(m * 4); while (n-- > 0) tick(0.25); }, jump: m => { S.t = Math.min(END, m); lastMin = -1; tick(0); }, reset, consts: { ONSET, ALERT, ATK_END, DEADLINE } };
  reset(false);
})();
