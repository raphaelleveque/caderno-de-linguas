// ===== Chamadas ao Claude (correção, dúvidas, contestação, geração) =====
const LNAME = { fr: "French (France, Paris norm)", es: "Spanish (Spain, Madrid norm)" };
const LOUT = { fr: "French", es: "Spanish" };
const TYPE_DESC = {
  lac: "fill in the blank (short exact answer)", mc: "multiple choice (answer must be one of the options)",
  trad: "translate the Portuguese sentence", transf: "transform the sentence following the instruction",
  erro: "find and correct the error in the sentence", dit: "dictation (learner hears the sentence and writes it)",
  mini: "mini-production: 1–3 sentences answering a given situation",
  cloze: "short text with several blanks (___), each filled with one form",
  corr: "the sentence may contain zero, one or several errors, or be fully correct; the learner must rewrite it entirely corrected, or copy it unchanged if it is correct (changing a correct form is an error)"
};
const LEARNER = (L, lv) => `The learner is a Brazilian Portuguese speaker studying ${LNAME[L]}; current CEFR level ${lv}. ${L === "fr" ? "He grew up speaking French orally, so he writes by ear: watch for phonetic spelling, silent agreements, homophones and accents." : "Portuguese makes him understand almost everything, so his production slides into 'portuñol': watch for Portuguese interference in vocabulary, structure and spelling. His keyboard has no ¿ or ¡: NEVER count a missing opening ¿ or ¡ as an error, and do not list it."}`;

function catList(L) { return Object.keys(CATS[L]).map(k => `${k} (${CATS[L][k]})`).join(", "); }
function topicList(L, lv) {
  return TOPICS[L].filter(t => !lv || t.lv === lv || t.lv === "*").map(t => `${t.id} [${t.lv}] ${t.n}`).join("\n");
}
async function ask(prompt, opts) {
  if (!APP.sample) throw { code: "not_granted" };
  return APP.sample.json(prompt, { modelTier: "default", effort: "low", ...(opts || {}) });
}
function cleanErrors(L, errs) {
  const cats = CATS[L];
  return (Array.isArray(errs) ? errs : []).map(e => ({
    cat: cats[pick(e, ["category", "categoria"])] ? pick(e, ["category", "categoria"]) : null,
    frag: String(pick(e, ["text", "trecho", "fragment"]) || ""),
    fix: String(pick(e, ["fix", "correcao", "correção", "correction", "corrected", "correcta"]) || ""),
    why: String(pick(e, ["why", "porque", "explanation"]) || ""), why_pt: String(pick(e, ["why_pt", "porque_pt"]) || ""),
    pt: !!pick(e, ["pt_interference", "interferencia_pt"]), ortho: !!pick(e, ["spelling", "ortografia"])
  })).filter(e => (e.frag || e.fix) && normTxt(e.frag) !== normTxt(e.fix));
}
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };
const ERR_SCHEMA = `{"category":"<one id>","text":"<exact substring of the learner text that is wrong>","fix":"<the corrected form of exactly that substring; never empty>","why":"<explanation in ${"{LOUT}"}>","why_pt":"<same in Portuguese>","pt_interference":true|false,"spelling":true|false}`;

