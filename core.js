// ===== Núcleo: dados, calendário, montagem de blocos, revisão espaçada, correção local =====
const LANG_LIST = ["fr", "es"];
const TOPIC = {};
for (const L of LANG_LIST) for (const t of TOPICS[L]) TOPIC[t.id] = { ...t, l: L };

// Banco seed → objetos com id estável (tema-índice)
function buildSeeds() {
  const out = [];
  for (const [L, S] of [["fr", SEED_FR], ["es", SEED_ES]]) {
    const n = {};
    for (const [t, ty, p, a, x] of S) {
      n[t] = (n[t] || 0) + 1;
      const lv = TOPIC[t].lv === "*" ? "A2" : TOPIC[t].lv;
      const tag = x.s != null ? x.s : (SUBTAG[t] || [])[n[t] - 1];
      out.push({ id: `${t}-${n[t]}`, l: L, lv, t, ty, p, a, o: x.o || null, i: x.i || null, c: x.c, src: "seed", s: tag == null ? null : [].concat(tag) });
    }
  }
  return out;
}
const SEEDS = buildSeeds();

const APP = {
  db: null, sample: null, status: "loading",
  settings: { blockSize: { fr: 8, es: 8 }, voice: { fr: "", es: "" }, dictOff: { fr: false, es: false } },
  st: {}, days: {}, blocks: [], attempts: [], essays: [], classes: [], gq: [],
  tab: "today", screen: null, progLang: null, nbLang: null, nbCat: "", nbShow: 60,
  voices: { fr: [], es: [] }, genBusy: false, genQueue: [], msg: null
};
function defaultState() { return { level: "A2", levelSince: today(), session: 0, lastSession: null, srs: {}, boost: {}, discarded: [] }; }

// ---------- datas ----------
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const weekStart = s => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const uid = p => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- persistência ----------
const writeQ = {};
function save(col, id, data) {
  const key = col + "/" + id;
  if (!APP.db) return Promise.resolve();
  const run = () => APP.base.collection(col).doc(id).set(JSON.parse(JSON.stringify(data)));
  writeQ[key] = (writeQ[key] || Promise.resolve()).then(run).catch(e => {
    console.warn("save failed", key, e);
    if (e && e.code === "quota_exceeded") toast(t("errQuota"));
  });
  return writeQ[key];
}
const saveState = L => save("state", L, APP.st[L]);
const saveSettings = () => save("state", "settings", APP.settings);
function saveDay(date) { return save("days", date, APP.days[date] || {}); }

async function loadAll() {
  const db = APP.base;
  const [sFr, sEs, sSet] = await Promise.all(["fr", "es", "settings"].map(k => db.collection("state").doc(k).get()));
  APP.st.fr = sFr.exists ? { ...defaultState(), ...sFr.data() } : defaultState();
  APP.st.es = sEs.exists ? { ...defaultState(), ...sEs.data() } : defaultState();
  for (const L of LANG_LIST) APP.st[L] = JSON.parse(JSON.stringify(APP.st[L]));
  if (sSet.exists) APP.settings = { ...APP.settings, ...JSON.parse(JSON.stringify(sSet.data())) };
  const grab = async q => (await q.get()).docs.map(d => ({ ...JSON.parse(JSON.stringify(d.data())), id: d.id }));
  const [days, blocks, attFr, attEs, essays, classes, gq] = await Promise.all([
    grab(db.collection("days").limit(1000)),
    grab(db.collection("blocks").orderBy("created", "desc").limit(500)),
    grab(db.collection("attempts").where("lang", "==", "fr").orderBy("ts", "desc").limit(1000)),
    grab(db.collection("attempts").where("lang", "==", "es").orderBy("ts", "desc").limit(1000)),
    grab(db.collection("essays").orderBy("ts", "desc").limit(300)),
    grab(db.collection("classes").orderBy("ts", "desc").limit(300)),
    grab(db.collection("questions").limit(1000))
  ]);
  APP.days = {}; for (const d of days) APP.days[d.id] = d;
  APP.blocks = blocks; APP.attempts = [...attFr, ...attEs].sort((a, b) => b.ts - a.ts);
  APP.essays = essays; APP.classes = classes; APP.gq = gq;
}

