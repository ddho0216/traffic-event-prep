/* 고객 지원 메뉴: 문자 전파(초안 → 휴대폰 미리보기), 장비 반출입 (전부 가상, 입력한 내용은 이 브라우저에만 저장) */

/* ---------- 문자 전파 ---------- */
(function initSms() {
  const sv = id => document.getElementById(id);
  const CENTERS = Object.values(TOPOLOGY.centers).map(n => n.replace(" 센터", ""));
  sv("smCenter").innerHTML = CENTERS.map(c => `<option>${c}</option>`).join("");
  const SAMPLE = {
    발생: { title: "DDoS 공격 수신", target: "IDC_B_FS1(10.0.0.1)", from: "10/29 03:20", cause: "국제망 DDoS 공격 (확인 중)", impact: "파악중", voc: "파악중", acts: "" },
    경과: { title: "DDoS 공격 수신", target: "IDC_B_FS1(10.0.0.1)", from: "10/29 03:20", cause: "국제망 DDoS 공격", impact: "대상 IP 접속 불가(블랙홀 중)", voc: "없음", acts: "03:30 블랙홀 차단 (198.51.100.77/32)\n03:31 상위 연동망에 블랙홀 요청" },
    완료: { title: "DDoS 공격 수신", target: "IDC_B_FS1(10.0.0.1)", from: "10/29 03:20", to: "10/29 03:41", cause: "국제망 DDoS 공격", impact: "블랙홀 구간(03:30~03:41) 대상 IP 접속 불가", voc: "없음", acts: "03:30 블랙홀 차단 (198.51.100.77/32)\n03:31 상위 연동망에 블랙홀 요청\n03:41 공격 종료 확인 · 블랙홀 해제" }
  };
  let stage = "발생";
  const fields = { title: "smTitle", target: "smTarget", from: "smFrom", to: "smTo", cause: "smCause", impact: "smImpact", voc: "smVoc", acts: "smActs" };
  function fillForm(s) { const d = SAMPLE[s]; sv("smCenter").value = "분당"; Object.entries(fields).forEach(([k, id]) => { sv(id).value = d[k] || ""; }); }
  function parseActs(t) { return t.split("\n").map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(\d{1,2}:\d{2})\s+(.*)$/); return m ? { t: m[1], txt: m[2] } : { t: "", txt: x }; }); }
  function makeDraft() {
    const v = k => sv(fields[k]).value.trim();
    const acts = stage === "발생" ? [] : parseActs(sv("smActs").value).map(a => ({ t: a.t || "--:--", txt: a.txt }));
    return smsNotice({ stage, center: sv("smCenter").value, title: v("title") || "(제목)", target: v("target") || "(대상)", from: v("from") || "(시작 일시)", to: stage === "완료" ? v("to") : "", cause: v("cause") || "(원인)", impact: v("impact") || "파악중", voc: v("voc") || "파악중", actions: acts });
  }
  function setStage(s, fill) {
    stage = s;
    document.querySelectorAll("#smStage button").forEach(b => b.classList.toggle("primary", b.dataset.st === s));
    sv("smToRow").hidden = s !== "완료"; sv("smActsRow").hidden = s === "발생";
    if (fill) fillForm(s);
    sv("smDraft").value = makeDraft(); count();
  }
  const bytes = t => { let n = 0; for (const ch of t) n += ch.charCodeAt(0) > 127 ? 2 : 1; return n; };
  function count() { const t = sv("smDraft").value; sv("smCount").textContent = `${[...t].length}자 · 약 ${bytes(t)}바이트 (한글 2바이트 기준)`; }
  sv("smStage").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setStage(b.dataset.st, true); });
  Object.values(fields).concat(["smCenter"]).forEach(id => sv(id).addEventListener("input", () => { sv("smDraft").value = makeDraft(); count(); }));
  sv("smDraft").addEventListener("input", count);
  sv("smReset").onclick = () => setStage(stage, true);
  sv("smCopy").onclick = async () => { try { await navigator.clipboard.writeText(sv("smDraft").value); sv("smMsg").textContent = "복사했습니다"; } catch (e) { sv("smDraft").select(); sv("smMsg").textContent = "선택했습니다. Ctrl+C로 복사하세요"; } };
  const phoneText = t => esc(t).replace(/\n/g, "<br>");
  window.openPhone = (text, clock) => {   // 다른 화면(실시간 대응)에서도 같은 휴대폰 미리보기를 쓴다
    const t = String(text).trim(), lines = t.split("\n"), first = lines[0] || COMPANY, ck = clock || "03:21";
    sv("phBody").innerHTML = `<div class="ph-date">오늘 ${esc(ck)}</div><div class="ph-bubble">${phoneText(t)}</div><div class="ph-time">${esc(ck)}</div>`;
    sv("phClock").textContent = ck; sv("phName").textContent = first.replace(/^\[|\]$/g, "");
    sv("phWarn").textContent = bytes(t) > 90 ? `약 ${bytes(t)}바이트라서 일반 문자(SMS)가 아니라 장문(LMS)으로 가는 길이입니다 (기준은 현장 시스템에 따라 다를 수 있음)` : "짧은 문자 길이입니다";
    sv("phone").hidden = false; sv("phoneClose").focus();
  };
  function showPhone() {
    const t = sv("smDraft").value.trim(); if (!t) { sv("smMsg").textContent = "초안이 비어 있습니다"; return; }
    openPhone(t, sv("smClock").value);
  }
  sv("smPhone").onclick = showPhone;
  sv("phoneClose").onclick = () => { sv("phone").hidden = true; };
  sv("phone").addEventListener("click", e => { if (e.target === sv("phone")) sv("phone").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !sv("phone").hidden) sv("phone").hidden = true; });
  setStage("발생", true);
})();

