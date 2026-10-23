// ===== Interface =====
const $app = () => document.getElementById("app");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let CUR = "fr";
function t(k, v) {
  const d = I18N[CUR] || I18N.fr; let s = d[k];
  if (s == null) s = I18N.fr[k] != null ? I18N.fr[k] : k;
  if (v) s = s.replace(/\{(\w+)\}/g, (_, x) => v[x] != null ? v[x] : "");
  return s;
}
const fmtDate = (s, opts) => new Intl.DateTimeFormat(CUR === "fr" ? "fr-FR" : "es-ES", opts).format(parseYmd(s));
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const langName = L => t("lang_" + L);
let toastTimer;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

// ---------- vozes ----------
// Só vozes nativas: código exato fr-FR / es-ES, sem vozes multilíngues nem vozes de efeito.
const BAD_VOICE = /multilingual|multilingue|eddy|flo\b|grand(ma|pa)|reed|rocko|sandy|shelley|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph/i;
const GOOD_VOICE = { fr: [/google fran/i, /thomas/i, /audrey/i, /aurélie|aurelie/i, /marie/i, /denise/i, /henri/i, /eloise|éloïse/i, /google fran/i], es: [/google español$/i, /google español de españa/i, /mónica|monica/i, /jorge/i, /marisol/i, /elvira/i, /álvaro|alvaro/i, /google español$/i, /google español de españa/i] };
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const all = speechSynthesis.getVoices() || [];
  const score = (L, v) => { const g = GOOD_VOICE[L].findIndex(r => r.test(v.name)); return (/^google/i.test(v.name) ? 0 : /enhanced|premium|améliorée|mejorada|neural|natural/i.test(v.name) ? 10 : 50) + (g < 0 ? 20 : g); };
  const pick = (code, L) => all.filter(v => String(v.lang || "").replace("_", "-").toLowerCase() === code && !BAD_VOICE.test(v.name)).sort((a, b) => score(L, a) - score(L, b));
  APP.voices.fr = pick("fr-fr", "fr"); APP.voices.es = pick("es-es", "es");
}
function chosenVoice(L) {
  loadVoices();
  const list = APP.voices[L]; if (!list.length) return null;
  const want = APP.settings.voice[L];
  return list.find(v => v.name === want) || list[0];
}
let curUtter = null;
function speak(L, text, rate) {
  if (!("speechSynthesis" in window)) { toast(t("noVoice")); return false; }
  const v = chosenVoice(L);
  if (!v) { toast(t("noVoice")); return false; }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v; u.lang = v.lang; u.rate = rate || 0.92; u.volume = 1;
  curUtter = u; // o Safari descarta a fala se nada guardar a referência
  const ss = window.speechSynthesis;
  if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(() => ss.speak(u), 120); }
  else { if (ss.paused) ss.resume(); ss.speak(u); }
  return true;
}
function pollVoices() { let n = 0; const id = setInterval(() => { loadVoices(); if ((APP.voices.fr.length && APP.voices.es.length) || ++n > 20) { clearInterval(id); if (!APP.screen) render(); } }, 250); }

// ---------- caneta vermelha ----------
function penHTML(text, errors) {
  let out = "", pos = 0; const src = String(text || "");
  (errors || []).forEach((e, k) => {
    const n = k + 1, frag = e.frag || "";
    const at = frag ? src.indexOf(frag, pos) : -1;
    if (at >= 0) {
      out += esc(src.slice(pos, at)) + `<span class="mk"><del>${esc(frag)}</del>${e.fix ? `<ins>${esc(e.fix)}</ins>` : ""}<sup>${n}</sup></span>`;
      pos = at + frag.length;
    }
  });
  return out + esc(src.slice(pos));
}
function notesHTML(L, errors, showPt) {
  if (!errors || !errors.length) return "";
  return `<div class="notes" role="list">${errors.map((e, k) => `<div class="note-i" role="listitem"><div class="h"><span class="num">${k + 1}.</span>${e.frag ? `<span><del>${esc(e.frag)}</del> → <span class="fix">${esc(e.fix)}</span></span>` : `<span class="fix">${esc(e.fix)}</span>`}<span class="cat ${e.pt ? "ptf" : ""}">${esc(CATS[L][e.cat] || e.cat)}</span>${e.pt ? `<span class="cat ptf">${t("ptInterf")}</span>` : ""}</div>${e.why ? `<div>${esc(e.why)}</div>` : ""}${showPt && e.why_pt ? `<div class="pt">${esc(e.why_pt)}</div>` : ""}</div>`).join("")}</div>`;
}
const verdictHTML = s => `<span class="verdict ${s === 2 ? "ok" : s === 1 ? "mid" : ""}">${s === 2 ? t("v2") : s === 1 ? t("v1") : t("v0")}</span>`;