// ---------- questões ----------
function allQuestions(L) {
  const st = APP.st[L];
  const disc = new Set(st.discarded || []);
  return [...SEEDS.filter(q => q.l === L), ...APP.gq.filter(q => q.l === L)].filter(q => !disc.has(q.id) && !q.disc && q.src !== "prova");
}
function qById(id) { return SEEDS.find(q => q.id === id) || APP.gq.find(q => q.id === id) || null; }
function attemptedIds(L) {
  const s = new Set(Object.keys(APP.st[L].srs || {}));
  for (const a of APP.attempts) if (a.lang === L) s.add(a.qid);
  return s;
}
function hasVoice(L) { return APP.voices[L].length > 0 && !(APP.settings.dictOff || {})[L]; }
const anyLevel = q => !!(TOPIC[q.t] && TOPIC[q.t].lv === "*"); // ditado, homófonos, falsos amigos: valem em todo nível
function levelTopics(L, lv) {
  return TOPICS[L].filter(t => (t.lv === lv || t.lv === "*") && !t.id.endsWith("_vocab") && (hasVoice(L) || !(t.id === "fr_dictee" || t.id === "es_dict")));
}

// ---------- calendário ----------
function template(date) {
  const wd = parseYmd(date).getDay();
  return ({ 1: { k: "mon" }, 2: { k: "cls", l: "es" }, 3: { k: "cls", l: "fr" }, 4: { k: "cls", l: "es" }, 5: { k: "cls", l: "fr" }, 6: { k: "we", l: "fr" }, 0: { k: "we", l: "es" } })[wd];
}
const dayDoc = date => APP.days[date] || {};
function classOn(date, L) {
  const d = dayDoc(date), k = "class_" + L;
  if (typeof d[k] === "boolean") return d[k];
  const tp = template(date);
  return tp.k === "cls" && tp.l === L;
}
function blocksDone(date, L) { return APP.blocks.filter(b => b.status === "done" && b.doneDate === date && (!L || b.lang === L)); }
function weekBlockCount(date, L) {
  const ws = weekStart(date);
  return APP.blocks.filter(b => b.status === "done" && b.lang === L && b.doneDate >= ws && b.doneDate < date).length;
}
function lessLang(date) { return weekBlockCount(date, "fr") <= weekBlockCount(date, "es") ? "fr" : "es"; }

