/* 자동 대응 (시험판): 한꺼번에 들어온 알림을 정해 둔 규칙대로 자동 처리하고, 위험한 조치(블랙홀)는 권한 있는 사람이 승인해야 실행한다.
   흐름: 맥락 붙이기 → 경로 나누기 → (안전장치: 중복 건너뛰기 · 동시 블랙홀 한도) → 승인 → 실행 → (연결 실패 시 재시도) → 감사 기록·확인 필요 목록.
   규칙 기반이라 AI 호출이 없고, 같은 입력이면 항상 같은 결과가 나온다.
   모든 알림·IP·고객사·클린존 명단·한도·재시도 횟수는 가상이고 제가 정한 가정이다. */
(function initSoar() {
  const root = document.getElementById("tab-soar");
  if (!root) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CLEAN_ZONE = ["샘플비디오", "가상스트림"];   // 클린존 가입 고객사 명단 (가정)
  const MAX_BH = 2, MAX_TRIES = 3;                  // 동시에 걸 수 있는 블랙홀 수, 한 조치의 최대 시도 횟수 (가정)
  const ALERTS = [
    { id: "INC-101", at: "2026-10-29T03:12", link: "IDC_B_FS1_UP2", ip: "198.51.100.77", cust: "가상물산", now: 10.1, usual: 3.3 },
    { id: "INC-102", at: "2026-10-29T03:14", link: "IDC_B_FS1_UP2", ip: "198.51.100.77", cust: "가상물산", now: 10.3, usual: 3.3 },
    { id: "INC-103", at: "2026-10-02T20:35", link: "IDC_B_FS1_UP1", ip: "203.0.113.15", cust: "예제게임월드", now: 13.0, usual: 8.4 },
    { id: "INC-104", at: "2026-10-29T03:16", link: "IDC_S_FS1_UP1", ip: "203.0.113.40", cust: "샘플비디오", now: 9.6, usual: 3.1 },
    { id: "INC-105", at: "2026-10-29T03:18", link: "IDC_B_FS1_UP2", ip: "198.51.100.90", cust: "데모포털", now: 8.8, usual: 3.0 },
    { id: "INC-106", at: "2026-10-29T03:19", link: "IDC_B_FS1_UP2", ip: "198.51.100.91", cust: "시험데이터", now: 8.5, usual: 3.2 }
  ];
  const FAIL_PLAN0 = { "INC-104|클린존 우회": 1, "INC-101|연동망 요청": 2, "INC-105|연동망 요청": 99 };   // 연습용으로 일부러 일으키는 연결 실패 횟수
  let S;
  const fresh = () => ({ ran: false, role: "신입", rows: ALERTS.map(a => ({ a, route: "", why: "", status: "대기 전", ctx: [] })), log: [], clock: 3 * 60 + 20, bh: [], plan: Object.assign({}, FAIL_PLAN0) });
  const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const say = (id, action, text) => { S.log.push({ t: hm(S.clock), id, action, text }); S.clock += 1; };
  const eventAt = at => (typeof DATA !== "undefined" ? DATA.events : []).find(ev => at >= ev.start && at <= ev.end) || null;

  /* 연결 실패면 최대 MAX_TRIES번까지 다시 시도한다. 성공하면 시도 횟수를, 끝내 실패하면 null을 돌려준다. */
  function withRetry(id, action) {
    const key = id + "|" + action;
    for (let n = 1; n <= MAX_TRIES; n++) {
      if ((S.plan[key] || 0) > 0) { S.plan[key]--; say(id, action, `연결 실패 (시도 ${n}/${MAX_TRIES})`); continue; }
      say(id, action, n === 1 ? "성공" : `성공 (시도 ${n}회)`);
      return n;
    }
    say(id, action, `실패: ${MAX_TRIES}회 모두 실패 — 담당자 확인 필요`);
    return null;
  }

  /* 1단계: 알림마다 맥락을 붙이고 경로를 정한 뒤, 자동으로 해도 되는 것만 실행한다. */
  function run() {
    if (S.ran) return;
    S.ran = true;
    const seen = new Set();
    S.rows.forEach(r => {
      const a = r.a, ev = eventAt(a.at), zone = CLEAN_ZONE.includes(a.cust), dup = seen.has(a.ip);
      r.ctx = [ev ? `이벤트 중: ${ev.name}` : "이벤트 없음", zone ? "클린존 가입" : "클린존 미가입", dup ? "이미 처리 중인 IP" : "처음 보는 IP"];
      seen.add(a.ip);
      if (dup) { r.route = "중복 건너뜀"; r.why = "같은 IP를 이미 처리 중이라 다시 처리하지 않음"; r.status = "종료"; say(a.id, "전체", r.why); }
      else if (ev) { r.route = "오탐 종료"; r.why = `${ev.name} 시간대의 정상 증가로 판단`; r.status = "종료"; say(a.id, "전체", `오탐 종료 — ${r.why}`); }
      else if (zone) {
        r.route = "클린존 우회"; r.why = "클린존 가입 고객사라 승인 없이 자동 처리";
        const n = withRetry(a.id, "클린존 우회");
        r.status = n ? "조치됨" : "일부 실패";
      } else { r.route = "블랙홀 승인 필요"; r.why = "클린존 미가입이라 블랙홀이 필요하고, 그 IP의 정상 접속도 끊기므로 조장 승인 필요"; r.status = "승인 대기"; say(a.id, "전체", `승인 대기 — ${r.why}`); }
    });
  }

  /* 2단계: 사람의 결정을 적용한다. 권한이 없으면 실행하지 않고 기록만 남긴다. */
  function decide(id, result, who) {
    const r = S.rows.find(x => x.a.id === id), by = who || S.role;
    if (!r || r.status !== "승인 대기") return "해당 없음";
    if (by !== "조장") { say(id, "전체", `권한 없음 — ${by}의 ${result} 시도 (실행하지 않음)`); return "권한 없음"; }
    if (result === "거절") { r.status = "종료"; say(id, "전체", "거절됨 (승인: 조장)"); return "거절 처리"; }
    if (S.bh.length >= MAX_BH) { r.status = "한도 초과"; say(id, "블랙홀", `동시 블랙홀 한도(${MAX_BH}건) 초과 — 실행하지 않음, 담당자 확인 필요`); return "한도 초과"; }
    S.bh.push(r.a.ip);
    say(id, "블랙홀", `set routing-options static route ${r.a.ip}/32 discard (승인: 조장)`);
    r.status = withRetry(id, "연동망 요청") ? "조치됨" : "일부 실패";
    return "실행 완료";
  }
  const needCheck = () => S.rows.filter(r => ["일부 실패", "한도 초과", "승인 대기"].includes(r.status));

  function paint() {
    const tag = s => `<span class="tag ${{ "조치됨": "ok", "종료": "", "승인 대기": "warn", "일부 실패": "crit", "한도 초과": "crit" }[s] || ""}">${esc(s)}</span>`;
    const rows = S.rows.map(r => {
      const a = r.a, pend = r.status === "승인 대기";
      return `<tr><td class="mono"><b>${a.id}</b><br><span class="muted">${a.at.slice(5, 10).replace("-", "/")} ${a.at.slice(11)}</span></td>
        <td><span class="mono">${a.link}</span><br><span class="muted">${a.cust} · ${a.ip}</span><br><span class="muted">${a.now}G (평소 ${a.usual}G)</span></td>
        <td class="so-ctx">${r.ctx.length ? r.ctx.map(c => `<span class="tag">${esc(c)}</span>`).join(" ") : '<span class="muted">실행 전</span>'}</td>
        <td>${r.route ? `<b>${esc(r.route)}</b><br><span class="muted">${esc(r.why)}</span>` : '<span class="muted">-</span>'}</td>
        <td>${tag(r.status)}${pend ? `<div class="so-btns"><button class="btn sm primary" data-d="승인" data-id="${a.id}">승인</button><button class="btn sm" data-d="거절" data-id="${a.id}">거절</button></div>` : ""}</td></tr>`;
    }).join("");
    const chk = needCheck();
    root.querySelector("#soBody").innerHTML = `
      <div class="toolbar"><span class="muted">지금 누르는 사람</span>
        <span class="seg" id="soRole"><button class="btn${S.role === "신입" ? " on" : ""}" data-r="신입">신입 (승인 권한 없음)</button><button class="btn${S.role === "조장" ? " on" : ""}" data-r="조장">조장 (승인 권한 있음)</button></span>
        <button class="btn primary" id="soRun" ${S.ran ? "disabled" : ""}>▶ 자동 대응 실행</button><button class="btn" id="soReset">처음부터</button>
        <span class="muted">블랙홀 ${S.bh.length}/${MAX_BH}건 사용 중</span></div>
      <div class="card" style="padding:0;overflow:auto"><table class="so-tbl"><tr><th>알림</th><th>회선 · 대상</th><th>붙은 맥락</th><th>경로</th><th>상태 · 결정</th></tr>${rows}</table></div>
      <div class="so-two"><div class="card"><h3>담당자 확인이 필요한 건 <span class="tag ${chk.length ? "warn" : "ok"}">${chk.length}</span></h3>${chk.length ? chk.map(r => `<div class="so-chk"><b>${r.a.id}</b> ${esc(r.a.cust)} · ${esc(r.status)}</div>`).join("") : '<p class="muted">없습니다.</p>'}</div>
      <div class="card"><h3>감사 기록 <span class="muted">누가 무엇을 했는지</span></h3>${S.log.length ? `<div class="so-log">${S.log.map(l => `<div><span class="mono muted">${l.t}</span> <b>${l.id}</b> ${esc(l.action)} · ${esc(l.text)}</div>`).join("")}</div>` : '<p class="muted">아직 기록이 없습니다. 자동 대응을 실행하세요.</p>'}</div></div>`;
  }

  root.innerHTML = `<div class="card"><h2 style="margin-top:0">자동 대응 <small class="beta">시험판</small></h2>
    <p class="note">한꺼번에 들어온 알림 6건을 정해 둔 규칙대로 처리합니다. 처리 순서: <b>맥락 붙이기</b>(이벤트 일정·클린존 가입·중복 여부) → <b>경로 나누기</b>(오탐 종료 · 중복 건너뜀 · 클린존 우회 · 블랙홀 승인 필요) → 자동 실행 → <b>승인</b>(조장만) → 연결이 실패하면 <b>재시도</b>(최대 ${MAX_TRIES}번) → <b>감사 기록</b>.</p>
    <details class="fold"><summary>이 규칙이 필요한 이유와 가정</summary><ul class="rbpts"><li>블랙홀은 공격받는 IP로 가는 트래픽을 전부 버립니다. 그 IP의 정상 접속도 끊기므로 권한 있는 사람이 승인한 뒤에만 실행합니다.</li><li>같은 IP의 알림이 여러 번 와도 한 번만 처리합니다. 경기 때처럼 정상적으로 트래픽이 느는 시간에는 공격으로 보고 막지 않습니다.</li><li>블랙홀은 동시에 ${MAX_BH}건까지만 걸 수 있습니다. 알림이 몰려도 한꺼번에 많이 막지 않도록 하는 안전장치입니다.</li><li>클린존 가입 명단(샘플비디오·가상스트림), 한도 ${MAX_BH}건, 재시도 ${MAX_TRIES}번, 연결 실패 상황은 모두 제가 정한 가정입니다. 모든 값은 가상이고 실제 장비를 건드리지 않습니다.</li></ul></details></div>
    <div id="soBody"></div>`;
  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "soRun") run();
    else if (b.id === "soReset") S = fresh();
    else if (b.dataset.r) S.role = b.dataset.r;
    else if (b.dataset.d) decide(b.dataset.id, b.dataset.d);
    else return;
    paint();
  });
  S = fresh(); paint();
  window.SOAR = { get state() { return S; }, run: () => { run(); paint(); }, decide: (id, r, who) => { const x = decide(id, r, who); paint(); return x; }, reset: () => { S = fresh(); paint(); }, ALERTS, MAX_BH, MAX_TRIES };
})();