/* ---------- 장비 반출입 ---------- */
(function initGear() {
  const gv = id => document.getElementById(id);
  const KEY = "gear:v1";
  const SEED = [   // 전부 가상
    { id: 1, dir: "반입", when: "2026-10-12T10:30", name: "IDC_B_FS9 (신규)", model: "Juniper QFX5120 (가상 표기)", qty: 1, company: "예시네트웍스", who: "(업체 담당자)", mine: "(관제 담당자)", center: "분당", purpose: "신규 설치", note: "랙 IDC_B_R09 장착 예정" },
    { id: 2, dir: "반출", when: "2026-10-15T15:10", name: "IDC_B_AS4", model: "Huawei 접속 스위치 (가상 표기)", qty: 1, company: "샘플서비스", who: "(업체 담당자)", mine: "(관제 담당자)", center: "분당", purpose: "폐기", note: "유지보수 만료 장비" },
    { id: 3, dir: "반입", when: "2026-10-22T09:40", name: "예비 SFP+ 10G LR", model: "SFP+ LR (가상 표기)", qty: 4, company: "가상광통신", who: "(업체 담당자)", mine: "(관제 담당자)", center: "안산", purpose: "예비품 보충", note: "" },
    { id: 4, dir: "반출", when: "2026-10-26T16:00", name: "IDC_G_FR2", model: "Cisco 대형 섀시 (가상 표기)", qty: 1, company: "예시네트웍스", who: "(업체 담당자)", mine: "(관제 담당자)", center: "구로", purpose: "수리 의뢰", note: "수리 후 재반입 예정" }
  ];
  const load = () => store.get(KEY, null) || SEED;
  const save = rows => store.set(KEY, rows);
  gv("gCenter").innerHTML = Object.values(TOPOLOGY.centers).map(n => `<option>${n.replace(" 센터", "")}</option>`).join("");
  const nowIso = () => { const d = new Date(); d.setSeconds(0, 0); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  gv("gWhen").value = nowIso();
  gv("gCenter").value = "분당";
  let filter = "전체";
  function render() {
    const rows = load().slice().sort((a, b) => b.when.localeCompare(a.when));
    const sum = d => rows.filter(r => r.dir === d).reduce((s, r) => s + r.qty, 0);
    gv("gSum").innerHTML = `<span class="tag ok">반입 ${sum("반입")}대</span> <span class="tag warn">반출 ${sum("반출")}대</span> <span class="muted">기록 ${rows.length}건</span>`;
    const shown = rows.filter(r => filter === "전체" || r.dir === filter);
    gv("gTbl").innerHTML = `<tr><th>일시</th><th>구분</th><th>장비 이름</th><th>모델명</th><th>수량</th><th>회사</th><th>업체 담당자</th><th>우리 담당자</th><th>센터</th><th>사유</th><th></th></tr>` +
      (shown.map(r => `<tr><td class="mono">${esc(r.when.replace("T", " "))}</td><td><span class="tag ${r.dir === "반입" ? "ok" : "warn"}">${r.dir}</span></td><td>${esc(r.name)}</td><td>${esc(r.model)}</td><td>${r.qty}대</td><td>${esc(r.company)}</td><td>${esc(r.who)}</td><td>${esc(r.mine)}</td><td>${esc(r.center)}</td><td>${esc(r.purpose)}${r.note ? ` <span class="muted">· ${esc(r.note)}</span>` : ""}</td><td><button class="btn sm" data-del="${r.id}">삭제</button></td></tr>`).join("") || `<tr><td colspan="11" class="muted">기록이 없습니다</td></tr>`);
    document.querySelectorAll("#gFilter button").forEach(b => b.classList.toggle("primary", b.dataset.f === filter));
  }
  gv("gFilter").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { filter = b.dataset.f; render(); } });
  gv("gTbl").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) { save(load().filter(r => String(r.id) !== b.dataset.del)); render(); } });
  gv("gSave").onclick = () => {
    const v = id => gv(id).value.trim(), dir = document.querySelector("input[name=gDir]:checked").value, qty = Math.floor(Number(gv("gQty").value));
    const miss = [["gName", "장비 이름"], ["gModel", "모델명"], ["gCompany", "반출입 회사"], ["gMine", "우리 담당자"]].filter(([id]) => !v(id)).map(x => x[1]);
    if (!(qty >= 1)) miss.push("수량(1 이상)");
    if (!v("gWhen")) miss.push("일시");
    if (miss.length) { gv("gMsg").textContent = `빠진 항목: ${miss.join(", ")}`; gv("gMsg").style.color = "var(--warn,#e8a23b)"; return; }
    const rows = load(), id = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    rows.push({ id, dir, when: v("gWhen"), name: v("gName"), model: v("gModel"), qty, company: v("gCompany"), who: v("gWho") || "-", mine: v("gMine"), center: gv("gCenter").value, purpose: gv("gPurpose").value, note: v("gNote") });
    save(rows); gv("gMsg").textContent = `${dir} 기록을 저장했습니다 (${v("gName")} ${qty}대)`; gv("gMsg").style.color = "";
    ["gName", "gModel", "gWho", "gNote"].forEach(i => { gv(i).value = ""; }); gv("gQty").value = 1; render();
  };
  gv("gCsv").onclick = () => {
    const rows = load().slice().sort((a, b) => a.when.localeCompare(b.when)), q = s => `"${String(s).replace(/"/g, '""')}"`;
    downloadCsv("gear_log.csv", ["일시,구분,장비 이름,모델명,수량,회사,업체 담당자,우리 담당자,센터,사유,비고"].concat(rows.map(r => [r.when.replace("T", " "), r.dir, r.name, r.model, r.qty, r.company, r.who, r.mine, r.center, r.purpose, r.note].map(q).join(","))).join("\n"));
  };
  render();
})();