function plan(date) {
  const tp = template(date), d = dayDoc(date), hard = !!d.hard;
  const cls = LANG_LIST.filter(L => classOn(date, L));
  const p = { date, tp, hard, cls, req: [], essay: null, kind: "", monday: false, langs: [] };
  if (cls.length) {
    p.kind = hard ? "min" : "class";
    cls.forEach(L => p.req.push({ L, n: hard ? 0 : 1 }));
    if (tp.k === "we") p.essay = { L: tp.l, optional: true };
  } else if (tp.k === "cls") {
    p.kind = hard ? "min" : "long";
    p.req.push({ L: tp.l, n: hard ? 1 : 4 });
  } else if (tp.k === "mon") {
    if (hard) { p.kind = "min"; p.req.push({ L: lessLang(date), n: 1 }); }
    else { p.kind = "long"; p.monday = true; p.req.push({ L: "fr", n: 2 }, { L: "es", n: 2 }); }
  } else {
    if (hard) { p.kind = "min"; p.req.push({ L: tp.l, n: 1 }); }
    else { p.kind = "long"; p.req.push({ L: tp.l, n: 1 }); p.essay = { L: tp.l, optional: false }; }
  }
  p.langs = [...new Set([...p.req.map(r => r.L), ...(p.essay ? [p.essay.L] : [])])];
  if (!p.langs.length) p.langs = cls.length ? cls : [tp.l || "fr"];
  return p;
}
function essayDoneOn(date, L) { return APP.essays.some(e => e.date === date && e.lang === L && e.status === "done"); }
function dayStatus(date) {
  const p = plan(date);
  const reqOk = p.req.every(r => blocksDone(date, r.L).length >= r.n);
  const essOk = !p.essay || p.essay.optional || p.hard || essayDoneOn(date, p.essay.L);
  return { p, complete: reqOk && essOk };
}
// Próxima língua na segunda: alterna começando pela que teve menos blocos na semana
function mondayNextLang(date) {
  const first = lessLang(date), other = first === "fr" ? "es" : "fr";
  const df = blocksDone(date, first).length, dO = blocksDone(date, other).length;
  if (df >= 2 && dO >= 2) return null;
  return df < 2 ? first : other;
}
// Língua da interface
function uiLang() {
  if (APP.screen && APP.screen.lang) return APP.screen.lang;
  const date = today(), p = plan(date);
  if (p.cls.length) return p.cls[0];
  if (p.monday) return mondayNextLang(date) || lessLang(date);
  return p.langs[0] || "fr";
}
function syncDayFlags(date) {
  const { complete, p } = dayStatus(date);
  const d = { ...(APP.days[date] || {}) };
  const minimal = complete && p.hard;
  if (!!d.complete !== complete || !!d.minimal !== minimal) {
    d.complete = complete; d.minimal = minimal; APP.days[date] = d; saveDay(date);
  }
}
function streak() {
  let s = 0, date = today();
  if (!dayDoc(date).complete) date = addDays(date, -1);
  while (dayDoc(date).complete) { s++; date = addDays(date, -1); }
  return s;
}
function last28() { let n = 0; for (let i = 0; i < 28; i++) if (dayDoc(addDays(today(), -i)).complete) n++; return n; }