// Correção de uma questão aberta (ou ditado)
async function correctOpen(q, answer) {
  const L = q.l, lv = APP.st[L].level, tp = TOPIC[q.t];
  const errSchema = ERR_SCHEMA.replace("{LOUT}", LOUT[L]);
  const base = `You are a strict ${LNAME[L]} writing examiner. No praise, no softening. List EVERY error, including accents and punctuation that change correctness. Do NOT count a missing final period, capitalisation of the first word, or a missing opening ¿ / ¡.
${LEARNER(L, lv)}

Exercise type: ${TYPE_DESC[q.ty]}
${q.i ? "Instruction: " + q.i + "\n" : ""}Prompt: ${q.p}
${q.ty === "dit" ? `Dictated sentence (the learner must write exactly this sentence; any different word or spelling is an error): ${q.a[0]}` : `Reference answer(s) (any other correct, natural ${LOUT[L]} formulation is also fully correct): ${q.a.join(" | ")}`}
Target structure: ${tp.n}${SUBS[q.t] ? " (" + SUBS[q.t].join("; ") + ")" : ""}
Learner answer: """${answer}"""

Scoring:
- nota 2: fully correct (any valid formulation; ${L === "es" ? "use Peninsular Spanish norms" : "use metropolitan French norms"}).
- nota 1: the target structure is correct but there is at least one other error (a wrong or missing accent counts).
- nota 0: the target structure is wrong, missing, or the answer does not do the task.
For each error: category must be one of these ids: ${catList(L)}.
"why" must be in ${LOUT[L]}, in short simple sentences a ${lv} learner understands; "why_pt" is the same explanation in Brazilian Portuguese.
versao_corrigida: the learner's answer minimally corrected (keep his wording when it is valid).
feedback: one sentence in ${LOUT[L]} at ${lv} level; feedback_pt: same in Portuguese.
Reply with only JSON: {"nota":0|1|2,"tema_ok":true|false,"erros":[${errSchema}],"versao_corrigida":"","feedback":"","feedback_pt":""}`;
  let r = await ask(base);
  let errors = cleanErrors(L, r.erros);
  if (errors.some(e => !e.cat || !e.fix)) {
    r = await ask(base + `\n\nIMPORTANT: your previous reply used a category that is not in the list, or an empty fix. Use only: ${Object.keys(CATS[L]).join(", ")}.`, { cache: false });
    errors = cleanErrors(L, r.erros);
  }
  const fallbackCat = q.c;
  errors = errors.map(e => ({ ...e, cat: e.cat || fallbackCat }));
  let score = [0, 1, 2].includes(Number(r.nota)) ? Number(r.nota) : (errors.length ? 0 : 2);
  if (score === 2 && errors.length) score = 1;
  return { score, targetOk: r.tema_ok !== false && score > 0, errors, corrected: String(r.versao_corrigida || ""), feedback: String(r.feedback || ""), feedback_pt: String(r.feedback_pt || "") };
}

// Explicação curta para uma fechada errada
async function explainClosed(q, answer) {
  const L = q.l, lv = APP.st[L].level;
  const r = await ask(`${LEARNER(L, lv)}
Exercise (${TYPE_DESC[q.ty]}): ${q.p}${q.o ? "\nOptions: " + q.o.join(" | ") : ""}
Correct answer: ${q.a.join(" | ")}. Learner answered: "${answer}".
Explain in 1–2 short sentences why the correct answer is right (target: ${TOPIC[q.t].n}). Write "porque" in ${LOUT[L]} at ${lv} level and "porque_pt" in Brazilian Portuguese.
Reply with only JSON: {"porque":"","porque_pt":""}`, { modelTier: "quick" });
  return { why: String(r.porque || ""), why_pt: String(r.porque_pt || "") };
}

async function askDoubt(q, att, question) {
  const L = q.l, lv = APP.st[L].level;
  const r = await ask(`${LEARNER(L, lv)}
Exercise (${TYPE_DESC[q.ty]}): ${q.i ? q.i + " — " : ""}${q.p}
Reference: ${q.a.join(" | ")}
Learner answer: "${att.answer}"
Correction given: score ${att.score}/2; errors: ${JSON.stringify((att.errors || []).map(e => ({ trecho: e.frag, correcao: e.fix, categoria: e.cat })))}
The learner asks: """${question}"""
Answer clearly and concretely (max 90 words), with an example if useful. "resposta" in ${LOUT[L]} at ${lv} level; "resposta_pt" the same in Brazilian Portuguese.
Reply with only JSON: {"resposta":"","resposta_pt":""}`, { cache: false });
  return { a: String(r.resposta || ""), a_pt: String(r.resposta_pt || "") };
}