// ---------- render raiz ----------
function render() {
  CUR = uiLang();
  document.documentElement.dataset.l = CUR; document.documentElement.lang = CUR;
  const app = $app();
  if (APP.status === "loading") { app.innerHTML = `<div class="wrap"><div class="dayhead"><p class="label">${t("appName")}</p><h1>${t("loading")}</h1></div></div>`; return; }
  if (APP.status === "nodb") { app.innerHTML = `<div class="wrap"><div class="dayhead"><p class="label">${t("appName")}</p><h1>${t("noDbTitle")}</h1></div><div class="card"><p>${t("noDbBody")}</p></div></div>`; return; }
  if (APP.screen) { renderScreen(); return; }
  const tabs = [["today", t("tabToday")], ["notebook", t("tabNotebook")], ["progress", t("tabProgress")]];
  const top = `<header class="top"><nav class="tabs" aria-label="${t("appName")}">${tabs.map(([k, l]) => `<button data-act="tab" data-v="${k}" ${APP.tab === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav><button class="gear" data-act="tab" data-v="settings" aria-label="${t("tabSettings")}" ${APP.tab === "settings" ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></header>`;
  const body = APP.tab === "notebook" ? viewNotebook() : APP.tab === "progress" ? viewProgress() : APP.tab === "settings" ? viewSettings() : viewToday();
  app.innerHTML = top + `<main class="wrap">${body}</main>`;
}

// ---------- HOJE ----------
function viewToday() {
  const date = today();
  syncDayFlags(date);
  const { p, complete } = dayStatus(date);
  const kindLabel = { long: t("kLong"), class: t("kClass"), min: t("kMin") }[p.kind];
  let h = `<section class="dayhead"><p class="label">${esc(fmtDate(date, { weekday: "long" }))}</p><h1>${esc(fmtDate(date, { day: "numeric", month: "long" }))}</h1>
  <div class="row"><span class="pill acc">${kindLabel}</span>${p.langs.map(L => `<span class="pill">${langName(L)}</span>`).join("")}${complete ? `<span class="pill ok">${p.hard ? t("doneMin") : t("doneDay")}</span>` : ""}</div></section>`;
  h += `<section class="streak"><span><b class="mono">${streak()}</b> <span class="muted">${t(streak() === 1 ? "streakDay1" : "streakDays")}</span></span><span><b class="mono">${last28()}</b><span class="muted">/28 ${t("last4w")}</span></span></section>`;
  h += `<section class="toggles" aria-label="${t("classToggles")}">${LANG_LIST.map(L => `<button class="tog" data-act="cls" data-v="${L}" aria-pressed="${classOn(date, L)}"><span class="box"></span>${t("hadClass_" + L)}</button>`).join("")}<button class="tog hard" data-act="hard" aria-pressed="${p.hard}"><span class="box"></span>${t("hardDay")}</button></section>`;
  if (p.hard) h += `<p class="note">${p.cls.length ? t("hardClass") : t("hardNoClass")}</p>`;
  for (const L of LANG_LIST) { const ls = levelStatus(L); if (ls.ready) h += `<div class="card banner"><h3>${t("readyTitle", { lang: langName(L), lv: ls.next })}</h3><p>${t("readyBody")}</p></div>`; }
  if (APP.msg) h += `<div class="card ${APP.msg.warn ? "warnb" : ""}"><p>${esc(APP.msg.text)}</p><div><button class="btn small ghost" data-act="dismiss">${t("ok")}</button></div></div>`;
  if (!APP.sample) h += `<div class="card warnb"><p>${t("noSample")}</p></div>`;

  // folha de tarefas do dia
  const slots = [];
  for (const L of p.cls) slots.push({ kind: "class", L, done: true });
  const doneQ = {}; for (const L of LANG_LIST) doneQ[L] = blocksDone(date, L).slice().sort((a, b) => (a.doneTs || 0) - (b.doneTs || 0));
  const take = L => doneQ[L].shift() || null;
  if (p.monday) {
    const first = lessLang(date), other = first === "fr" ? "es" : "fr", seq = [first, first, other, other];
    seq.forEach((L, i) => { const b = take(L); slots.push({ kind: "block", L, done: !!b, b, texto: i === 2 }); });
  } else {
    for (const r of p.req) for (let i = 0; i < r.n; i++) { const b = take(r.L); slots.push({ kind: "block", L: r.L, done: !!b, b }); }
  }
  const reqLangsOpen = new Set(slots.filter(x => x.kind === "block" && !x.done).map(x => x.L));
  const extras = [];
  for (const L of LANG_LIST) for (const b of doneQ[L]) extras.push({ kind: "block", L, done: true, b, bonus: true });
  for (const b of APP.blocks.filter(x => x.status === "open" && !reqLangsOpen.has(x.lang))) extras.push({ kind: "block", L: b.lang, done: false, b, bonus: true, open: true });
  if (p.essay && !p.hard) { const e = APP.essays.find(x => x.date === date && x.lang === p.essay.L); slots.push({ kind: "essay", L: p.essay.L, done: !!(e && e.status === "done"), started: !!e, optional: p.essay.optional }); }
  for (const L of p.cls) slots.push({ kind: "log", L, done: APP.classes.some(c => c.date === date && c.lang === L) });
  slots.push(...extras);
  let nowSet = false;
  const rows = slots.map((s, i) => {
    let now = false;
    if (!s.done && !nowSet && s.kind !== "log" && !s.bonus) { now = true; nowSet = true; }
    if (s.open) now = true;
    const ob = s.kind === "block" ? APP.blocks.find(b => b.lang === s.L && b.status === "open") : null;
    let title = "", sub = "", act = "";
    if (s.kind === "class") { title = t("classOf", { lang: langName(s.L) }); sub = t("classSub"); }
    if (s.kind === "block") {
      title = ((s.texto || (s.b && s.b.kind === "texto")) ? t("blockText") : t("block")) + " · " + langName(s.L) + (s.bonus ? " · " + t("bonus") : "");
      if (s.done && s.b) {
        const atts = s.b.attempts.map(id => APP.attempts.find(a => a.id === id)).filter(Boolean);
        sub = t("blockScore", { p: atts.reduce((x, a) => x + a.score, 0), n: atts.length * 2, t: mmss(s.b.totalMs || 0) });
        act = `<button class="btn ghost small" data-act="viewBlock" data-v="${s.b.id}">${t("see")}</button>`;
      } else {
        sub = ob && now ? t("resume", { i: ob.attempts.length, n: ob.qids.length }) : s.texto ? t("blockTextSub") : t("blockSub", { n: APP.settings.blockSize[s.L] || 8 });
        if (now) act = `<button class="btn primary small" data-act="openBlock" data-v="${s.L}">${ob ? t("continue") : t("start")}</button>`;
      }
    }
    if (s.kind === "essay") {
      title = t("essayOf", { lang: langName(s.L) }) + (s.optional ? " · " + t("optional") : "");
      sub = t("essaySub");
      if (!s.done && (now || s.optional)) act = `<button class="btn ${now ? "primary" : ""} small" data-act="openEssay" data-v="${s.L}">${s.started ? t("continue") : t("start")}</button>`;
    }
    if (s.kind === "log") {
      title = t("logOf", { lang: langName(s.L) }); sub = s.done ? t("logDone") : t("logSub");
      if (!s.done) act = `<button class="btn small" data-act="openLog" data-v="${s.L}">${t("note")}</button>`;
    }
    return `<div class="slot ${s.done ? "done" : ""} ${now ? "now" : ""}"><span class="n">${s.done ? "✓" : s.bonus ? "+" : i + 1}</span><div class="t"><b>${esc(title)}</b><span>${esc(sub)}</span></div><div>${act}</div></div>`;
  });
  h += `<section class="runsheet" aria-label="${t("todayPlan")}">${rows.join("") || `<div class="slot done"><span class="n">✓</span><div class="t"><b>${t("onlyClass")}</b></div><div></div></div>`}</section>`;
  if (complete) {
    const langs = p.monday ? LANG_LIST : p.langs;
    h += `<section class="card"><h3>${t("moreTitle")}</h3><p class="note">${t("moreSub")}</p><div class="row">${langs.map(L => `<button class="btn" data-act="openBlock" data-v="${L}">${t("oneMore")} · ${langName(L)}</button>`).join("")}</div></section>`;
  }
  return h;
}

// ---------- TELAS DE FOCO ----------
function renderScreen() {
  const s = APP.screen;
  if (s.kind === "block") return renderBlock();
  if (s.kind === "blockdone") return renderBlockDone();
  if (s.kind === "essay") return renderEssay();
  if (s.kind === "classlog") return renderClassLog();
  if (s.kind === "wait") { $app().innerHTML = `<div class="focus"><div class="fbar"><div class="row"><span class="label">${esc(s.title || "")}</span></div></div><div class="sheetp"><p class="thinking">${esc(s.text || t("thinking"))}</p></div></div>`; }
}
const blk = () => APP.blocks.find(b => b.id === APP.screen.blockId);
function focusBar(label, ms, targetMs, right) {
  const pct = Math.min(100, (ms / targetMs) * 100), late = ms > targetMs;
  return `<div class="fbar"><div class="row"><span class="label">${esc(label)}</span><span class="row" style="flex-wrap:nowrap"><span class="clock ${late ? "late" : ""}" id="clock">${mmss(ms)} / ${mmss(targetMs)}</span>${right || ""}<button class="btn ghost small" data-act="closeScreen">${t("close")}</button></span></div><div class="tbar ${late ? "late" : ""}" id="tbar"><i style="width:${pct}%"></i></div></div>`;
}
function blockElapsed() { const b = blk(), s = APP.screen; return (b ? b.totalMs || 0 : 0) + (s.segStart ? Date.now() - s.segStart : 0); }
const typeInstr = q => t("ty_" + q.ty);

function renderBlock() {
  const s = APP.screen, b = blk();
  if (!b) { APP.screen = null; return render(); }
  const q = qById(b.qids[s.idx]);
  if (!q) { s.idx++; if (s.idx >= b.qids.length) return finishBlock(); return renderBlock(); }
  const L = b.lang;
  const dots = b.qids.map((id, i) => { const a = APP.attempts.find(x => x.id === b.attempts[i]); return `<i class="${a ? "d" + a.score : ""} ${i === s.idx ? "cur" : ""}"></i>`; }).join("");
  let h = focusBar(`${t("block")} · ${langName(L)} · ${s.idx + 1}/${b.qids.length}`, blockElapsed(), 10 * 60000);
  h += `<div class="dots" aria-hidden="true">${dots}</div>`;
  if (b.kind === "texto" && b.text && q.src === "texto") h += `<article class="card"><p class="label">${t("readFirst")}</p><h2>${esc(b.text.title)}</h2><p style="white-space:pre-wrap">${esc(b.text.body)}</p></article>`;
  const tp = TOPIC[q.t];
  h += `<section class="sheetp"><div class="meta"><span class="cat">${esc(tp.n)}</span><span class="cat">${anyLevel(q) ? APP.st[L].level : q.lv}</span>${q.src !== "seed" && q.src !== "prova" ? `<span class="cat">${t("src_" + q.src)}</span>` : ""}${APP.st[L].srs[q.id] && s.phase === "answer" ? `<span class="cat">${t("review")}</span>` : ""}</div>`;
  h += `<p class="qinstr">${esc(q.i || typeInstr(q))}</p>`;
  if (q.ty === "dit") {
    h += `<div class="listen"><button class="btn" data-act="listen" data-v="1" ${s.replays >= 3 || s.phase !== "answer" ? "disabled" : ""}>${t("listen")}</button><button class="btn" data-act="listen" data-v="0.7" ${s.replays >= 3 || s.phase !== "answer" ? "disabled" : ""}>${t("slower")}</button><span class="note mono">${s.replays}/3</span>${chosenVoice(L) ? `<span class="note">· ${esc(chosenVoice(L).name)}</span>` : ""}</div>${s.phase === "answer" ? `<div class="row"><button class="btn ghost small" data-act="badAudio">${t("badAudio")}</button></div>` : ""}`;
    if (s.phase !== "answer") h += `<p class="qprompt">${esc(q.p)}</p>`;
  } else {
    if (q.ty === "cloze") {
      const parts = q.p.split("___"), a = s.phase === "result" ? APP.attempts.find(x => x.id === s.attId) : null;
      h += `<p class="qprompt cloze">${parts.map((p, i) => esc(p) + (i < parts.length - 1 ? (s.phase === "answer" ? `<input class="blank" id="bl${i}" lang="${L}" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="${i + 1}" value="${esc((s.blanks || [])[i] || "")}">` : clozeCell(q, a, i)) : "")).join("")}</p>`;
    } else h += `<p class="qprompt ${q.ty === "trad" ? "pt" : ""}">${esc(q.p)}</p>`;
  }
  if (s.phase === "answer") {
    if (q.ty === "mc") h += `<div class="opts">${q.o.map(o => `<button class="opt" data-act="sel" data-v="${esc(o)}" aria-pressed="${s.sel === o}">${esc(o)}</button>`).join("")}</div>`;
    else if (q.ty !== "cloze") h += `<textarea id="ans" rows="${q.ty === "mini" ? 4 : 2}" lang="${L}" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="${t("yourAnswer")}">${esc(s.draft)}</textarea>`;
    h += `<div class="row"><button class="btn primary" data-act="submit" ${q.ty === "mc" && !s.sel ? "disabled" : ""}>${t("correct")}</button></div>`;
  } else if (s.phase === "correcting") {
    h += `<p class="thinking">${t("correcting")}</p>`;
  } else if (s.phase === "selfgrade") {
    h += `<div class="qa"><b>${t("yourAnswer")}</b><span>${esc(s.draft || s.sel)}</span><b>${t("reference")}</b><span>${q.a.map(esc).join(" · ")}</span></div><p class="note">${t("selfGrade")}</p><div class="row"><button class="btn" data-act="self" data-v="2">${t("v2")}</button><button class="btn" data-act="self" data-v="1">${t("v1")}</button><button class="btn pen" data-act="self" data-v="0">${t("v0")}</button></div>`;
  } else if (s.phase === "result") {
    const a = APP.attempts.find(x => x.id === s.attId);
    h += resultHTML(q, a);
  }
  h += `</section>`;
  if (s.phase === "result") h += `<div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="next">${s.idx + 1 >= b.qids.length ? t("finish") : t("next")}</button></div>`;
  $app().innerHTML = `<div class="focus">${h}</div>`;
  const ta = document.getElementById("ans"); if (ta) { ta.focus(); ta.oninput = () => { s.draft = ta.value; }; }
  const bls = [...document.querySelectorAll("input.blank")];
  bls.forEach((el, i) => { el.oninput = () => { s.blanks = s.blanks || []; s.blanks[i] = el.value; }; el.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); (bls[i + 1] || el).focus(); } }; });
  if (bls[0] && s.phase === "answer") bls[0].focus();
}
// texto completo de referência (lacunas preenchidas com a primeira alternativa)
function refText(q) { return q.ty === "cloze" ? q.p.split("___").map((p, i, arr) => p + (i < arr.length - 1 ? String(q.a[i] || "").split("|")[0] : "")).join("") : q.a[0]; }
function clozeCell(q, a, i) {
  const v = a && a.blanks ? (a.blanks[i] || "") : "", e = a ? (a.errors || []).find(x => x.blank === i) : null;
  return e ? `<span class="mk"><del>${esc(v || "∅")}</del><ins>${esc(e.fix)}</ins></span>` : `<b class="okfill">${esc(v)}</b>`;
}
function resultHTML(q, a) {
  const L = q.l, s = APP.screen;
  const ans = q.ty === "cloze" ? "" : q.ty === "mc" ? `<div class="opts">${q.o.map(o => `<div class="opt ${q.a.includes(o) ? "right" : o === a.answer ? "wrong" : ""}">${esc(o)}</div>`).join("")}</div>`
    : `<p class="pen">${penHTML(a.answer, a.errors)}</p>`;
  let h = `<div class="row" style="justify-content:space-between">${verdictHTML(a.score)}<span class="pill ${a.dif === "easy" ? "ok" : a.dif === "mid" ? "warn" : "pen"}" title="${esc(t(a.difWhy))}">${t("dif_" + a.dif)}</span></div>${ans}`;
  h += `<p class="why">${esc(t(a.difWhy))}</p>`;
  if (a.errors.length) h += notesHTML(L, a.errors, s.showPt);
  if (a.score < 2 || a.corrected) {
    const best = a.corrected && a.score < 2 ? a.corrected : refText(q);
    if (a.score < 2) h += `<div><p class="label">${t("correctVersion")}</p><p class="corr">${esc(best)}</p></div>`;
  }
  if (a.score === 2 && q.a.length && normTxt(q.a[0]) !== normTxt(a.answer) && !QTYPES[q.ty].closed) h += `<p class="note">${t("alsoPossible")} <span class="corr">${esc(q.a[0])}</span></p>`;
  if (a.feedback) h += `<p>${esc(a.feedback)}</p>${s.showPt && a.feedback_pt ? `<p class="pt muted"><i>${esc(a.feedback_pt)}</i></p>` : ""}`;
  if (a.contested) h += `<div class="qa"><b>${a.contested.accepted ? t("contestOk") : t("contestNo")}</b><span>${esc(a.contested.why)}</span>${s.showPt && a.contested.why_pt ? `<i class="muted">${esc(a.contested.why_pt)}</i>` : ""}</div>`;
  for (const d of a.doubts || []) h += `<div class="qa"><b>${esc(d.q)}</b><span>${esc(d.a)}</span>${s.showPt && d.a_pt ? `<i class="muted">${esc(d.a_pt)}</i>` : ""}</div>`;
  h += `<div class="row" style="justify-content:space-between"><button class="ptbtn" data-act="pt">${s.showPt ? t("hidePt") : t("showPt")}</button>${q.src !== "seed" ? `<button class="btn ghost small" data-act="discard">${t("discard")}</button>` : ""}</div>`;
  if (APP.sample) {
    h += `<div class="doubt"><label class="label" for="doubt">${t("doubtLabel")}</label><textarea id="doubt" rows="2" placeholder="${t("doubtPh")}">${esc(s.doubtDraft || "")}</textarea><div class="row"><button class="btn small" data-act="doubt" ${s.busy ? "disabled" : ""}>${t("ask")}</button>${a.score < 2 && !a.contested ? `<button class="btn small pen" data-act="contest" ${s.busy ? "disabled" : ""}>${t("contest")}</button>` : ""}${s.busy ? `<span class="thinking">${t("thinking")}</span>` : ""}</div></div>`;
  }
  return h;
}
function renderBlockDone() {
  const s = APP.screen, b = APP.blocks.find(x => x.id === s.blockId);
  const atts = b.attempts.map(id => APP.attempts.find(a => a.id === id)).filter(Boolean);
  const pts = atts.reduce((x, a) => x + a.score, 0);
  const { complete } = dayStatus(today());
  $app().innerHTML = `<div class="focus"><div class="fbar"><div class="row"><span class="label">${t("block")} · ${langName(b.lang)}</span></div></div>
  <section class="sheetp"><p class="verdict ${pts >= atts.length * 1.7 ? "ok" : "mid"}">${pts}/${atts.length * 2}</p><p>${t("blockDoneBody", { t: mmss(b.totalMs || 0) })}</p>${b.bonus ? `<p class="pill acc" style="justify-self:start">${t("bonus")}</p>` : ""}${complete ? `<p><b>${t("dayCompleteMsg")}</b></p>` : ""}
  <div class="dots">${atts.map(a => `<i class="d${a.score}"></i>`).join("")}</div></section>
  <section class="card">${atts.map((a, k) => { const q = qById(a.qid); return `<div class="err"><div class="row"><span class="mono note">${k + 1}.</span>${verdictHTML(a.score)}<span class="cat">${esc(TOPIC[a.topic] ? TOPIC[a.topic].n : a.topic)}</span></div>${q ? `<p class="small muted">${esc(q.i || typeInstr(q))} ${q.ty === "dit" || q.ty === "cloze" ? "" : "— " + esc(q.p)}</p>` : ""}${q && q.ty === "cloze" ? `<p class="pen cloze" style="font-size:16px;line-height:2">${q.p.split("___").map((p, i, arr) => esc(p) + (i < arr.length - 1 ? clozeCell(q, a, i) : "")).join("")}</p>` : `<p class="pen" style="font-size:16px;line-height:2">${penHTML(a.answer, a.errors)}</p>`}${a.score < 2 && q && q.ty !== "cloze" ? `<p class="corr">${esc(a.corrected || refText(q))}</p>` : ""}${(a.errors || []).filter(e => e.why).map(e => `<p class="why">${esc(e.why)}</p>`).join("")}</div>`; }).join("")}</section>
  <div class="row"><button class="btn primary" data-act="closeScreen">${t("back")}</button>${complete ? `<button class="btn" data-act="openBlock" data-v="${b.lang}">${t("oneMore")}</button>` : ""}</div></div>`;
}

// ---------- REDAÇÃO ----------
function renderEssay() {
  const s = APP.screen, e = APP.essays.find(x => x.id === s.essayId), L = s.lang;
  if (!e) { APP.screen = null; return render(); }
  const task = e.task, cfg = ESSAY_LEVELS[e.lv] || ESSAY_LEVELS.A2;
  const stage = e.stage;
  const targets = { plan: 3, write: 15, rewrite: 6 };
  const ms = (e[stage + "Ms"] || 0) + (s.segStart && targets[stage] ? Date.now() - s.segStart : 0);
  let h = targets[stage] ? focusBar(`${t("essay")} · ${langName(L)} · ${t("st_" + stage)}`, ms, targets[stage] * 60000) : `<div class="fbar"><div class="row"><span class="label">${t("essay")} · ${langName(L)}</span><button class="btn ghost small" data-act="closeScreen">${t("close")}</button></div></div>`;
  const scaffold = full => {
    let x = `<div class="scaffold"><p class="label">${esc(task.fmt)} · ${cfg.words[0]}–${cfg.words[1]} ${t("words")}</p><p class="qprompt">${esc(task.sit)}</p>`;
    if (task.pts && task.pts.length && cfg.scaffold !== "task" && cfg.scaffold !== "open") x += `<div><p class="label">${t("mustInclude")}</p><ul>${task.pts.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
    if (full && cfg.scaffold === "full") {
      if (task.sk && task.sk.length) x += `<div><p class="label">${t("skeleton")}</p><ul>${task.sk.map(p => `<li><i>${esc(p)}</i></li>`).join("")}</ul></div>`;
      if (task.voc && task.voc.length) x += `<div><p class="label">${t("usefulWords")}</p><div class="chips">${task.voc.map(w => `<span class="chip">${esc(w)}</span>`).join("")}</div></div>`;
    }
    if (full && (cfg.scaffold === "full" || cfg.scaffold === "points") && task.con && task.con.length) x += `<div><p class="label">${t("connectors")}</p><div class="chips">${task.con.map(w => `<span class="chip">${esc(w)}</span>`).join("")}</div></div>`;
    return x + `</div>`;
  };
  if (stage === "task") {
    h += `<section class="sheetp">${scaffold(true)}</section><div class="row"><button class="btn primary" data-act="essayGo" data-v="plan">${t("startPlan")}</button>${APP.sample ? `<button class="btn" data-act="newTask" ${s.busy ? "disabled" : ""}>${s.busy ? t("thinking") : t("otherTask")}</button>` : ""}</div>`;
  } else if (stage === "plan") {
    h += `<section class="sheetp">${scaffold(true)}<label class="label" for="planIn">${t("planLabel")}</label><textarea id="planIn" rows="6" placeholder="${t("planPh")}">${esc(e.plan || "")}</textarea></section><div class="row"><button class="btn primary" data-act="essayGo" data-v="write">${t("toWrite")}</button></div>`;
  } else if (stage === "write") {
    const wc = wordCount(e.text);
    h += `${e.plan ? `<section class="card"><p class="label">${t("myPlan")}</p><p style="white-space:pre-wrap">${esc(e.plan)}</p></section>` : ""}<details class="card"><summary><b>${t("seeTask")}</b></summary>${scaffold(true)}</details>
    <section class="sheetp"><textarea id="essayIn" class="essay-in" lang="${L}" spellcheck="false" autocapitalize="sentences" placeholder="${t("writeHere")}">${esc(e.text || "")}</textarea><div class="row" style="justify-content:space-between"><span class="wc ${wc >= cfg.words[0] && wc <= cfg.words[1] ? "ok" : ""}" id="wc">${wc} ${t("words")} · ${cfg.words[0]}–${cfg.words[1]}</span></div></section>
    <div class="row"><button class="btn primary" data-act="essaySubmit" ${APP.sample ? "" : "disabled"}>${t("sendCorrection")}</button></div>`;
  } else if (stage === "correcting" || stage === "correcting2") {
    h += `<section class="sheetp"><p class="thinking">${t("correctingEssay")}</p></section>`;
  } else if (stage === "review" || stage === "rewrite" || stage === "done") {
    const c = e.corr;
    h += `<section class="sheetp"><div class="row" style="justify-content:space-between"><span class="verdict mid">${c.level}</span><span class="mono note">${t("per100", { n: c.per100 })}</span></div><p class="pen" style="white-space:pre-wrap">${penHTML(e.text, c.errors)}</p>${c.comment ? `<p class="margin-note">${esc(c.comment)}</p>${s.showPt && c.comment_pt ? `<p class="pt muted"><i>${esc(c.comment_pt)}</i></p>` : ""}` : ""}${notesHTML(L, c.errors, s.showPt)}<button class="ptbtn" data-act="pt">${s.showPt ? t("hidePt") : t("showPt")}</button></section>`;
    h += `<section class="card"><p class="label">${t("writingSkill")}</p><div class="rubric">${W_KEYS.map(k => rb(t("w_" + k), c.w[k])).join("")}</div><p class="label">${t("languageSkill")}</p><div class="rubric">${L_KEYS.map(k => rb(t("l_" + k), c.l[k])).join("")}</div></section>`;
    if (stage === "review") h += `<div class="row"><button class="btn primary" data-act="essayGo" data-v="rewrite">${t("toRewrite")}</button></div>`;
    if (stage === "rewrite") {
      h += `<details class="card"><summary><b>${t("fixList")}</b> <span class="note">· ${t("fixHint")}</span></summary><div class="bars" style="margin-top:10px">${c.errors.map((x, k) => `<div class="small"><span class="mono">${k + 1}.</span> ${x.frag ? `<del>${esc(x.frag)}</del> → ` : ""}<span class="fix" style="font-family:var(--hand);color:var(--pen);font-size:17px">${esc(x.fix)}</span></div>`).join("")}</div></details><section class="sheetp"><p class="qinstr">${t("rewriteInstr")}</p><textarea id="rewriteIn" class="essay-in" lang="${L}" spellcheck="false" placeholder="${t("writeHere")}">${esc(e.rewrite || "")}</textarea><div class="row"><button class="btn small" data-act="copyOrig">${t("copyOrig")}</button></div></section><div class="row"><button class="btn primary" data-act="rewriteSubmit" ${APP.sample ? "" : "disabled"}>${t("sendRewrite")}</button></div>`;
    }
    if (stage === "done" && e.rcorr) {
      h += `<section class="sheetp"><p class="label">${t("rewriteTitle")}</p><div class="row" style="justify-content:space-between">${e.rcorr.remaining === 0 ? `<span class="verdict ok">${t("cleanRewrite")}</span>` : `<span class="verdict mid">${t("remaining", { n: e.rcorr.remaining })}</span>`}</div><p class="pen" style="white-space:pre-wrap">${penHTML(e.rewrite, e.rcorr.errors)}</p>${e.rcorr.comment ? `<p class="margin-note">${esc(e.rcorr.comment)}</p>` : ""}${notesHTML(L, e.rcorr.errors, s.showPt)}</section><div class="row"><button class="btn primary" data-act="closeScreen">${t("back")}</button></div>`;
    }
  }
  $app().innerHTML = `<div class="focus">${h}</div>`;
  const bind = (id, field, after) => { const el = document.getElementById(id); if (el) el.oninput = () => { e[field] = el.value; draftSave(e); if (after) after(el.value); }; };
  bind("planIn", "plan");
  bind("essayIn", "text", v => { const wc = wordCount(v), el = document.getElementById("wc"); if (el) { el.textContent = `${wc} ${t("words")} · ${cfg.words[0]}–${cfg.words[1]}`; el.className = "wc " + (wc >= cfg.words[0] && wc <= cfg.words[1] ? "ok" : ""); } });
  bind("rewriteIn", "rewrite");
}
const rb = (label, v) => `<div class="rb"><span class="small">${esc(label)}</span><span class="s">${v}/5</span><span class="bar"><i style="width:${v * 20}%"></i></span></div>`;
let draftTimer;
function draftSave(e) { clearTimeout(draftTimer); draftTimer = setTimeout(() => save("essays", e.id, e), 1500); }

// ---------- REGISTRO DE AULA ----------
function renderClassLog() {
  const s = APP.screen, L = s.lang;
  $app().innerHTML = `<div class="focus"><div class="fbar"><div class="row"><span class="label">${t("logOf", { lang: langName(L) })}</span><button class="btn ghost small" data-act="closeScreen">${t("close")}</button></div></div>
  <section class="sheetp"><div class="field"><label class="label" for="lgTheme">${t("logTheme")}</label><textarea id="lgTheme" rows="2" placeholder="${t("logThemePh_" + L)}">${esc(s.theme || "")}</textarea></div>
  <div class="field"><label class="label" for="lgErr">${t("logErrors")}</label><textarea id="lgErr" rows="3" placeholder="${t("logErrorsPh_" + L)}">${esc(s.errs || "")}</textarea></div>
  <div class="field"><label class="label" for="lgWords">${t("logWords")}</label><textarea id="lgWords" rows="2" placeholder="${t("logWordsPh_" + L)}">${esc(s.words || "")}</textarea></div>
  <button class="tog" data-act="lgGen" aria-pressed="${s.gen !== false}"><span class="box"></span>${t("logGen")}</button>
  <p class="note">${t("logGenNote")}</p></section>
  <div class="row"><button class="btn primary" data-act="logSave">${t("save")}</button></div></div>`;
  for (const [id, f] of [["lgTheme", "theme"], ["lgErr", "errs"], ["lgWords", "words"]]) { const el = document.getElementById(id); el.oninput = () => { s[f] = el.value; }; }
}

// ---------- CADERNO ----------
function viewNotebook() {
  const L = APP.nbLang || CUR, cat = APP.nbCat;
  const items = [];
  for (const a of APP.attempts) if (a.lang === L) (a.errors || []).forEach(e => items.push({ ...e, ts: a.ts, date: a.date, src: "block", topic: a.topic }));
  for (const es of APP.essays) if (es.lang === L && es.corr) es.corr.errors.forEach(e => items.push({ ...e, ts: es.ts, date: es.date, src: "essay" }));
  items.sort((a, b) => b.ts - a.ts);
  const counts = {}; items.forEach(i => counts[i.cat] = (counts[i.cat] || 0) + 1);
  const list = items.filter(i => !cat || i.cat === cat);
  let h = `<section class="dayhead"><p class="label">${t("tabNotebook")}</p><h1>${t("nbTitle")}</h1><div class="row"><span class="seg">${LANG_LIST.map(x => `<button data-act="nbLang" data-v="${x}" aria-pressed="${x === L}">${langName(x)}</button>`).join("")}</span><span class="note">${t("nbCount", { n: items.length })}</span></div></section>`;
  if (!items.length) return h + `<div class="empty">${t("nbEmpty")}</div>`;
  h += `<div class="chips"><button class="chip" data-act="nbCat" data-v="" aria-pressed="${!cat}">${t("all")}</button>${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button class="chip" data-act="nbCat" data-v="${k}" aria-pressed="${cat === k}">${esc(CATS[L][k] || k)} · ${n}</button>`).join("")}</div>`;
  h += `<section class="card">${list.slice(0, APP.nbShow).map(e => `<div class="err"><div class="row"><span class="cat ${e.pt ? "ptf" : ""}">${esc(CATS[L][e.cat] || e.cat)}</span><span class="note">${esc(fmtDate(e.date, { day: "numeric", month: "short" }))} · ${e.src === "essay" ? t("essay") : t("block")}</span></div><div class="ln">${e.frag ? `<del>${esc(e.frag)}</del>` : ""}<ins>${esc(e.fix)}</ins></div>${e.why ? `<p class="why">${esc(e.why)}</p>` : ""}${APP.nbPt && e.why_pt ? `<p class="why"><i>${esc(e.why_pt)}</i></p>` : ""}</div>`).join("")}</section>`;
  h += `<div class="row"><button class="ptbtn" data-act="nbPt">${APP.nbPt ? t("hidePt") : t("showPt")}</button>${list.length > APP.nbShow ? `<button class="btn small" data-act="nbMore">${t("seeMore")}</button>` : ""}</div>`;
  return h;
}

// ---------- PROGRESSO ----------
function viewProgress() {
  const L = APP.progLang || CUR, date = today(), ws = weekStart(date);
  let h = `<section class="dayhead"><p class="label">${t("tabProgress")}</p><h1>${t("progTitle")}</h1></section>`;
  // semana
  h += `<section class="card"><div class="row" style="justify-content:space-between"><h3>${t("thisWeek")}</h3><span class="note"><b class="mono">${streak()}</b> ${t(streak() === 1 ? "streakDay1" : "streakDays")} · <b class="mono">${last28()}</b>/28</span></div><div class="week">${Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), dd = dayDoc(d), n = blocksDone(d).length, bonus = blocksDone(d).filter(b => b.bonus).length;
    const cls = d > date ? "fut" : dd.complete ? (dd.minimal ? "min" : "full") : n ? "part" : "";
    return `<div class="wd ${cls} ${d === date ? "today" : ""}"><b>${esc(fmtDate(d, { weekday: "short" }))}</b><i></i><span class="mono">${n}${bonus ? "+" : ""}</span></div>`;
  }).join("")}</div><p class="note">${t("weekLegend")}</p></section>`;
  h += `<div class="row"><span class="seg">${LANG_LIST.map(x => `<button data-act="progLang" data-v="${x}" aria-pressed="${x === L}">${langName(x)}</button>`).join("")}</span><span class="note">${t("levelSince", { lv: APP.st[L].level, d: levelStatus(L).inLevel })}</span></div>`;
  const ls = levelStatus(L); if (ls.ready) h += `<div class="card banner"><h3>${t("readyTitle", { lang: langName(L), lv: ls.next })}</h3><p>${t("readyBody")}</p></div>`;
  const atts = APP.attempts.filter(a => a.lang === L && a.score != null);
  const firstDate = atts.length ? atts[atts.length - 1].date : null;
  const span = firstDate ? daysBetween(firstDate, date) + 1 : 0;
  const wait = (need, unit) => `<div class="empty">${t("needData", { n: need, u: unit })}</div>`;

  // resumo dos últimos 7 dias (disponível desde o primeiro dia)
  {
    const wk = atts.filter(a => a.date >= addDays(date, -6));
    h += `<section class="card"><h3>${t("sumTitle")}</h3>`;
    if (!wk.length) h += `<div class="empty">${t("noAttempts")}</div>`;
    else {
      const pts = wk.reduce((s, a) => s + a.score, 0), full = wk.filter(a => a.score === 2).length;
      const cc = {}; wk.forEach(a => (a.errors || []).forEach(e => { cc[e.cat] = (cc[e.cat] || 0) + 1; }));
      const ptN = wk.filter(a => a.ptInterf).length;
      const ts = {}; wk.forEach(a => { const o = ts[a.topic] || (ts[a.topic] = { n: 0, pts: 0 }); o.n++; o.pts += a.score; });
      const tl = Object.entries(ts).map(([id, o]) => ({ id, n: o.n, acc: o.pts / (2 * o.n) }));
      const strong = tl.filter(x => x.acc === 1).sort((a, b) => b.n - a.n).slice(0, 4);
      const weak = tl.filter(x => x.acc < 1).sort((a, b) => a.acc - b.acc).slice(0, 4);
      h += `<div class="streak"><span><b class="mono">${Math.round(pts / (2 * wk.length) * 100)}%</b> <span class="muted">${t("sumAcc")}</span></span><span><b class="mono">${full}</b><span class="muted">/${wk.length} ${t("sumFull")}</span></span><span><b class="mono">${ptN}</b> <span class="muted">${t("sumPt")}</span></span></div>`;
      h += `<div class="delta"><div class="bars"><p class="label">${t("sumWeak")}</p>${weak.map(x => `<div class="bar-row"><span class="nm">${esc(TOPIC[x.id].n)}</span><span class="tr"><i class="${x.acc < 0.6 ? "lo" : "mid"}" style="width:${Math.round(x.acc * 100)}%"></i></span><span class="v">${Math.round(x.acc * 100)}%</span></div>`).join("") || `<p class="note">—</p>`}</div><div class="bars"><p class="label">${t("sumStrong")}</p>${strong.map(x => `<div class="bar-row"><span class="nm">${esc(TOPIC[x.id].n)}</span><span class="tr"><i style="width:100%"></i></span><span class="v">${x.n}×</span></div>`).join("") || `<p class="note">—</p>`}</div></div>`;
      const topC = Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topC.length) h += `<div><p class="label">${t("sumCats")}</p><div class="chips">${topC.map(([k, n]) => `<button class="chip" data-act="goNb" data-v="${L}:${k}">${esc(CATS[L][k] || k)} · ${n}</button>`).join("")}</div></div>`;
    }
    h += `</section>`;
  }
  // mapa de calor
  h += `<section class="card"><h3>${t("hmTitle")}</h3><p class="note">${t("hmSub")}</p>`;
  if (span < 7) h += wait(7 - span, t("daysU"));
  else {
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(ws, -7 * (7 - i)));
    const cats = Object.keys(CATS[L]).filter(c => atts.some(a => (a.errors || []).some(e => e.cat === c)));
    const cell = (c, w) => {
      const wa = atts.filter(a => a.date >= w && a.date < addDays(w, 7));
      if (!wa.length) return `<td style="background:var(--sunk)"></td>`;
      const r = wa.filter(a => (a.errors || []).some(e => e.cat === c)).length / wa.length;
      return `<td style="background:color-mix(in srgb, var(--pen) ${Math.round(r * 160)}%, var(--sheet))" title="${Math.round(r * 100)}%">${Math.round(r * 100)}</td>`;
    };
    h += cats.length ? `<div class="hm"><table><thead><tr><th></th>${weeks.map(w => `<th class="mono">${esc(fmtDate(w, { day: "numeric", month: "numeric" }))}</th>`).join("")}</tr></thead><tbody>${cats.map(c => `<tr><th>${esc(CATS[L][c])}</th>${weeks.map(w => cell(c, w)).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">${t("noErrorsYet")}</div>`;
  }
  h += `</section>`;
  // melhorou / piorou
  h += `<section class="card"><h3>${t("deltaTitle")}</h3><p class="note">${t("deltaSub")}</p>`;
  if (span < 56) h += wait(56 - span, t("daysU"));
  else {
    const rate = (from, to, c) => { const w = atts.filter(a => a.date >= from && a.date <= to); return w.length ? w.filter(a => (a.errors || []).some(e => e.cat === c)).length / w.length : 0; };
    const d = Object.keys(CATS[L]).map(c => ({ c, now: rate(addDays(date, -27), date, c), before: rate(addDays(date, -55), addDays(date, -28), c) })).map(x => ({ ...x, delta: x.now - x.before })).filter(x => x.now || x.before);
    const better = d.filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5), worse = d.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    const li = x => `<div class="bar-row"><span class="nm">${esc(CATS[L][x.c])}</span><span class="mono note">${Math.round(x.before * 100)}% → ${Math.round(x.now * 100)}%</span><span class="v">${x.delta > 0 ? "+" : ""}${Math.round(x.delta * 100)}</span></div>`;
    h += `<div class="delta"><div class="bars"><p class="label">${t("better")}</p>${better.map(li).join("") || `<p class="note">—</p>`}</div><div class="bars"><p class="label">${t("worse")}</p>${worse.map(li).join("") || `<p class="note">—</p>`}</div></div>`;
  }
  h += `</section>`;
  // redações
  const ess = APP.essays.filter(e => e.lang === L && e.corr).sort((a, b) => a.ts - b.ts);
  h += `<section class="card"><h3>${t("per100Title")}</h3>`;
  h += ess.length < 2 ? wait(2 - ess.length, t("essaysU")) : lineChart(ess.map(e => e.corr.per100), ess.map(e => fmtDate(e.date, { day: "numeric", month: "numeric" })));
  h += `</section><section class="card"><h3>${t("writingTitle")}</h3><p class="note">${t("writingSub")}</p>`;
  if (ess.length < 2) h += wait(2 - ess.length, t("essaysU"));
  else h += `<div class="bars">${W_KEYS.map(k => { const v = ess.map(e => e.corr.w[k]); return `<div class="bar-row"><span class="nm">${t("w_" + k)}</span>${spark(v)}<span class="v">${v[v.length - 1]}/5</span></div>`; }).join("")}${L_KEYS.map(k => { const v = ess.map(e => e.corr.l[k]); return `<div class="bar-row"><span class="nm">${t("l_" + k)}</span>${spark(v)}<span class="v">${v[v.length - 1]}/5</span></div>`; }).join("")}</div>`;
  h += `</section>`;
  // domínio por tema
  {
    const lsT = levelStatus(L).topics, order = { reopened: 0, exam: 1, training: 2, mastered: 3 };
    const nm = lsT.filter(x => x.state === "mastered").length;
    const row = x => {
      const tp = TOPIC[x.id], pill = { training: "", exam: "warn", mastered: "ok", reopened: "pen" }[x.state] || "";
      const prog = x.state === "reopened" && x.reopen ? t("msReopenProg", { n: x.reopen.n, need: MASTER.reopenN }) : x.state === "mastered" ? "" : t("msProg", { n: Math.min(x.n, MASTER.minN), need: MASTER.minN, s: x.subsOk, t: x.subsN, acc: Math.round(x.acc * 100) });
      const w = x.state === "mastered" ? 100 : Math.round(100 * (Math.min(1, x.n / MASTER.minN) + (x.subsN ? x.subsOk / x.subsN : 1) + Math.min(1, x.acc / MASTER.minAcc)) / 3);
      return `<div class="ms-row"><div class="ms-main"><span class="nm"${SUBS[x.id] ? ` title="${esc(SUBS[x.id].join(" · "))}"` : ""}>${esc(tp.n)}</span>${prog || x.ext28 ? `<span class="note">${prog}${x.ext28 ? `${prog ? " · " : ""}${t("msExt", { n: x.ext28 })}` : ""}</span>` : ""}<span class="tr"><i class="${x.state === "mastered" ? "" : x.state === "reopened" ? "lo" : "mid"}" style="width:${w}%"></i></span></div><span class="pill ${pill}">${t("ms_st_" + x.state)}</span></div>`;
    };
    const active = lsT.filter(x => x.state !== "mastered" && (x.n > 0 || x.state !== "training" || x.ext28)).sort((a, b) => (order[a.state] - order[b.state]) || (b.n - a.n));
    const fresh = lsT.filter(x => x.state === "training" && !x.n && !x.ext28), done = lsT.filter(x => x.state === "mastered");
    h += `<section class="card"><div class="row" style="justify-content:space-between"><h3>${t("topicTitle", { lv: APP.st[L].level })}</h3><span class="mono note">${nm}/${lsT.length}</span></div><p class="note">${t("topicSub")}</p>`;
    h += active.length ? `<div class="ms-list">${active.map(row).join("")}</div>` : `<div class="empty">${t("noAttempts")}</div>`;
    if (done.length) h += `<details><summary><b>${t("ms_st_mastered")}</b> <span class="note">(${done.length})</span></summary><div class="ms-list">${done.map(row).join("")}</div></details>`;
    if (fresh.length) h += `<details><summary><b>${t("msFresh")}</b> <span class="note">(${fresh.length})</span></summary><p class="note">${fresh.map(x => esc(TOPIC[x.id].n)).join(" · ")}</p></details>`;
    h += `</section>`;
  }
  // tempo por tipo
  h += `<section class="card"><h3>${t("timeTitle")}</h3><p class="note">${t("timeSub")}</p>`;
  if (atts.length < 10) h += wait(10 - atts.length, t("answersU"));
  else {
    const by = {}; for (const a of atts.slice(0, 300)) { const o = by[a.type] || (by[a.type] = { n: 0, ms: 0 }); o.n++; o.ms += a.answerMs || 0; }
    h += `<div class="bars">${Object.entries(by).map(([ty, o]) => { const avg = o.ms / o.n / 1000, exp = QTYPES[ty].exp; return `<div class="bar-row"><span class="nm">${t("tn_" + ty)} <span class="note">(${o.n})</span></span><span class="tr"><i class="${avg > exp * 1.5 ? "lo" : avg > exp ? "mid" : ""}" style="width:${Math.min(100, avg / (exp * 2) * 100)}%"></i></span><span class="v">${Math.round(avg)}s</span></div>`; }).join("")}</div>`;
    const done = APP.blocks.filter(b => b.lang === L && b.status === "done").slice(0, 10);
    if (done.length) h += `<p class="note">${t("blockAvg", { t: mmss(done.reduce((s, b) => s + (b.totalMs || 0), 0) / done.length), n: done.length })}</p>`;
  }
  h += `</section>`;
  return h;
}
function spark(v) {
  const w = 120, hgt = 26, n = v.length, x = i => n === 1 ? w / 2 : 4 + i * (w - 8) / (n - 1), y = val => hgt - 4 - (val / 5) * (hgt - 8);
  return `<svg viewBox="0 0 ${w} ${hgt}" style="width:100%;max-width:160px;height:26px" aria-hidden="true"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${v.map((val, i) => `${x(i)},${y(val)}`).join(" ")}"/><circle cx="${x(n - 1)}" cy="${y(v[n - 1])}" r="3" fill="var(--accent)"/></svg>`;
}
function lineChart(vals, labels) {
  const W = 600, H = 200, pl = 34, pr = 12, pt = 12, pb = 28, max = Math.max(5, Math.ceil(Math.max(...vals) / 5) * 5);
  const x = i => vals.length === 1 ? (pl + W - pr) / 2 : pl + i * (W - pl - pr) / (vals.length - 1), y = v => pt + (1 - v / max) * (H - pt - pb);
  const ticks = [0, max / 2, max];
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("per100Title")}">${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${v}</text>`).join("")}<polygon fill="var(--accent-soft)" points="${pl},${y(0)} ${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")} ${x(vals.length - 1)},${y(0)}"/><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === vals.length - 1 ? 5 : 3}" fill="var(--accent)"/>`).join("")}${labels.map((l, i) => (vals.length <= 8 || i % Math.ceil(vals.length / 8) === 0 || i === vals.length - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${esc(l)}</text>` : "").join("")}</svg></div>`;
}