// ---------- estatísticas ----------
function recentAttempts(L, days, from) {
  const end = from || today(), start = addDays(end, -days + 1);
  return APP.attempts.filter(a => a.lang === L && a.date >= start && a.date <= end && a.score != null);
}
function topicStats(L, days) {
  const m = {};
  for (const a of recentAttempts(L, days)) {
    const s = m[a.topic] || (m[a.topic] = { n: 0, pts: 0 });
    s.n++; s.pts += a.score;
  }
  return m;
}
function catErrorRate(L, cat) {
  const att = recentAttempts(L, 28).filter(a => a.qcat === cat);
  if (att.length < 5) return 0;
  return att.filter(a => (a.errors || []).some(e => e.cat === cat) || a.score === 0).length / att.length;
}
// ---------- domínio por tema ----------
// Treino → (critério atingido) → prova surpresa de 6 questões novas → dominado. Um erro depois disso reabre o tema.
const MASTER = { minN: 12, minAcc: 0.8, subDays: 2, reopenN: 4, reopenDays: 2, examN: 6, examDelay: 2 };
const attOk = a => a.score >= 1 && a.targetOk !== false;
// A questão faz parte de uma prova pendente?
function examOf(L, qid) { const e = Object.entries(APP.st[L].tm || {}).find(([, r]) => r.st === "exam" && r.exam && r.exam.qids.includes(qid)); return e ? e[0] : null; }
function attSubs(a) { const q = qById(a.qid); return (q && q.s) || a.sub || []; }
function tmRec(L, id) { const st = APP.st[L]; st.tm = st.tm || {}; return st.tm[id] || (st.tm[id] = { st: "training" }); }
// Erros que o corretor atribuiu a este tema em questões de outro tema ou em redações
function externalErrors(L, id) {
  const out = [];
  for (const a of APP.attempts) if (a.lang === L && a.topic !== id) for (const e of a.errors || []) if (e.topic === id) out.push({ ts: a.ts, date: a.date, ok: false, ext: true });
  for (const es of APP.essays) if (es.lang === L) for (const c of [es.corr, es.rcorr]) if (c) for (const e of c.errors || []) if (e.topic === id) out.push({ ts: es.doneTs || es.ts, date: es.date, ok: false, ext: true });
  return out;
}
function topicMastery(L, id) {
  const rec = tmRec(L, id), subsN = (SUBS[id] || []).length;
  const since = rec.failedTs || 0, from28 = addDays(today(), -27);
  const all = APP.attempts.filter(a => a.lang === L && a.topic === id && a.score != null && a.ts > since);
  const recent = all.filter(a => a.date >= from28);
  const acc = recent.length ? recent.reduce((x, a) => x + a.score, 0) / (2 * recent.length) : 0;
  const subDays = Array.from({ length: subsN }, () => new Set());
  for (const a of all) if (attOk(a)) for (const k of attSubs(a)) if (subDays[k]) subDays[k].add(a.date);
  const subsOk = subDays.filter(d => d.size >= MASTER.subDays).length;
  const ext = externalErrors(L, id);
  const events = [...APP.attempts.filter(a => a.lang === L && a.topic === id && a.score != null).map(a => ({ ts: a.ts, date: a.date, ok: attOk(a) })), ...ext].sort((a, b) => a.ts - b.ts);
  const last = events[events.length - 1];
  const lastOk = !last || last.ok;
  const criteria = recent.length >= MASTER.minN && acc >= MASTER.minAcc && subsOk === subsN && lastOk;
  // reabertura: acertos depois do último erro
  let reopen = null;
  if (rec.st === "reopened") {
    const lastFail = [...events].reverse().find(e => !e.ok);
    const after = events.filter(e => e.ok && (!lastFail || e.ts > lastFail.ts));
    reopen = { n: after.length, days: new Set(after.map(e => e.date)).size };
  }
  const ext28 = ext.filter(e => e.date >= from28).length;
  return { id, state: rec.st, n: recent.length, acc, subsOk, subsN, lastOk, criteria, reopen, ext28, rec };
}
// Atualiza o estado do tema; devolve um evento ("exam", "pass", "fail", "reopen", "back") quando algo muda
function updateTopic(L, id) {
  if (!TOPIC[id] || TOPIC[id].l !== L || !SUBS[id]) return null;
  const m = topicMastery(L, id), rec = m.rec, st = APP.st[L];
  let ev = null;
  if (rec.st === "exam" && rec.exam && rec.exam.qids && rec.exam.qids.length) {
    const atts = rec.exam.qids.map(q => APP.attempts.find(a => a.qid === q && a.lang === L && a.exam === id && a.ts >= rec.exam.created)).filter(Boolean);
    if (atts.length >= rec.exam.qids.length) {
      const good = atts.filter(a => a.score === 2).length;
      if (good >= rec.exam.qids.length - 1) { rec.st = "mastered"; rec.masteredTs = Date.now(); rec.exam = null; ev = "pass"; }
      else { rec.st = "training"; rec.failedTs = Date.now(); rec.exam = null; ev = "fail"; }
    }
  } else if (rec.st === "mastered") {
    if (!m.lastOk) { rec.st = "reopened"; rec.reopenTs = Date.now(); st.boost = st.boost || {}; st.boost[id] = st.session + 3; ev = "reopen"; }
  } else if (rec.st === "reopened") {
    const r = topicMastery(L, id).reopen;
    if (r && r.n >= MASTER.reopenN && r.days >= MASTER.reopenDays) { rec.st = "mastered"; rec.masteredTs = Date.now(); ev = "back"; }
  } else if (rec.st !== "exam" && m.criteria) {
    rec.st = "exam"; rec.exam = { due: (st.session || 0) + MASTER.examDelay, qids: [], created: Date.now() }; ev = "exam";
  }
  if (ev) saveState(L);
  if (rec.st === "exam" && rec.exam && !rec.exam.qids.length) ensureExam(L, id);
  return ev;
}
// Erro fora do tema: o tema certo ganha prioridade nos próximos blocos
function flagExternal(L, errors, ownTopic) {
  const st = APP.st[L], ids = [...new Set((errors || []).map(e => e.topic).filter(t => t && t !== ownTopic && TOPIC[t] && TOPIC[t].l === L))];
  if (!ids.length) return [];
  st.boost = st.boost || {};
  for (const id of ids) st.boost[id] = Math.max(st.boost[id] || 0, (st.session || 0) + 3);
  saveState(L);
  return ids.map(id => [id, updateTopic(L, id)]).filter(x => x[1]);
}
// Monta a prova: 6 questões novas geradas na hora, cobrindo todos os subpontos; sem Claude, usa questões do banco não vistas há 14 dias
const examBusy = {};
async function ensureExam(L, id) {
  const key = L + id; if (examBusy[key]) return; examBusy[key] = true;
  try {
    const rec = tmRec(L, id); if (!rec.exam || rec.exam.qids.length) return;
    let qs = [];
    if (APP.sample) { try { qs = await generateExam(L, id); } catch (e) { console.warn("exam", e); } }
    if (qs.length >= 4) { await storeQs(qs); rec.exam.qids = qs.map(q => q.id); }
    else {
      const recentIds = new Set(APP.attempts.filter(a => a.lang === L && a.date >= addDays(today(), -13)).map(a => a.qid));
      const cand = shuffle(allQuestions(L).filter(q => q.t === id && !recentIds.has(q.id) && q.ty !== "mc"));
      const pick = [], covered = new Set();
      for (const q of cand) if (pick.length < MASTER.examN && (q.s || []).some(k => !covered.has(k))) { pick.push(q); (q.s || []).forEach(k => covered.add(k)); }
      for (const q of cand) if (pick.length < MASTER.examN && !pick.includes(q)) pick.push(q);
      if (pick.length < MASTER.examN) { // tudo visto há pouco: usa as vistas há mais tempo
        const lastSeen = q => Math.max(0, ...APP.attempts.filter(a => a.qid === q.id).map(a => a.ts));
        const rest = allQuestions(L).filter(q => q.t === id && q.ty !== "mc" && !pick.includes(q)).sort((a, b) => lastSeen(a) - lastSeen(b));
        for (const q of rest) if (pick.length < MASTER.examN) pick.push(q);
      }
      rec.exam.qids = pick.map(q => q.id);
    }
    saveState(L);
  } finally { examBusy[key] = false; }
}
function levelStatus(L) {
  const st = APP.st[L], lv = st.level, inLevel = daysBetween(st.levelSince, today());
  const att = recentAttempts(L, 28).filter(a => a.qlv === lv || (TOPIC[a.topic] && TOPIC[a.topic].lv === "*"));
  const acc = att.length ? att.reduce((s, a) => s + a.score, 0) / (2 * att.length) : 0;
  const topics = levelTopics(L, lv).map(tp => {
    if (!SUBS[tp.id]) {
      const ta = att.filter(a => a.topic === tp.id), tacc = ta.length ? ta.reduce((s, a) => s + a.score, 0) / (2 * ta.length) : 0;
      return { id: tp.id, state: ta.length >= MASTER.minN && tacc >= MASTER.minAcc ? "mastered" : "training", n: ta.length, acc: tacc, subsOk: 0, subsN: 0, ok: ta.length >= MASTER.minN && tacc >= MASTER.minAcc, ext28: 0 };
    }
    const m = topicMastery(L, tp.id);
    return { ...m, ok: m.state === "mastered" };
  });
  const next = LEVELS[LEVELS.indexOf(lv) + 1] || null;
  const ready = !!next && inLevel >= 28 && acc >= 0.85 && topics.every(x => x.ok);
  return { lv, next, inLevel, acc, n: att.length, topics, ready };
}