async function contest(q, att, reason) {
  const L = q.l, lv = APP.st[L].level;
  const r = await ask(`You are re-checking a correction you made as a ${LNAME[L]} examiner. Be fair: accept the contest only if the learner's answer is genuinely correct or the flagged error is not an error.
${LEARNER(L, lv)}
Exercise (${TYPE_DESC[q.ty]}): ${q.i ? q.i + " — " : ""}${q.p}
Reference: ${q.a.join(" | ")}
Learner answer: "${att.answer}"
Previous correction: score ${att.score}/2, errors ${JSON.stringify((att.errors || []).map(e => ({ categoria: e.cat, trecho: e.frag, correcao: e.fix })))}
Learner's argument: """${reason || "(none given)"}"""
Return the final score and the errors that remain (same format, category from: ${Object.keys(CATS[L]).join(", ")}).
"justificativa" in ${LOUT[L]} at ${lv} level, "justificativa_pt" in Portuguese.
Reply with only JSON: {"aceito":true|false,"nota":0|1|2,"erros":[${ERR_SCHEMA.replace("{LOUT}", LOUT[L])}],"justificativa":"","justificativa_pt":""}`, { cache: false });
  const errors = cleanErrors(L, r.erros).map(e => ({ ...e, cat: e.cat || q.c }));
  return { accepted: !!r.aceito, score: [0, 1, 2].includes(Number(r.nota)) ? Number(r.nota) : att.score, errors, why: String(r.justificativa || ""), why_pt: String(r.justificativa_pt || "") };
}