// ---------- AJUSTES ----------
function viewSettings() {
  const L = APP.setLang || CUR;
  let h = `<section class="dayhead"><p class="label">${t("tabSettings")}</p><h1>${t("setTitle")}</h1></section>`;
  // níveis
  h += `<section class="card"><h3>${t("levels")}</h3>${LANG_LIST.map(x => { const st = APP.st[x]; return `<div class="row" style="justify-content:space-between"><span><b>${langName(x)}</b> · ${st.level} <span class="note">${t("since", { d: fmtDate(st.levelSince, { day: "numeric", month: "short" }) })}</span></span><span class="row"><select id="lv_${x}" aria-label="${t("levels")} ${langName(x)}">${LEVELS.map(l => `<option ${l === st.level ? "selected" : ""}>${l}</option>`).join("")}</select>${APP.confirmLv === x ? `<button class="btn small pen" data-act="lvConfirm" data-v="${x}">${t("confirm")}</button>` : `<button class="btn small" data-act="lvChange" data-v="${x}">${t("change")}</button>`}</span></div>`; }).join("")}<p class="note">${t("levelRule")}</p></section>`;
  // tamanho do bloco
  h += `<section class="card"><h3>${t("blockSize")}</h3>${LANG_LIST.map(x => {
    const done = APP.blocks.filter(b => b.lang === x && b.status === "done").slice(0, 10);
    const avg = done.length >= 10 ? done.reduce((s, b) => s + (b.totalMs || 0), 0) / done.length : null;
    const cur = APP.settings.blockSize[x] || 8;
    const sug = avg == null ? null : avg > 12 * 60000 && cur > 6 ? 6 : avg < 8 * 60000 && cur < 10 ? 10 : null;
    return `<div class="row" style="justify-content:space-between"><b>${langName(x)}</b><span class="seg">${[6, 8, 10].map(n => `<button data-act="bsize" data-v="${x}:${n}" aria-pressed="${cur === n}">${n}</button>`).join("")}</span></div>${avg != null ? `<p class="note">${t("blockAvg", { t: mmss(avg), n: 10 })}${sug ? " " + t("suggest", { n: sug }) : ""}</p>${sug ? `<div><button class="btn small" data-act="bsize" data-v="${x}:${sug}">${t("accept", { n: sug })}</button></div>` : ""}` : `<p class="note">${t("blockAvgWait", { n: 10 - done.length })}</p>`}`;
  }).join("")}</section>`;
  // vozes
  h += `<section class="card"><h3>${t("voices")}</h3><p class="note">${t("voicesNote")}</p>${LANG_LIST.map(x => { const list = APP.voices[x], v = chosenVoice(x); return `<div class="field"><label class="label" for="vc_${x}">${langName(x)} · ${x === "fr" ? "fr-FR" : "es-ES"}</label>${list.length ? `<div class="row"><select id="vc_${x}" data-act="voice" data-v="${x}" style="flex:1">${list.map(o => `<option ${v && o.name === v.name ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select><button class="btn small" data-act="testVoice" data-v="${x}">${t("test")}</button></div>` : `<p class="note">${t("noVoice")}</p>`}<button class="tog" data-act="dictToggle" data-v="${x}" aria-pressed="${!(APP.settings.dictOff || {})[x]}"><span class="box"></span>${t("dictOn")}</button></div>`; }).join("")}</section>`;
  // banco
  const ub = unseenByTopic(L), st = APP.st[L];
  const topics = TOPICS[L].filter(tp => ub[tp.id] || tp.lv === st.level || tp.lv === "*");
  h += `<section class="card"><div class="row" style="justify-content:space-between"><h3>${t("bank")}</h3><span class="seg">${LANG_LIST.map(x => `<button data-act="setLang" data-v="${x}" aria-pressed="${x === L}">${langName(x)}</button>`).join("")}</span></div><div class="tbl"><table><thead><tr><th>${t("topic")}</th><th>${t("lvl")}</th><th class="n">${t("total")}</th><th class="n">${t("doneQ")}</th><th class="n">${t("unseen")}</th></tr></thead><tbody>${topics.map(tp => { const u = ub[tp.id] || { total: 0, done: 0, unseen: 0 }; return `<tr><td${SUBS[tp.id] ? ` title="${esc(SUBS[tp.id].join(" · "))}"` : ""}>${esc(tp.n)}</td><td class="mono">${tp.lv === "*" ? "—" : tp.lv}</td><td class="n">${u.total}</td><td class="n">${u.done}</td><td class="n">${u.unseen}</td></tr>`; }).join("")}</tbody></table></div>
  <p class="note">${t("genNote")}</p><div class="row"><button class="btn primary" data-act="genHistory" data-v="${L}" ${APP.genBusy || !APP.sample ? "disabled" : ""}>${APP.genBusy ? t("thinking") : t("genBtn")}</button></div></section>`;
  // calendário
  const wkTpl = [[1, t("tplMon")], [2, t("tplCls", { lang: t("lang_es") })], [3, t("tplCls", { lang: t("lang_fr") })], [4, t("tplCls", { lang: t("lang_es") })], [5, t("tplCls", { lang: t("lang_fr") })], [6, t("tplWe", { lang: t("lang_fr") })], [0, t("tplWe", { lang: t("lang_es") })]];
  h += `<section class="card"><h3>${t("calendar")}</h3><div class="tbl"><table><tbody>${wkTpl.map(([d, l]) => { const ref = addDays(weekStart(today()), (d + 6) % 7); return `<tr><td><b>${esc(fmtDate(ref, { weekday: "long" }))}</b></td><td>${esc(l)}</td></tr>`; }).join("")}</tbody></table></div><p class="note">${t("calNote")}</p></section>`;
  return h;
}

// ---------- AÇÕES ----------
async function openBlock(L) {
  if (APP.screen && APP.screen.kind === "block") return;
  startSession(L);
  let b = APP.blocks.find(x => x.lang === L && x.status === "open");
  if (!b) {
    const date = today(), p = plan(date);
    const reqN = (p.req.find(r => r.L === L) || { n: 0 }).n;
    const bonus = blocksDone(date, L).length >= reqN;
    const wantText = p.monday && !bonus && blocksDone(date).length === 2 && !APP.blocks.some(x => x.kind === "texto" && x.date === date) && APP.sample;
    b = { id: uid("b"), lang: L, kind: "normal", created: Date.now(), date, status: "open", qids: [], attempts: [], totalMs: 0, bonus };
    if (wantText) {
      APP.screen = { kind: "wait", lang: L, title: t("blockText") + " · " + langName(L), text: t("writingText") }; render();
      try {
        const tx = await generateText(L);
        if (tx.body && tx.qs.length) {
          await storeQs(tx.qs);
          b.kind = "texto"; b.text = { title: tx.title, body: tx.body };
          const reviews = buildBlockItems(L).filter(id => APP.st[L].srs[id]).slice(0, 2);
          b.qids = [...tx.qs.map(q => q.id), ...reviews];
        }
      } catch (e) { console.warn(e); }
    }
    if (!b.qids.length) b.qids = buildBlockItems(L);
    if (!b.qids.length) { APP.screen = null; toast(t("noQuestions")); return render(); }
    APP.blocks.unshift(b); save("blocks", b.id, b);
  }
  APP.screen = { kind: "block", lang: L, blockId: b.id, idx: b.attempts.length, phase: "answer", draft: "", sel: null, replays: 0, qStart: Date.now(), segStart: Date.now(), showPt: false };
  render(); tick(); ensurePool(L);
}
function closeSegment() {
  const s = APP.screen; if (!s || !s.segStart) return;
  if (s.kind === "block") { const b = blk(); if (b) { b.totalMs = (b.totalMs || 0) + (Date.now() - s.segStart); save("blocks", b.id, b); } }
  if (s.kind === "essay") { const e = APP.essays.find(x => x.id === s.essayId); const k = e && e.stage + "Ms"; if (e && ["plan", "write", "rewrite"].includes(e.stage)) { e[k] = (e[k] || 0) + (Date.now() - s.segStart); save("essays", e.id, e); } }
  s.segStart = Date.now();
}
async function submitAnswer() {
  const s = APP.screen, b = blk(), q = qById(b.qids[s.idx]);
  const ta = document.getElementById("ans"); if (ta) s.draft = ta.value;
  if (q.ty === "cloze") s.blanks = [...document.querySelectorAll("input.blank")].map(el => el.value);
  const answer = q.ty === "mc" ? s.sel : q.ty === "cloze" ? (s.blanks || []).map(x => x.trim() || "∅").join(" · ") : (s.draft || "").trim();
  if (!answer || (q.ty === "cloze" && (s.blanks || []).every(x => !x.trim()))) { toast(t("emptyAnswer")); return; }
  s.answerMs = Date.now() - s.qStart; s.phase = "correcting"; render();
  let res = null;
  try {
    if (QTYPES[q.ty].closed) {
      res = gradeClosed(q, answer, s.blanks);
      if (res.score < 2 && APP.sample) { try { const ex = await explainClosed(q, answer); res.errors = res.errors.map(e => ({ ...e, why: ex.why, why_pt: ex.why_pt })); } catch (e) { } }
    } else res = await correctOpen(q, answer);
  } catch (e) { console.warn(e); res = null; }
  if (APP.screen !== s) return;
  if (!res) { s.phase = "selfgrade"; return render(); }
  finalizeAttempt(q, answer, res, false);
}
function finalizeAttempt(q, answer, res, selfGraded) {
  const s = APP.screen, b = blk(), L = q.l;
  const att = { id: uid("a"), lang: L, qid: q.id, qlv: q.lv, topic: q.t, qcat: q.c, type: q.ty, src: q.src, ts: Date.now(), date: today(), blockId: b.id,
    answer, blanks: q.ty === "cloze" ? (s.blanks || []) : undefined, sub: q.s || null, exam: examOf(L, q.id), score: res.score, targetOk: res.targetOk, errors: res.errors || [], ptInterf: (res.errors || []).some(e => e.pt), orthoErr: (res.errors || []).some(e => e.ortho),
    corrected: res.corrected || "", feedback: res.feedback || "", feedback_pt: res.feedback_pt || "", answerMs: s.answerMs || 0, replays: s.replays || 0, doubts: [], selfGraded,
    srsBefore: APP.st[L].srs[q.id] ? { ...APP.st[L].srs[q.id] } : null };
  const c = classify(att, q); att.dif = c.dif; att.difWhy = c.why;
  applySrs(L, q.id, c.dif, att.srsBefore); saveState(L);
  APP.attempts.unshift(att); save("attempts", att.id, att);
  b.attempts.push(att.id); save("blocks", b.id, b);
  s.phase = "result"; s.attId = att.id; render();
  masteryAfter(att);
}
// Depois de cada resposta: estado do tema da questão e dos temas dos erros "fora do tema"
function masteryAfter(att) {
  const evs = [];
  const own = updateTopic(att.lang, att.topic); if (own) evs.push([att.topic, own]);
  if (att.exam && att.exam !== att.topic) { const ex = updateTopic(att.lang, att.exam); if (ex) evs.push([att.exam, ex]); }
  evs.push(...flagExternal(att.lang, att.errors, att.topic));
  for (const [id, ev] of evs) if (ev !== "exam") toast(t("ms_" + ev, { topic: TOPIC[id].n }));
}
function reclassify(att) {
  const q = qById(att.qid); if (!q) return;
  const c = classify(att, q);
  att.dif = c.dif; att.difWhy = c.why;
  applySrs(att.lang, q.id, c.dif, att.srsBefore); saveState(att.lang); save("attempts", att.id, att);
  masteryAfter(att);
}
function nextQuestion() {
  const s = APP.screen, b = blk();
  s.idx++; s.phase = "answer"; s.draft = ""; s.sel = null; s.blanks = []; s.replays = 0; s.qStart = Date.now(); s.doubtDraft = ""; s.busy = false;
  if (s.idx >= b.qids.length) return finishBlock();
  render(); window.scrollTo(0, 0);
}
function finishBlock() {
  const s = APP.screen, b = blk();
  b.totalMs = (b.totalMs || 0) + (Date.now() - s.segStart); s.segStart = null;
  b.status = "done"; b.doneDate = today(); b.doneTs = Date.now(); save("blocks", b.id, b);
  syncDayFlags(today());
  APP.screen = { kind: "blockdone", lang: b.lang, blockId: b.id }; render();
}

async function openEssay(L) {
  const date = today();
  let e = APP.essays.find(x => x.date === date && x.lang === L && x.status !== "dropped");
  if (!e) {
    const lv = APP.st[L].level;
    const used = {}; APP.essays.forEach(x => { if (x.task && x.task.id) used[x.task.id] = (used[x.task.id] || 0) + 1; });
    let task = ESSAY_TASKS[L].filter(k => k.lv === lv).sort((a, b) => (used[a.id] || 0) - (used[b.id] || 0))[0];
    if (!task || (used[task.id] || 0) > 0 && APP.sample) {
      APP.screen = { kind: "wait", lang: L, title: t("essay"), text: t("preparingTask") }; render();
      try { task = await generateTask(L); } catch (err) { console.warn(err); }
    }
    if (!task) { APP.screen = null; toast(t("noTask")); return render(); }
    e = { id: uid("e"), lang: L, date, ts: Date.now(), lv, task, plan: "", text: "", rewrite: "", stage: "task", status: "open" };
    APP.essays.unshift(e); save("essays", e.id, e);
  }
  APP.screen = { kind: "essay", lang: L, essayId: e.id, segStart: Date.now(), showPt: false };
  render(); tick();
}
async function essayGo(stage) {
  const s = APP.screen, e = APP.essays.find(x => x.id === s.essayId);
  closeSegment(); e.stage = stage; save("essays", e.id, e); s.segStart = Date.now(); render(); window.scrollTo(0, 0);
}
async function essaySubmit() {
  const s = APP.screen, e = APP.essays.find(x => x.id === s.essayId);
  const el = document.getElementById("essayIn"); if (el) e.text = el.value;
  if (wordCount(e.text) < 20) { toast(t("tooShort")); return; }
  closeSegment(); e.stage = "correcting"; e.words = wordCount(e.text); save("essays", e.id, e); render();
  try {
    const { corr, qs } = await correctEssay(e.lang, e);
    e.corr = corr; e.stage = "review"; save("essays", e.id, e);
    flagExternal(e.lang, corr.errors, null);
    if (qs.length) storeQs(qs);
  } catch (err) { console.warn(err); e.stage = "write"; toast(t("corrFail")); }
  s.segStart = Date.now(); if (APP.screen === s) render();
}
async function rewriteSubmit() {
  const s = APP.screen, e = APP.essays.find(x => x.id === s.essayId);
  const el = document.getElementById("rewriteIn"); if (el) e.rewrite = el.value;
  if (wordCount(e.rewrite) < 20) { toast(t("tooShort")); return; }
  closeSegment(); e.stage = "correcting2"; save("essays", e.id, e); render();
  try {
    e.rcorr = await correctRewrite(e.lang, e); e.stage = "done"; e.status = "done"; e.doneTs = Date.now(); save("essays", e.id, e);
    flagExternal(e.lang, e.rcorr.errors, null);
    syncDayFlags(today());
  } catch (err) { console.warn(err); e.stage = "rewrite"; toast(t("corrFail")); }
  s.segStart = null; if (APP.screen === s) render();
}

async function storeQs(qs) {
  for (const q of qs) { APP.gq.push(q); await save("questions", q.id, q); }
}
function ensurePool(L) {
  const st = APP.st[L], ub = unseenByTopic(L);
  const low = levelTopics(L, st.level).filter(tp => (ub[tp.id] ? ub[tp.id].unseen : 0) < 3).slice(0, 2);
  for (const tp of low) if (!APP.genQueue.some(j => j.topic === tp.id)) APP.genQueue.push({ L, topic: tp.id, n: 6 });
  runGen();
}
async function runGen() {
  if (APP.genRunning || !APP.sample) return;
  APP.genRunning = true;
  while (APP.genQueue.length) {
    const j = APP.genQueue.shift();
    try { const qs = await generateForTopic(j.L, j.topic, j.n); await storeQs(qs); } catch (e) { console.warn("gen", e); if (e && (e.code === "not_granted" || e.code === "rate_limited")) { APP.genQueue = []; } }
  }
  APP.genRunning = false;
}
async function submitClassLog() {
  const s = APP.screen, L = s.lang, st = APP.st[L];
  const lines = v => String(v || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
  const doc = { id: uid("c"), lang: L, date: today(), ts: Date.now(), theme: (s.theme || "").trim(), errs: lines(s.errs), words: lines(s.words), gen: s.gen !== false, result: "" };
  if (!doc.theme && !doc.errs.length && !doc.words.length) { toast(t("logEmpty")); return; }
  APP.classes.unshift(doc); save("classes", doc.id, doc);
  APP.screen = null; APP.msg = { text: t("logProcessing") }; render();
  const msgs = [];
  try {
    if (doc.gen && doc.theme && APP.sample) {
      const ids = await classifyClass(L, doc.theme);
      for (const id of ids) {
        const unseen = (unseenByTopic(L)[id] || { unseen: 0 }).unseen;
        st.boost[id] = st.session + 5;
        if (unseen >= 8) msgs.push(t("genEnough", { n: unseen, topic: TOPIC[id].n }));
        else { const qs = await generateForTopic(L, id, 12 - unseen, "Theme seen in class today: " + doc.theme); await storeQs(qs.map(q => ({ ...q, src: "aula" }))); msgs.push(t("genMade", { n: qs.length, topic: TOPIC[id].n })); }
      }
      saveState(L);
      if (!ids.length) msgs.push(t("genNoTopic"));
    }
    if (doc.errs.length && APP.sample) { const qs = await generateFromErrors(L, doc.errs.map(x => ({ erro: x })), "aula"); await storeQs(qs); msgs.push(t("genErrs", { n: qs.length })); }
    if (doc.words.length && APP.sample) { const qs = await generateVocab(L, doc.words, doc.theme); await storeQs(qs); msgs.push(t("genWords", { n: qs.length })); }
  } catch (e) { console.warn(e); msgs.push(t("genFail")); }
  doc.result = msgs.join(" "); save("classes", doc.id, doc);
  APP.msg = { text: msgs.length ? msgs.join(" ") : t("logSaved") }; if (!APP.screen) render();
}

// timer da sessão (atualiza só o relógio, sem re-render)
let tickT;
function tick() {
  clearInterval(tickT);
  tickT = setInterval(() => {
    const s = APP.screen; if (!s || !s.segStart) return;
    let ms, target;
    if (s.kind === "block") { ms = blockElapsed(); target = 10 * 60000; }
    else if (s.kind === "essay") { const e = APP.essays.find(x => x.id === s.essayId); const tg = { plan: 3, write: 15, rewrite: 6 }[e && e.stage]; if (!tg) return; ms = (e[e.stage + "Ms"] || 0) + Date.now() - s.segStart; target = tg * 60000; }
    else return;
    const c = document.getElementById("clock"), b = document.getElementById("tbar");
    if (c) { c.textContent = mmss(ms) + " / " + mmss(target); c.classList.toggle("late", ms > target); }
    if (b) { b.classList.toggle("late", ms > target); b.firstElementChild.style.width = Math.min(100, ms / target * 100) + "%"; }
  }, 1000);
}

document.addEventListener("click", async ev => {
  const el = ev.target.closest("[data-act]"); if (!el || el.disabled) return;
  const act = el.dataset.act, v = el.dataset.v, s = APP.screen;
  if (act === "voice") return;
  switch (act) {
    case "tab": APP.tab = v; render(); window.scrollTo(0, 0); break;
    case "dismiss": APP.msg = null; render(); break;
    case "cls": { const d = today(), cur = classOn(d, v); APP.days[d] = { ...dayDoc(d), ["class_" + v]: !cur }; saveDay(d); syncDayFlags(d); render(); break; }
    case "hard": { const d = today(); APP.days[d] = { ...dayDoc(d), hard: !dayDoc(d).hard }; saveDay(d); syncDayFlags(d); render(); break; }
    case "openBlock": openBlock(v); break;
    case "openEssay": openEssay(v); break;
    case "openLog": APP.screen = { kind: "classlog", lang: v, gen: true }; render(); break;
    case "closeScreen": closeSegment(); if (s) s.segStart = null; APP.screen = null; clearInterval(tickT); render(); window.scrollTo(0, 0); break;
    case "sel": s.sel = v; render(); break;
    case "submit": submitAnswer(); break;
    case "next": nextQuestion(); break;
    case "pt": s.showPt = !s.showPt; render(); break;
    case "listen": { const q = qById(blk().qids[s.idx]); if (s.replays >= 3) return; if (speak(q.l, q.p, Number(v) * 0.92)) { s.replays++; render(); } break; }
    case "self": { const q = qById(blk().qids[s.idx]); const sc = Number(v); finalizeAttempt(q, q.ty === "mc" ? s.sel : s.draft, { score: sc, targetOk: sc > 0, errors: sc < 2 ? [{ cat: q.c, frag: "", fix: q.a[0], why: "", why_pt: "", pt: false, ortho: false }] : [] }, true); break; }
    case "doubt": {
      const ta = document.getElementById("doubt"); const qtext = (ta && ta.value || "").trim(); if (!qtext) return;
      const a = APP.attempts.find(x => x.id === s.attId), q = qById(a.qid);
      s.busy = true; s.doubtDraft = qtext; render();
      try { const r = await askDoubt(q, a, qtext); a.doubts = [...(a.doubts || []), { q: qtext, ...r }]; reclassify(a); s.doubtDraft = ""; } catch (e) { toast(t("askFail")); }
      s.busy = false; if (APP.screen === s) render(); break;
    }
    case "contest": {
      const ta = document.getElementById("doubt"); const reason = (ta && ta.value || "").trim();
      const a = APP.attempts.find(x => x.id === s.attId), q = qById(a.qid);
      s.busy = true; render();
      try { const r = await contest(q, a, reason); a.contested = { accepted: r.accepted, why: r.why, why_pt: r.why_pt, prevScore: a.score };
        if (r.accepted) { a.score = r.score; a.errors = r.errors; a.targetOk = r.score > 0; a.ptInterf = r.errors.some(e => e.pt); a.orthoErr = r.errors.some(e => e.ortho); }
        reclassify(a); s.doubtDraft = ""; } catch (e) { toast(t("askFail")); }
      s.busy = false; if (APP.screen === s) render(); break;
    }
    case "badAudio": {
      const b = blk(); b.qids.splice(s.idx, 1); save("blocks", b.id, b);
      APP.settings.dictOff = { ...(APP.settings.dictOff || {}), [b.lang]: true }; saveSettings();
      s.phase = "answer"; s.draft = ""; s.replays = 0; s.qStart = Date.now();
      if (s.idx >= b.qids.length) return finishBlock();
      toast(t("dictPaused")); render(); break;
    }
    case "dictToggle": { APP.settings.dictOff = { ...(APP.settings.dictOff || {}), [v]: !(APP.settings.dictOff || {})[v] }; saveSettings(); render(); break; }
    case "goNb": { const [x, c] = v.split(":"); APP.nbLang = x; APP.nbCat = c; APP.tab = "notebook"; render(); window.scrollTo(0, 0); break; }
    case "viewBlock": { const b = APP.blocks.find(x => x.id === v); if (b) { APP.screen = { kind: "blockdone", lang: b.lang, blockId: b.id }; render(); window.scrollTo(0, 0); } break; }
    case "discard": {
      const a = APP.attempts.find(x => x.id === s.attId), q = qById(a.qid);
      if (q && q.src !== "seed") { q.disc = true; save("questions", q.id, q); delete APP.st[q.l].srs[q.id]; saveState(q.l); toast(t("discarded")); }
      break;
    }
    case "essayGo": essayGo(v); break;
    case "newTask": {
      const e = APP.essays.find(x => x.id === s.essayId); s.busy = true; render();
      try { e.task = await generateTask(e.lang); save("essays", e.id, e); } catch (err) { toast(t("askFail")); }
      s.busy = false; render(); break;
    }
    case "essaySubmit": essaySubmit(); break;
    case "copyOrig": { const e = APP.essays.find(x => x.id === s.essayId); e.rewrite = e.text; save("essays", e.id, e); render(); break; }
    case "rewriteSubmit": rewriteSubmit(); break;
    case "lgGen": s.gen = s.gen === false; render(); break;
    case "logSave": submitClassLog(); break;
    case "nbLang": APP.nbLang = v; APP.nbCat = ""; render(); break;
    case "nbCat": APP.nbCat = v; APP.nbShow = 60; render(); break;
    case "nbPt": APP.nbPt = !APP.nbPt; render(); break;
    case "nbMore": APP.nbShow += 60; render(); break;
    case "progLang": APP.progLang = v; render(); break;
    case "setLang": APP.setLang = v; render(); break;
    case "lvChange": APP.confirmLv = v; render(); break;
    case "lvConfirm": { const sel = document.getElementById("lv_" + v); const lv = sel ? sel.value : APP.st[v].level; if (lv !== APP.st[v].level) { APP.st[v].level = lv; APP.st[v].levelSince = today(); saveState(v); toast(t("levelChanged", { lang: langName(v), lv })); } APP.confirmLv = null; render(); break; }
    case "bsize": { const [x, n] = v.split(":"); APP.settings.blockSize[x] = Number(n); saveSettings(); render(); break; }
    case "testVoice": speak(v, v === "fr" ? "Bonjour ! Je suis la voix de vos dictées." : "¡Hola! Soy la voz de tus dictados."); break;
    case "genHistory": {
      APP.genBusy = true; render();
      try { const qs = await generateFromHistory(v, 10); await storeQs(qs); toast(t("genDone", { n: qs.length })); } catch (e) { toast(t("askFail")); }
      APP.genBusy = false; render(); break;
    }
  }
});
document.addEventListener("change", ev => {
  const el = ev.target;
  if (el.dataset && el.dataset.act === "voice") { APP.settings.voice[el.dataset.v] = el.value; saveSettings(); }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && APP.screen && APP.screen.kind === "block") {
    if (APP.screen.phase === "answer") submitAnswer(); else if (APP.screen.phase === "result") nextQuestion();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!APP.screen) return;
  if (document.hidden) closeSegment();
  else if (APP.screen.segStart) APP.screen.segStart = Date.now(); // tempo com a aba escondida não conta
});

// ---------- boot ----------
async function boot() {
  render();
  loadVoices(); pollVoices();
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { loadVoices(); if (!APP.screen) render(); };
  if (!window.claude || !window.claude.use) { APP.status = "nodb"; return render(); }
  const [db, sample, user] = await Promise.all([window.claude.use("db"), window.claude.use("sample"), window.claude.use("user")]);
  const me = user ? await user.id() : null;
  if (!db || !me) { APP.status = "nodb"; return render(); }
  APP.db = db; APP.sample = sample;
  APP.base = db.doc("data/users/" + me + "/caderno");
  try { await loadAll(); } catch (e) { console.warn("load", e); }
  for (const L of LANG_LIST) if (!APP.st[L]) APP.st[L] = defaultState();
  // redações abertas de dias anteriores não acumulam
  for (const e of APP.essays) if (e.status === "open" && e.date !== today()) { e.status = "dropped"; save("essays", e.id, e); }
  APP.status = "ready"; render();
  for (const L of LANG_LIST) for (const tp of levelTopics(L, APP.st[L].level)) updateTopic(L, tp.id);
}
boot();