// ---------- montagem do bloco ----------
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function buildBlockItems(L) {
  const st = APP.st[L], size = APP.settings.blockSize[L] || 8;
  const pool = allQuestions(L).filter(q => q.ty !== "dit" || hasVoice(L));
  const byId = Object.fromEntries(pool.map(q => [q.id, q]));
  const chosen = [], topicCount = {};
  const add = q => { chosen.push(q.id); topicCount[q.t] = (topicCount[q.t] || 0) + 1; };
  // 0) prova de tema marcada (no máximo uma por bloco, sem aviso)
  const examDone = (tid, r) => new Set(APP.attempts.filter(a => a.lang === L && a.exam === tid && a.ts >= r.exam.created).map(a => a.qid));
  const examTopic = Object.entries(st.tm || {}).find(([tid, r]) => r.st === "exam" && r.exam && r.exam.qids.length && r.exam.due <= st.session && r.exam.qids.some(q => !examDone(tid, r).has(q)));
  if (examTopic) { const done = examDone(examTopic[0], examTopic[1]); for (const id of examTopic[1].exam.qids) if (!done.has(id) && qById(id) && chosen.length < size) { chosen.push(id); topicCount[examTopic[0]] = 2; } }
  // 1) revisões vencidas (até 3)
  const due = Object.entries(st.srs || {})
    .filter(([id, e]) => !e.retired && e.due <= st.session && byId[id] && byId[id].src !== "texto")
    .sort((a, b) => a[1].due - b[1].due);
  for (const [id] of due) { if (chosen.length >= 3) break; if ((topicCount[byId[id].t] || 0) < 2) add(byId[id]); }
  // 2) novas
  const seen = attemptedIds(L);
  const fresh = pool.filter(q => !seen.has(q.id) && !chosen.includes(q.id));
  const lvOk = q => q.lv === st.level || anyLevel(q) || q.src === "aula" || q.src === "erro" || q.src === "texto";
  const priority = shuffle(fresh.filter(q => (q.src === "erro" || q.src === "aula") && lvOk(q)));
  const boosted = new Set(Object.entries(st.boost || {}).filter(([, until]) => until >= st.session).map(([k]) => k));
  const tstat = topicStats(L, 28);
  const weight = tp => {
    const s = tstat[tp] || { n: 0, pts: 0 };
    const err = s.n ? 1 - s.pts / (2 * s.n) : 0.5;
    const rs = ((st.tm || {})[tp] || {}).st;
    return 1 + 3 * err + 2 / (1 + s.n) + (boosted.has(tp) || rs === "reopened" ? 3 : 0) - (rs === "mastered" ? 1 : 0);
  };
  const closedShare = () => chosen.filter(id => QTYPES[(byId[id] || qById(id)).ty].closed).length / Math.max(1, chosen.length);
  const pickFrom = cands => {
    const ok = cands.filter(q => (topicCount[q.t] || 0) < 2 && !chosen.includes(q.id));
    if (!ok.length) return null;
    const wantClosed = closedShare() < 0.25;
    const pref = ok.filter(q => QTYPES[q.ty].closed === wantClosed);
    const list = pref.length ? pref : ok;
    const w = q => weight(q.t) * (q.ty === "mc" ? 0.3 : 1); // múltipla escolha quase não ensina mais nada
    const tot = list.reduce((s, q) => s + w(q), 0);
    let r = Math.random() * tot;
    for (const q of list) { r -= w(q); if (r <= 0) return q; }
    return list[list.length - 1];
  };
  for (const q of priority) { if (chosen.length >= size) break; if ((topicCount[q.t] || 0) < 2) add(q); }
  const levelFresh = fresh.filter(lvOk).filter(q => q.src !== "texto");
  while (chosen.length < size) { const q = pickFrom(levelFresh); if (!q) break; add(q); }
  // 3) sem novas suficientes: repete as mais antigas do nível
  if (chosen.length < size) {
    const old = pool.filter(q => (q.lv === st.level || anyLevel(q)) && !chosen.includes(q.id))
      .sort((a, b) => ((st.srs[a.id] || {}).last || 0) - ((st.srs[b.id] || {}).last || 0));
    while (chosen.length < size) { const q = pickFrom(old) || old.find(x => !chosen.includes(x.id)); if (!q) break; add(q); }
  }
  return shuffle(chosen);
}
function unseenByTopic(L) {
  const seen = attemptedIds(L), out = {};
  for (const q of allQuestions(L)) {
    const o = out[q.t] || (out[q.t] = { total: 0, done: 0, unseen: 0 });
    o.total++; if (seen.has(q.id)) o.done++; else o.unseen++;
  }
  return out;
}
function startSession(L) {
  const st = APP.st[L], d = today();
  if (st.lastSession !== d) { st.session = (st.session || 0) + 1; st.lastSession = d; saveState(L); }
}