// ---------- geração de questões ----------
const GEN_ITEM = L => `{"tema":"<topic id>","tipo":"cloze|corr|lac|mc|trad|transf|erro|${L ? "dit|" : ""}mini","enunciado":"","instrucao":"","opcoes":[],"respostas":[""],"categoria":"<category id>"}`;
function validateGen(L, raw, fallbackTopic, src, lvOverride) {
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questoes) ? raw.questoes : []);
  const out = [];
  for (const it of items) {
    const ty = String(it.tipo || "");
    const t = TOPIC[it.tema] && TOPIC[it.tema].l === L ? it.tema : fallbackTopic;
    if (!t || !QTYPES[ty]) continue;
    if (ty === "dit" && !hasVoice(L)) continue;
    const p = String(it.enunciado || "").trim();
    const a = (Array.isArray(it.respostas) ? it.respostas : [it.respostas]).map(x => String(x || "").trim()).filter(Boolean);
    if (!p || !a.length) continue;
    let o = null;
    if (ty === "mc") { o = (it.opcoes || []).map(x => String(x).trim()).filter(Boolean); if (o.length < 2 || !o.includes(a[0])) continue; }
    if (ty === "lac" && !p.includes("___")) continue;
    if (ty === "cloze" && (p.split("___").length - 1 !== a.length || a.length < 2)) continue;
    if (ty === "transf" && !String(it.instrucao || "").trim()) continue;
    const c = CATS[L][it.categoria] ? it.categoria : (Object.keys(CATS[L]).includes("conj") ? "conj" : Object.keys(CATS[L])[0]);
    const tlv = TOPIC[t].lv === "*" ? (lvOverride || APP.st[L].level) : TOPIC[t].lv;
    out.push({ id: uid("q"), l: L, lv: tlv, t, ty, p, a, o, i: String(it.instrucao || "").trim() || null, c, src, created: Date.now() });
  }
  return out;
}
function examplesFor(L, topicId, k) {
  return allQuestions(L).filter(q => q.t === topicId).slice(0, k || 4)
    .map(q => JSON.stringify({ tipo: q.ty, enunciado: q.p, instrucao: q.i || "", opcoes: q.o || [], respostas: q.a, categoria: q.c }));
}
async function generateForTopic(L, topicId, n, note) {
  const tp = TOPIC[topicId], lv = tp.lv === "*" ? APP.st[L].level : tp.lv;
  const existing = allQuestions(L).filter(q => q.t === topicId).map(q => q.p).slice(-40);
  const recentErr = APP.attempts.filter(a => a.lang === L && a.topic === topicId && a.score < 2).slice(0, 6).map(a => a.answer);
  const raw = await ask(`Write ${n} new ${LNAME[L]} exercises for one topic, CEFR ${lv}.
${LEARNER(L, APP.st[L].level)}
Topic: ${topicId} — ${tp.n}${SUBS[topicId] ? "\nSub-points the learner must master (cover them across the batch, giving priority to the ones least represented in the existing prompts below; each item should test one sub-point in depth, not just its surface): " + SUBS[topicId].join("; ") : ""}${note ? "\nContext: " + note : ""}
The learner already gets multiple choice right almost every time: make items that force PRODUCTION and make him think and fail. Mix: about 1/4 closed (cloze = a 2–4 sentence text with 3–4 blanks ___, base form in parentheses after each blank when needed, "respostas" = one entry per blank in order, alternatives inside an entry separated by |; lac = one blank ___; mc at most 1 per batch and only for a true minimal pair) and 3/4 open (corr = a natural sentence with 0 to 3 realistic Portuguese-speaker errors, about 1 in 5 fully correct, "respostas" = the correct sentence; trad = 1–2 linked Brazilian Portuguese sentences that combine the topic with a classic Portuguese trap; transf = a sentence plus an instruction that forces two changes at once (e.g. person AND tense); mini = a concrete situation in ${LOUT[L]} asking for 1–3 sentences with required words or structures — never ask the learner to recall his own life${hasVoice(L) ? "; dit = a natural sentence to dictate, built to trap silent spelling" : ""}).
Prefer traps a Portuguese speaker falls into. NEVER add Portuguese words, glosses or translations in parentheses (that gives the answer away): the context of the sentence must be enough. The only allowed hint is the base form of a verb or word in the target language, e.g. (hacer, tú). Vary vocabulary; everyday adult contexts (work, travel, city, tech, history).
Instructions and situations in ${LOUT[L]} (simple, ${lv}). "respostas" lists 1–3 correct answers. "categoria" is the error category the item targets, one of: ${Object.keys(CATS[L]).join(", ")}.
Do not repeat these existing prompts: ${JSON.stringify(existing)}
${recentErr.length ? "Recent wrong answers by the learner on this topic (target similar traps): " + JSON.stringify(recentErr) : ""}
Examples of the expected format: ${examplesFor(L, topicId).join("\n")}
Reply with only a JSON array of items like: ${GEN_ITEM(hasVoice(L))} — "tema" is always "${topicId}".`, { cache: false });
  return validateGen(L, raw, topicId, "gen", lv);
}
async function generateFromErrors(L, errs, src) {
  if (!errs.length) return [];
  const lv = APP.st[L].level;
  const raw = await ask(`Turn each of these real learner errors into ONE new ${LNAME[L]} exercise that trains exactly that point (not the same sentence).
${LEARNER(L, lv)}
Errors (learner text → correction, category): ${JSON.stringify(errs.slice(0, 8))}
Choose the topic id from this list (any level):
${topicList(L)}
Use types corr, trad, transf, cloze or lac (avoid mc). Instructions in ${LOUT[L]} (simple). "categoria" from: ${Object.keys(CATS[L]).join(", ")}.
Reply with only a JSON array of items like: ${GEN_ITEM(false)}`, { cache: false });
  return validateGen(L, raw, null, src);
}
async function generateFromHistory(L, n) {
  const ts = topicStats(L, 56);
  const lv = APP.st[L].level;
  const weakTopics = levelTopics(L, lv).map(tp => ({ id: tp.id, s: ts[tp.id] || { n: 0, pts: 0 } }))
    .map(x => ({ ...x, acc: x.s.n ? x.s.pts / (2 * x.s.n) : 0.5 })).sort((a, b) => a.acc - b.acc).slice(0, 3);
  const catCount = {};
  for (const a of recentAttempts(L, 56)) for (const e of a.errors || []) catCount[e.cat] = (catCount[e.cat] || 0) + 1;
  const topCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} (${v})`);
  const errSamples = APP.attempts.filter(a => a.lang === L && a.score < 2).slice(0, 10).map(a => ({ resposta: a.answer, correcao: a.corrected || "", tema: a.topic }));
  const raw = await ask(`Write ${n} new ${LNAME[L]} exercises (CEFR ${lv}) aimed at this learner's biggest weaknesses.
