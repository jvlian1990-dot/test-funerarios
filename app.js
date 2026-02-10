// =====================
// Config puntuación
// =====================
const SCORE_CORRECT = 0.50;
const SCORE_WRONG = -0.15;
const TOTAL_OVER = 15;
const HISTORY_KEY = "quiz_history_v1";

// =====================
// Estado
// =====================
let questionBank = [];   // todas las preguntas cargadas
let currentQuiz = [];    // preguntas seleccionadas (con opciones quizá barajadas)
let graded = false;

// =====================
// Utilidades
// =====================
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nowISO() {
  const d = new Date();
  return d.toISOString();
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(entry) {
  const hist = loadHistory();
  hist.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

function renderHistory() {
  const el = document.getElementById("history");
  const hist = loadHistory();
  if (!hist.length) {
    el.innerHTML = `<div class="muted">Aún no hay intentos guardados.</div>`;
    return;
  }
  const rows = hist.slice(0, 30).map(h => {
    const date = new Date(h.when).toLocaleString();
    return `
      <tr>
        <td>${date}</td>
        <td>${h.count}</td>
        <td class="ok">${h.correct}</td>
        <td class="bad">${h.wrong}</td>
        <td>${h.blank}</td>
        <td><strong>${h.score15.toFixed(2)}</strong></td>
      </tr>
    `;
  }).join("");

  el.innerHTML = `
    <table class="small">
      <thead>
        <tr>
          <th>Fecha</th><th>N</th><th>✓</th><th>✗</th><th>—</th><th>Nota/15</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="muted small" style="margin-top:8px;">Mostrando últimos 30 intentos.</div>
  `;
}

// =====================
// Importadores
// =====================

// A) JSON local: ./questions.json
async function loadFromJson() {
  const res = await fetch("./questions.json", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar questions.json");
  const data = await res.json();
  return normalizeQuestions(data);
}

// B) Google Sheet publicado como CSV
// Espera columnas: id,topic,question,a,b,c,d,answer
// "answer" puede ser "a"|"b"|"c"|"d" o 0..3 o 1..4
async function loadFromSheetCsv(csvUrl) {
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar el CSV de Google Sheets");
  const csv = await res.text();
  const rows = parseCsv(csv);
  const data = rowsToQuestions(rows);
  return normalizeQuestions(data);
}

// Parser CSV simple (vale para Sheets publicado)
function parseCsv(csvText) {
  // Manejo básico de comillas. Suficiente para CSV de Sheets.
  const lines = csvText.replace(/\r/g, "").split("\n").filter(Boolean);
  const out = [];
  let headers = null;

  for (const line of lines) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);

    if (!headers) {
      headers = cells.map(h => h.trim());
    } else {
      const obj = {};
      headers.forEach((h, idx) => obj[h] = (cells[idx] ?? "").trim());
      out.push(obj);
    }
  }
  return out;
}

function rowsToQuestions(rows) {
  return rows.map(r => {
    const opts = [r.a, r.b, r.c, r.d].map(x => x ?? "");
    return {
      id: r.id || "",
      topic: r.topic || "",
      question: r.question || "",
      options: opts,
      answerIndex: parseAnswerToIndex(r.answer)
    };
  });
}

function parseAnswerToIndex(ans) {
  if (ans == null) return null;
  const a = String(ans).trim().toLowerCase();
  if (["a","b","c","d"].includes(a)) return ["a","b","c","d"].indexOf(a);
  const n = Number(a);
  if (Number.isFinite(n)) {
    // Permite 0..3 o 1..4
    if (n >= 0 && n <= 3) return n;
    if (n >= 1 && n <= 4) return n - 1;
  }
  return null;
}

// Normaliza y valida
function normalizeQuestions(data) {
  if (!Array.isArray(data)) throw new Error("Formato inválido: se esperaba un array");

  const clean = data.map((q, idx) => ({
    id: q.id ?? `Q-${idx+1}`,
    topic: q.topic ?? "",
    question: String(q.question ?? "").trim(),
    options: Array.isArray(q.options) ? q.options.map(x => String(x ?? "").trim()) : [],
    answerIndex: (typeof q.answerIndex === "number") ? q.answerIndex : parseAnswerToIndex(q.answerIndex)
  }));

  const valid = clean.filter(q =>
    q.question &&
    q.options.length === 4 &&
    q.options.every(o => o.length > 0) &&
    Number.isInteger(q.answerIndex) &&
    q.answerIndex >= 0 && q.answerIndex <= 3
  );

  if (!valid.length) throw new Error("No hay preguntas válidas (revisa opciones/answerIndex).");
  return valid;
}

// =====================
// Generación de test
// =====================
function buildRandomQuiz(n, shuffleOpts) {
  const bankShuffled = shuffleArray(questionBank);
  const picked = bankShuffled.slice(0, Math.min(n, bankShuffled.length));

  // Barajar opciones manteniendo correcta
  return picked.map(q => {
    if (!shuffleOpts) return { ...q, shuffledMap: [0,1,2,3] };

    const indices = [0,1,2,3];
    const shuffled = shuffleArray(indices);

    const newOptions = shuffled.map(i => q.options[i]);
    const newAnswerIndex = shuffled.indexOf(q.answerIndex);

    return {
      ...q,
      options: newOptions,
      answerIndex: newAnswerIndex,
      shuffledMap: shuffled
    };
  });
}

// =====================
// Render del quiz
// =====================
function renderQuiz() {
  const quizEl = document.getElementById("quiz");
  quizEl.innerHTML = "";

  currentQuiz.forEach((q, i) => {
    const box = document.createElement("div");
    box.className = "q";

    const top = document.createElement("div");
    top.className = "row";
    top.style.justifyContent = "space-between";

    const h = document.createElement("h3");
    h.textContent = `${i+1}. ${q.question}`;
    h.style.margin = "0";

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = q.topic || "Sin tema";

    top.appendChild(h);
    top.appendChild(tag);
    box.appendChild(top);

    q.options.forEach((opt, idx) => {
      const row = document.createElement("div");
      row.className = "opt";
      const letter = String.fromCharCode(97 + idx); // a b c d
      row.innerHTML = `
        <label>
          <input type="radio" name="q${i}" value="${idx}">
          <strong>${letter})</strong> ${opt}
        </label>
      `;
      box.appendChild(row);
    });

    quizEl.appendChild(box);
  });
}

function getSelected(i) {
  const chosen = document.querySelector(`input[name="q${i}"]:checked`);
  return chosen ? Number(chosen.value) : null;
}

// =====================
// Corrección
// =====================
function gradeQuiz() {
  graded = true;

  let correct = 0, wrong = 0, blank = 0;

  currentQuiz.forEach((q, i) => {
    const sel = getSelected(i);
    if (sel === null) blank++;
    else if (sel === q.answerIndex) correct++;
    else wrong++;
  });

  const raw = (correct * SCORE_CORRECT) + (wrong * SCORE_WRONG);
  const maxRaw = currentQuiz.length * SCORE_CORRECT;
  const score15 = Math.max(0, (raw / maxRaw) * TOTAL_OVER);

  // Guardar intento
  saveHistory({
    when: nowISO(),
    count: currentQuiz.length,
    correct, wrong, blank,
    raw,
    score15
  });

  // Mostrar resultados + corrección por pregunta
  const resultEl = document.getElementById("result");
  let html = `
    <div><strong>Resultados</strong></div>
    <div>✅ Correctas: <strong>${correct}</strong></div>
    <div>❌ Incorrectas: <strong>${wrong}</strong></div>
    <div>➖ En blanco: <strong>${blank}</strong></div>
    <hr/>
    <div>Puntuación bruta: <strong>${raw.toFixed(2)}</strong> (máx ${maxRaw.toFixed(2)})</div>
    <div>Nota sobre ${TOTAL_OVER}: <strong>${score15.toFixed(2)}</strong></div>
    <hr/>
    <div class="muted small">Regla: +${SCORE_CORRECT} acierto, ${SCORE_WRONG} error, blanco 0. Escalado a ${TOTAL_OVER}.</div>
    <hr/>
    <div><strong>Corrección por pregunta</strong></div>
  `;

  currentQuiz.forEach((q, i) => {
    const sel = getSelected(i);
    const isBlank = sel === null;
    const isOk = sel === q.answerIndex;

    const userText = isBlank ? "En blanco" : `${String.fromCharCode(97+sel)}) ${q.options[sel]}`;
    const correctText = `${String.fromCharCode(97+q.answerIndex)}) ${q.options[q.answerIndex]}`;

    html += `
      <div style="margin:10px 0;">
        <div><strong>${i+1}.</strong> ${q.question} <span class="tag">${q.topic || "Sin tema"}</span></div>
        <div>Tu respuesta: ${
          isBlank ? `<span class="muted">${userText}</span>` :
          isOk ? `<span class="ok">${userText}</span>` :
                 `<span class="bad">${userText}</span>`
        }</div>
        <div>Correcta: <span class="ok">${correctText}</span></div>
      </div>
    `;
  });

  resultEl.innerHTML = html;
  resultEl.style.display = "block";
  resultEl.scrollIntoView({ behavior: "smooth" });

  renderHistory();
}

// =====================
// UI wiring
// =====================
const statusEl = document.getElementById("status");
const loadBtn = document.getElementById("loadBtn");
const startBtn = document.getElementById("startBtn");
const finishBtn = document.getElementById("finishBtn");
const resetBtn = document.getElementById("resetBtn");
const sourceSelect = document.getElementById("sourceSelect");
const sheetUrlInput = document.getElementById("sheetUrl");

sourceSelect.addEventListener("change", () => {
  sheetUrlInput.style.display = (sourceSelect.value === "sheet") ? "block" : "none";
});

loadBtn.addEventListener("click", async () => {
  try {
    statusEl.textContent = "Cargando preguntas…";
    startBtn.disabled = true;
    finishBtn.disabled = true;
    resetBtn.disabled = true;
    document.getElementById("quiz").innerHTML = "";
    document.getElementById("result").style.display = "none";

    if (sourceSelect.value === "json") {
      questionBank = await loadFromJson();
    } else {
      const url = sheetUrlInput.value.trim();
      if (!url) throw new Error("Pega la URL CSV publicada de Google Sheets.");
      questionBank = await loadFromSheetCsv(url);
    }

    statusEl.textContent = `✅ Preguntas cargadas: ${questionBank.length}. Ya puedes generar un test aleatorio.`;
    startBtn.disabled = false;
  } catch (e) {
    statusEl.textContent = `❌ Error: ${e.message}`;
  }
});

startBtn.addEventListener("click", () => {
  const n = Math.max(1, Number(document.getElementById("numQuestions").value || 1));
  const shuffleOpts = document.getElementById("shuffleOptions").value === "yes";
  currentQuiz = buildRandomQuiz(n, shuffleOpts);
  graded = false;

  renderQuiz();

  statusEl.textContent = `🧪 Test generado: ${currentQuiz.length} preguntas (mezclado).`;
  finishBtn.disabled = false;
  resetBtn.disabled = false;
  document.getElementById("result").style.display = "none";
  window.scrollTo({ top: 0, behavior: "smooth" });
});

finishBtn.addEventListener("click", () => {
  if (!currentQuiz.length) return;
  gradeQuiz();
});

resetBtn.addEventListener("click", () => {
  currentQuiz = [];
  graded = false;
  document.getElementById("quiz").innerHTML = "";
  document.getElementById("result").style.display = "none";
  finishBtn.disabled = true;
  resetBtn.disabled = true;
  statusEl.textContent = "Listo: genera un nuevo test aleatorio.";
});

document.getElementById("clearHistoryBtn").addEventListener("click", () => {
  clearHistory();
  renderHistory();
});

// Render inicial historial
renderHistory();