// ---------- correção local (fechadas) ----------
const normTxt = s => String(s || "").replace(/[¿¡]/g, "").trim().replace(/[’`´]/g, "'").replace(/\s+/g, " ").replace(/\s*([?!:;])/g, " $1").toLowerCase();
const stripAcc = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
// Texto com lacunas: cada lacuna aceita alternativas separadas por "|"
function gradeCloze(q, blanks) {
  let wrong = 0, accentOnly = 0; const errors = [];
  q.a.forEach((alts, i) => {
    const opts = String(alts).split("|"), v = (blanks[i] || "").trim(), n = normTxt(v);
    if (opts.some(o => normTxt(o) === n)) return;
    if (n && opts.some(o => stripAcc(normTxt(o)) === stripAcc(n))) { accentOnly++; errors.push({ cat: q.l === "fr" ? "ortho" : "acen", frag: v, fix: opts[0], why: "", why_pt: "", pt: false, ortho: true, blank: i }); return; }
    wrong++; errors.push({ cat: q.c, frag: v || "∅", fix: opts[0], why: "", why_pt: "", pt: !!TOPIC[q.t].pt, ortho: false, blank: i });
  });
  const score = wrong === 0 ? (accentOnly ? 1 : 2) : (wrong === 1 && q.a.length >= 3 ? 1 : 0);
  return { score, targetOk: score > 0, errors };
}
function gradeClosed(q, answer, blanks) {
  if (q.ty === "cloze") return gradeCloze(q, blanks || []);
  const a = normTxt(answer);
  if (q.a.some(x => normTxt(x) === a)) return { score: 2, targetOk: true, errors: [] };
  if (q.ty !== "mc" && a && q.a.some(x => stripAcc(normTxt(x)) === stripAcc(a))) {
    return { score: 1, targetOk: true, errors: [{ cat: q.l === "fr" ? "ortho" : "acen", frag: answer.trim(), fix: q.a[0], why: "", why_pt: "", pt: false, ortho: true }] };
  }
  return { score: 0, targetOk: false, errors: [{ cat: q.c, frag: answer.trim(), fix: q.a[0], why: "", why_pt: "", pt: !!TOPIC[q.t].pt, ortho: false }] };
}

// ---------- dificuldade e revisão espaçada ----------
function classify(att, q) {
  const exp = QTYPES[q.ty].exp * 1000;
  const slow = att.answerMs > exp * 1.5;
  const doubt = (att.doubts || []).length > 0;
  const replays = (att.replays || 0) >= 3;
  const weak = catErrorRate(att.lang, q.c) >= 0.4;
  if (att.score === 0) return { dif: "hard", why: "r0" };
  if (att.score === 1) return weak ? { dif: "hard", why: "r1weak" } : { dif: "mid", why: "r1" };
  if (doubt) return { dif: "mid", why: "rdoubt" };
  if (replays) return { dif: "mid", why: "rreplay" };
  if (slow) return { dif: "mid", why: "rslow" };
  if (weak) return { dif: "mid", why: "rweak" };
  return { dif: "easy", why: "reasy" };
}
function applySrs(L, qid, dif, prevEntry) {
  const st = APP.st[L];
  const e = { ...(prevEntry || st.srs[qid] || { iv: 0 }) };
  if (dif === "hard") e.iv = 1;
  else if (dif === "mid") e.iv = 4;
  else {
    if (e.iv >= 30) e.retired = true;
    e.iv = e.iv >= 14 ? 30 : e.iv >= 7 ? 14 : 7;
  }
  if (dif !== "easy") e.retired = false;
  e.due = st.session + e.iv; e.last = Date.now(); e.dif = dif;
  st.srs[qid] = e;
}
function wordCount(s) { return (String(s || "").trim().match(/[\p{L}\p{N}'’-]+/gu) || []).length; }