${LEARNER(L, lv)}
Weakest topics: ${weakTopics.map(w => `${w.id} (${TOPIC[w.id].n}, ${Math.round(w.acc * 100)}%${SUBS[w.id] ? "; sub-points: " + SUBS[w.id].join(" / ") : ""})`).join("; ")}
Most frequent error categories (last 8 weeks): ${topCats.join(", ") || "none yet"}
Recent wrong answers: ${JSON.stringify(errSamples)}
He masters multiple choice: avoid mc. Favour corr (0–3 hidden errors), cloze texts, two-sentence translations and constrained mini-productions; open production about 3/4 of the time.
Topic ids allowed: ${levelTopics(L, lv).map(t => t.id).join(", ")}. "categoria" from: ${Object.keys(CATS[L]).join(", ")}.
Rules: no Portuguese hints in parentheses, the context must be enough; lac has one ___ blank; cloze has one respostas entry per ___; mc has 3 options with the answer among them; transf has an instruction; situations never ask him to recall his own life.
Reply with only a JSON array of items like: ${GEN_ITEM(false)}`, { cache: false });
  return validateGen(L, raw, weakTopics[0] && weakTopics[0].id, "gen", lv);
}

// Texto de segunda + questões sobre ele
async function generateText(L) {
  const lv = APP.st[L].level, wc = lv === "A2" ? "120–150" : "150–200";
  const theme = Math.random() < 0.5 ? "a moment of history (European, Latin American or world history)" : "technology or artificial intelligence";
  const r = await ask(`Write a short original ${LNAME[L]} text (${wc} words) at CEFR ${lv} about ${theme}. Clear, concrete, interesting for an adult software engineer.
Then write 4 production exercises about the text (types trad, transf or mini; e.g. summarise in 2 sentences, rewrite a sentence in another tense, answer a question about the text in a full sentence). Each targets one topic of level ${lv} from this list:
${levelTopics(L, lv).map(t => t.id + " " + t.n).join("\n")}
Instructions in ${LOUT[L]}. "categoria" from: ${Object.keys(CATS[L]).join(", ")}.
Reply with only JSON: {"titulo":"","texto":"","questoes":[${GEN_ITEM(false)}]}`, { cache: false });
  const qs = validateGen(L, r.questoes || [], levelTopics(L, lv)[0].id, "texto", lv);
  return { title: String(r.titulo || ""), body: String(r.texto || ""), qs };
}

// Registro de aula: classifica o tema na lista
async function classifyClass(L, theme) {
  const r = await ask(`A learner of ${LNAME[L]} describes today's class: """${theme}"""
Map it to the matching topic ids from this list (any level). Return 1–3 ids, or [] if it is only vocabulary.
${topicList(L)}
Reply with only JSON: {"temas":["<id>"]}`, { modelTier: "quick" });
  return (r.temas || []).filter(id => TOPIC[id] && TOPIC[id].l === L);
}
async function generateVocab(L, words, theme) {
  const lv = APP.st[L].level, topicId = L + "_vocab";
  const raw = await ask(`The learner met these ${LNAME[L]} words in class${theme ? " (" + theme + ")" : ""}: ${JSON.stringify(words)}.
${LEARNER(L, lv)}
Write one production exercise per word (max 10) that forces him to USE the word: trad (Portuguese sentence that requires it), lac in context, or mini. Instructions in ${LOUT[L]}.
"tema" is "${topicId}", "categoria" is "voc".
Reply with only a JSON array of items like: ${GEN_ITEM(false)}`, { cache: false });
  return validateGen(L, raw, topicId, "aula", lv);
}

// ---------- redação ----------
async function generateTask(L) {
  const lv = APP.st[L].level, cfg = ESSAY_LEVELS[lv];
  const used = APP.essays.filter(e => e.lang === L).slice(0, 10).map(e => e.task && e.task.sit);
  const r = await ask(`Create one ${LNAME[L]} writing task at CEFR ${lv}. Format: one of ${cfg.formats[L].join(", ")}. Length ${cfg.words[0]}–${cfg.words[1]} words.
The content must be GIVEN by the task (a situation, a short text or a claim with arguments). Never ask the learner to recall his own life; he may invent.
Scaffold level "${cfg.scaffold}": full = 3 required points + 4–5 sentence starters + 4 connectors + 8 useful words; points = 3 required points + connectors; task = situation only; open = an open argumentative prompt.
Everything in ${LOUT[L]}. Avoid these recent situations: ${JSON.stringify(used)}
Reply with only JSON: {"fmt":"","sit":"","pts":[],"sk":[],"con":[],"voc":[]}`, { cache: false });
  return { id: uid("task"), lv, fmt: String(r.fmt || cfg.formats[L][0]), sit: String(r.sit || ""), pts: r.pts || [], sk: r.sk || [], con: r.con || [], voc: r.voc || [], gen: true };
}
const W_KEYS = ["tarefa", "organizacao", "desenvolvimento", "coesao", "clareza", "adequacao"];
const L_KEYS = ["gramatica", "vocabulario", "ortografia"];
async function correctEssay(L, essay) {
  const lv = APP.st[L].level, task = essay.task;
  const errSchema = ERR_SCHEMA.replace("{LOUT}", LOUT[L]);
  const base = `You are a strict ${LNAME[L]} writing examiner and a writing coach. No praise for its own sake.
${LEARNER(L, lv)}
Task (${task.fmt}): ${task.sit}
Required points: ${JSON.stringify(task.pts || [])}
Expected length: ${ESSAY_LEVELS[lv].words.join("–")} words.
Learner text:
"""${essay.text}"""

1) General writing skill (independent of language, scores 0–5): tarefa (covered every required point), organizacao (opening, development, closing; paragraphs with a clear role), desenvolvimento (ideas explained and supported, not just listed), coesao (sentences and paragraphs connected), clareza (understandable at first reading), adequacao (register and tone right for the format and reader).
2) Language (0–5): gramatica, vocabulario, ortografia; nivel = CEFR level of the language shown (A1–C2).
3) List EVERY language error with "trecho" an exact substring of the learner text (in order of appearance). category ids: ${catList(L)}.
4) comentario: 2–3 sentences on the STRUCTURE of the text (what to reorganise, connect or develop) in ${LOUT[L]} at ${lv} level; comentario_pt: the same in Brazilian Portuguese.
5) questoes: for up to 6 of the most important errors, one new exercise that trains that point (not the same sentence). Topic id from:
${topicList(L)}
Reply with only JSON: {"nivel":"A2","escrita":{"tarefa":0,"organizacao":0,"desenvolvimento":0,"coesao":0,"clareza":0,"adequacao":0},"lingua":{"gramatica":0,"vocabulario":0,"ortografia":0},"erros":[${errSchema}],"comentario":"","comentario_pt":"","questoes":[${GEN_ITEM(false)}]}`;
  let r = await ask(base, { cache: false });
  let errors = cleanErrors(L, r.erros);
  if (errors.some(e => !e.cat)) errors = errors.map(e => ({ ...e, cat: e.cat || "synt" }));
  const num = (o, k) => Math.max(0, Math.min(5, Number((o || {})[k]) || 0));
  const words = wordCount(essay.text);
  const corr = {
    level: /^[ABC][12]$/.test(r.nivel) ? r.nivel : lv,
    w: Object.fromEntries(W_KEYS.map(k => [k, num(r.escrita, k)])),
    l: Object.fromEntries(L_KEYS.map(k => [k, num(r.lingua, k)])),
    errors, per100: words ? Math.round((errors.length / words) * 1000) / 10 : 0,
    comment: String(r.comentario || ""), comment_pt: String(r.comentario_pt || "")
  };
  const qs = validateGen(L, r.questoes || [], null, "erro");
  return { corr, qs };
}
async function correctRewrite(L, essay) {
  const lv = APP.st[L].level;
  const r = await ask(`You are a strict ${LNAME[L]} examiner checking a REWRITE.
${LEARNER(L, lv)}
Original errors that had to be fixed: ${JSON.stringify(essay.corr.errors.map(e => ({ trecho: e.frag, correcao: e.fix, categoria: e.cat })))}
Rewritten text:
"""${essay.rewrite}"""
List EVERY error still present in the rewrite (old or new), "trecho" an exact substring. category ids: ${catList(L)}.
comentario: one sentence in ${LOUT[L]} (${lv}); comentario_pt: same in Portuguese.
Reply with only JSON: {"erros":[${ERR_SCHEMA.replace("{LOUT}", LOUT[L])}],"comentario":"","comentario_pt":""}`, { cache: false });
  const errors = cleanErrors(L, r.erros).map(e => ({ ...e, cat: e.cat || "synt" }));
  return { errors, remaining: errors.length, comment: String(r.comentario || ""), comment_pt: String(r.comentario_pt || "") };
}
