import { runAutoSelection, formatDateShort } from "./selectionRules.js";
const STORAGE_KEYS = {
  schedule: "schedule-copy-helper:schedule",
  config: "schedule-copy-helper:config",
  windowSize: "schedule-copy-helper:windowSize"
};
const MIN_WINDOW_SIZE = 1;
const MAX_WINDOW_SIZE = 31;

const state = {
  scheduleStore: {},    // { "2025-06": { startDate, schedule }, ... }
  localScheduleStore: {},
  windowStartDate: null,
  config: {
    staff: [],
    exclude: [],
    lowPriority: []
  },
  windowSize: 8,
  dates: [],
  isoDates: [],
  results: [],
  sequenceSteps: [],
  sequenceIndex: 0,
  prevRenderedShift: null,
  editorMonth: null,
  editorSchedule: null
};

const els = {
  scheduleModal: document.getElementById("schedule-modal"),
  scheduleFeedback: document.getElementById("schedule-feedback"),
  settingsModal: document.getElementById("settings-modal"),
  scheduleJson: document.getElementById("schedule-json"),
  staffList: document.getElementById("staff-list"),
  excludeList: document.getElementById("exclude-list"),
  lowPriorityList: document.getElementById("low-priority-list"),
  schedulePreview: document.getElementById("schedule-preview"),
  selectionBody: document.getElementById("selection-body"),
  selectionToggleLabel: document.getElementById("selection-toggle-label"),
  sequencePanel: document.getElementById("sequence-panel"),
  copyFeedback: document.getElementById("copy-feedback"),
  dateRange: document.getElementById("date-range-display"),
  startDateInput: document.getElementById("start-date-input"),
  customWindowSize: document.getElementById("custom-window-size"),
  loadedMonths: document.getElementById("loaded-months-display"),
  schedulesModal: document.getElementById("schedules-modal"),
  schedulesList: document.getElementById("schedules-list"),
  scheduleEditorModal: document.getElementById("schedule-editor-modal"),
  editorMonth: document.getElementById("editor-month"),
  editorGrid: document.getElementById("editor-grid"),
  editorFeedback: document.getElementById("editor-feedback"),
  editorStaffName: document.getElementById("editor-staff-name"),
  editorStartDate: document.getElementById("editor-start-date")
};

async function init() {
  await loadConfig();
  hydrateSettings();
  const savedSize = localStorage.getItem(STORAGE_KEYS.windowSize);
  const parsedSavedSize = parseWindowSize(savedSize);
  if (parsedSavedSize) state.windowSize = parsedSavedSize;
  updateWindowSizeButtons();

  loadSavedSchedules();

  if (Object.keys(state.scheduleStore).length > 0) {
    const savedWindowDate = localStorage.getItem("lastStartDate");
    const earliest = Object.values(state.scheduleStore).map(m => m.startDate).sort()[0];
    state.windowStartDate = savedWindowDate || earliest;
    rerunSelection();
    closeScheduleModal();
  } else {
    openScheduleModal();
  }

  bindEvents();
}

function loadSavedSchedules() {
  const saved = localStorage.getItem(STORAGE_KEYS.schedule) || localStorage.getItem("lastSchedule");

  if (!saved) {
    rebuildScheduleStore();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    const firstValue = parsed && typeof parsed === "object" ? Object.values(parsed)[0] : null;

    if (firstValue?.startDate && firstValue?.schedule) {
      state.localScheduleStore = parsed;
    } else if (parsed?.startDate && parsed?.schedule) {
      const monthKey = parsed.month || parsed.startDate.substring(0, 7);
      state.localScheduleStore[monthKey] = {
        startDate: parsed.originalStartDate || parsed.startDate,
        schedule: parsed.schedule
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEYS.schedule);
  }

  rebuildScheduleStore();
}

function rebuildScheduleStore() {
  state.scheduleStore = { ...state.localScheduleStore };
}

function persistLocalSchedules() {
  localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(state.localScheduleStore));
  localStorage.setItem("lastSchedule", JSON.stringify(state.localScheduleStore));
}

function formatSavedSchedule(saved) {
  try {
    return JSON.stringify(JSON.parse(saved), null, 2);
  } catch {
    return saved;
  }
}

async function loadConfig() {
  const saved = localStorage.getItem(STORAGE_KEYS.config);
  if (!saved) return;
  try {
    state.config = JSON.parse(saved);
  } catch {
    localStorage.removeItem(STORAGE_KEYS.config);
  }
}

function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function hydrateSettings() {
  els.staffList.value = state.config.staff.join("\n");
  els.excludeList.value = state.config.exclude.join("\n");
  els.lowPriorityList.value = state.config.lowPriority.join("\n");
}

function bindEvents() {
  document.getElementById("open-schedule").addEventListener("click", openScheduleModal);
  document.getElementById("import-schedule").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  document.getElementById("import-file-input").addEventListener("change", importScheduleFile);
  document.getElementById("copy-gemini-prompt").addEventListener("click", copyGeminiPrompt);
  document.getElementById("save-schedule").addEventListener("click", saveScheduleFromTextarea);
  document.getElementById("open-settings").addEventListener("click", openSettingsModal);
  document.getElementById("close-settings").addEventListener("click", closeSettingsModal);
  document.getElementById("save-settings").addEventListener("click", saveSettings);
  document.getElementById("apply-date").addEventListener("click", applyStartDateInput);

  document.querySelectorAll(".window-size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const size = Number(btn.dataset.size);
      applyWindowSize(size);
    });
  });
  els.customWindowSize?.addEventListener("change", () => {
    const size = parseWindowSize(els.customWindowSize.value);
    if (!size) {
      els.customWindowSize.value = String(state.windowSize);
      showFeedback(`칸수는 ${MIN_WINDOW_SIZE}~${MAX_WINDOW_SIZE} 사이 숫자로 입력해 주세요.`);
      return;
    }
    applyWindowSize(size);
  });
  els.customWindowSize?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.customWindowSize.blur();
    }
  });

  document.getElementById("selection-toggle").addEventListener("click", toggleSelectionResult);
  els.loadedMonths.addEventListener("click", openSchedulesModal);
  document.getElementById("close-schedules").addEventListener("click", closeSchedulesModal);
  document.getElementById("close-schedule-editor").addEventListener("click", closeScheduleEditor);
  document.getElementById("save-schedule-editor").addEventListener("click", saveScheduleEditor);
  document.getElementById("add-editor-staff").addEventListener("click", addEditorStaff);
  els.editorMonth.addEventListener("change", () => loadEditorMonth(els.editorMonth.value));
  els.editorStartDate.addEventListener("change", () => {
    if (state.editorSchedule && els.editorStartDate.value) {
      state.editorSchedule.startDate = els.editorStartDate.value;
      renderScheduleEditor();
    }
  });
  els.schedulesModal.addEventListener("click", e => { if (e.target === els.schedulesModal) closeSchedulesModal(); });
  els.scheduleEditorModal.addEventListener("click", e => { if (e.target === els.scheduleEditorModal) closeScheduleEditor(); });
  window.addEventListener("resize", fitScheduleEditor);

  els.scheduleModal.addEventListener("click", event => {
    if (event.target === els.scheduleModal) closeScheduleModal();
  });
  els.settingsModal.addEventListener("click", event => {
    if (event.target === els.settingsModal) closeSettingsModal();
  });
}

function openScheduleModal() {
  els.scheduleJson.value = "";
  els.scheduleFeedback.textContent = "";
  els.scheduleModal.classList.add("open");
}

function closeScheduleModal() {
  els.scheduleModal.classList.remove("open");
}

function openSettingsModal() {
  hydrateSettings();
  els.settingsModal.classList.add("open");
}

function closeSettingsModal() {
  els.settingsModal.classList.remove("open");
}

function importScheduleFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      els.scheduleFeedback.textContent = "";
      els.scheduleJson.value = JSON.stringify(parsed, null, 2);
      loadSchedule(parsed, true);
    } catch (error) {
      els.scheduleFeedback.textContent = `파일을 읽을 수 없습니다. ${error.message}`;
    }
  };
  reader.readAsText(file);
}

async function copyGeminiPrompt() {
  const staff = state.config.staff.length ? state.config.staff.join(", ") : "등록된 직원 명단 없음";
  const prompt = `[역할]
당신은 병원 간호부 근무표 이미지에서 날짜별 근무 데이터를 한 치의 오차 없이 추출하는 데이터 분석 전문가입니다.

[작업 목적]
첨부된 근무표 이미지의 표(Grid)를 읽고, 각 직원별 1일부터 말일까지의 근무 데이터를 수직 정렬의 틀어짐 없이 정확히 추출하여 JSON으로 변환합니다.

[참고 명단]
[${staff}]

[작업 순서]

시각적 기준점(Anchor) 확보:
표에서 색상으로 칠해진 주말(토, 일) 칸이 며칠인지 먼저 파악하세요.
날짜 헤더(1~31일)와 각 직원의 행이 만나는 수직축을 읽어 내려갈 때, 이 주말 색상 칸을 잣대 삼아 열이 밀리지 않도록 기준을 잡으세요.

중간 기준일(Milestone) 교차 검증 브리핑:
수직 정렬 오류(Off-by-one error)를 막기 위해, 본격적인 추출 전 모든 직원의 10일, 20일, 30일 근무 코드를 먼저 읽어내어 텍스트로 짧게 브리핑하세요.
브리핑 예시: "OOO - 10일: D, 20일: off, 30일: N"

전체 날짜 매핑 및 특이사항 점검:
각 직원별로 1일부터 말일까지 차례대로 매핑합니다.
규정된 근무 코드(D, E, N, M, S, off)가 아닌 다른 글자(예: 연1, 연3 등 연차 표기)가 있거나, 정렬이 애매해서 확신이 서지 않는 칸은 임의로 추측하지 마세요. 브리핑에 "OOO 며칠: 확인 필요 (사유)"라고 명시하세요.

최종 JSON 출력:
위 1~3단계의 검증이 끝난 후, 최종 결과물만 아래 JSON 형식으로 출력하세요.
startDate는 해당 월의 1일 날짜로 기재하세요. (예: "2026-08-01")
각 직원의 근무 데이터는 배열(Array) 형태로 작성하며, 배열의 첫 번째 값(index 0)이 1일, 두 번째 값이 2일의 근무가 되도록 순서대로 나열하세요.

[JSON 형식]
{
"month": "YYYY-MM",
"startDate": "YYYY-MM-DD",
"schedule": {
"직원명1": ["D", "E", "N", "M", "S", "off", ...],
"직원명2": ["off", "D", "D", "N", "off", "D", ...]
}
}

[규칙]

근무 코드는 D, E, N, M, S, off 만 사용합니다.
규정 외의 표기가 있거나 해독이 불확실한 날짜는 JSON 값에도 반드시 "확인 필요"라고 적습니다.`;
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = prompt;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  els.scheduleFeedback.textContent = "Gemini 프롬프트를 복사했습니다. 사진과 함께 Gemini에 붙여 넣으세요.";
}

function saveScheduleFromTextarea() {
  const raw = els.scheduleJson.value.trim();
  if (!raw) {
    els.scheduleFeedback.textContent = "JSON을 입력해 주세요.";
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    els.scheduleFeedback.textContent = "";
    loadSchedule(parsed, true);
  } catch (error) {
    els.scheduleFeedback.textContent = `근무표 JSON을 확인해 주세요. ${error.message}`;
  }
}

function loadSchedule(data, persist) {
  validateSchedule(data);
  const monthKey = data.month;
  state.localScheduleStore[monthKey] = { startDate: data.startDate, schedule: data.schedule };
  rebuildScheduleStore();

  if (!state.windowStartDate) {
    state.windowStartDate = data.startDate;
  }

  if (persist) {
    persistLocalSchedules();
  }

  rerunSelection();
  closeScheduleModal();
}

function validateSchedule(data) {
  if (!data?.month || !data?.startDate || !data?.schedule) {
    throw new Error("month, startDate, schedule 필드가 필요합니다.");
  }
  const maxDays = Math.max(...Object.values(data.schedule).map(arr => Array.isArray(arr) ? arr.length : 0));
  if (maxDays < 8) {
    throw new Error("최소 8일치 근무표가 필요합니다.");
  }
}

function rerunSelection() {
  if (!Object.keys(state.scheduleStore).length) return;

  const selection = runAutoSelection(state.scheduleStore, state.windowStartDate, state.config, state.windowSize);
  state.dates = selection.dates;
  state.isoDates = selection.isoDates;
  state.results = selection.results;
  state.sequenceSteps = buildSequenceSteps();
  state.sequenceIndex = 0;

  const [, wm, wd] = state.windowStartDate.split("-");
  els.startDateInput.value = `${Number(wm)}/${Number(wd)}`;

  renderSummary();
  renderSchedulePreview();
  renderSequenceCopy();
  renderLoadedMonths();
}

function renderSummary() {
  if (!state.dates.length) {
    els.dateRange.textContent = "해당 날짜 근무표 없음";
  } else {
    els.dateRange.textContent = state.dates.length > 1
      ? `${state.dates[0]} - ${state.dates[state.dates.length - 1]}`
      : state.dates[0];
  }
}

function renderLoadedMonths() {
  if (!els.loadedMonths) return;
  const months = Object.keys(state.scheduleStore).sort();
  if (!months.length) {
    els.loadedMonths.innerHTML = `<span style="color:var(--muted);font-weight:600;font-size:13px">-</span>`;
    return;
  }
  els.loadedMonths.innerHTML = months.map(key => {
    const [, m] = key.split("-");
    return `<span class="month-chip">${Number(m)}월</span>`;
  }).join("");
}

function openSchedulesModal() {
  renderSchedulesList();
  els.schedulesModal.classList.add("open");
}

function closeSchedulesModal() {
  els.schedulesModal.classList.remove("open");
}

function openScheduleEditor(initialMonth) {
  const months = Object.keys(state.localScheduleStore).sort();
  if (!months.length) {
    openScheduleModal();
    els.scheduleFeedback.textContent = "먼저 JSON으로 근무표를 가져와 주세요.";
    return;
  }
  els.editorMonth.innerHTML = months.map(month => `<option value="${escapeAttr(month)}">${escapeHtml(month)}</option>`).join("");
  loadEditorMonth(months.includes(initialMonth) ? initialMonth : months[0]);
  els.scheduleEditorModal.classList.add("open");
}

function closeScheduleEditor() {
  els.scheduleEditorModal.classList.remove("open");
  state.editorMonth = null;
  state.editorSchedule = null;
}

function loadEditorMonth(month) {
  const schedule = state.localScheduleStore[month];
  if (!schedule) return;
  state.editorMonth = month;
  state.editorSchedule = JSON.parse(JSON.stringify({ month, ...schedule }));
  els.editorMonth.value = month;
  els.editorStartDate.value = state.editorSchedule.startDate;
  els.editorFeedback.textContent = "";
  renderScheduleEditor();
}

function renderScheduleEditor() {
  const data = state.editorSchedule;
  if (!data) return;
  const names = Object.keys(data.schedule);
  const dayCount = Math.max(8, ...names.map(name => data.schedule[name].length));
  const dates = Array.from({ length: dayCount }, (_, index) => formatDateShort(addDaysISO(data.startDate, index)));

  els.editorGrid.innerHTML = `
    <table class="schedule-table" style="font-size:12px;min-width:max-content">
      <thead><tr><th style="position:sticky;left:0;background:#f7fbff;z-index:1">직원</th>${dates.map(date => `<th>${date}</th>`).join("")}<th>관리</th></tr></thead>
      <tbody>${names.map((name, row) => `
        <tr>
          <td class="name-cell" style="position:sticky;left:0;background:#fff;z-index:1"><input class="editor-name" data-row="${row}" value="${escapeHtml(name)}" aria-label="직원 이름"></td>
          ${Array.from({ length: dayCount }, (_, day) => `<td><input class="editor-shift shift-${escapeAttr(data.schedule[name][day] || "off")}" data-row="${row}" data-day="${day}" value="${escapeAttr(data.schedule[name][day] || "off")}" maxlength="3" aria-label="${escapeAttr(name)} ${dates[day]} 근무"></td>`).join("")}
          <td><button class="btn-light editor-delete" data-row="${row}" type="button" style="color:#c0392b;padding:3px 8px">삭제</button></td>
        </tr>`).join("")}</tbody>
    </table>`;

  els.editorGrid.querySelectorAll(".editor-shift").forEach(input => {
    input.addEventListener("keydown", event => handleEditorShiftKey(event, input));
    input.addEventListener("blur", () => setEditorShift(input, input.value));
  });
  els.editorGrid.querySelectorAll(".editor-name").forEach(input => {
    input.addEventListener("change", () => renameEditorStaff(Number(input.dataset.row), input.value));
  });
  els.editorGrid.querySelectorAll(".editor-delete").forEach(button => {
    button.addEventListener("click", () => {
      delete data.schedule[Object.keys(data.schedule)[Number(button.dataset.row)]];
      renderScheduleEditor();
    });
  });
  els.editorGrid.querySelector(".editor-shift")?.focus();
  requestAnimationFrame(fitScheduleEditor);
}

function fitScheduleEditor() {
  const table = els.editorGrid.querySelector("table");
  if (!table || !els.scheduleEditorModal.classList.contains("open")) return;
  table.style.zoom = "1";
  const availableWidth = els.editorGrid.clientWidth;
  const availableHeight = Math.max(1, window.innerHeight - 220);
  const scale = Math.min(1, availableWidth / table.scrollWidth, availableHeight / table.scrollHeight);
  table.style.zoom = String(scale);
}

function handleEditorShiftKey(event, input) {
  const shift = { d: "D", e: "E", n: "N", m: "M", s: "S", o: "off" }[event.key.toLowerCase()];
  const row = Number(input.dataset.row);
  const day = Number(input.dataset.day);
  if (shift) {
    event.preventDefault();
    setEditorShift(input, shift);
    focusEditorShift(row, day + 1);
    return;
  }
  const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] };
  if (moves[event.key]) {
    event.preventDefault();
    focusEditorShift(row + moves[event.key][0], day + moves[event.key][1]);
  }
}

function setEditorShift(input, value) {
  const shift = value.toLowerCase() === "off" || value.toLowerCase() === "o" ? "off" : value.toUpperCase();
  if (!["D", "E", "N", "M", "S", "off"].includes(shift)) {
    setEditorShift(input, "off");
    return;
  }
  const name = Object.keys(state.editorSchedule.schedule)[Number(input.dataset.row)];
  state.editorSchedule.schedule[name][Number(input.dataset.day)] = shift;
  input.value = shift;
  input.className = `editor-shift shift-${escapeAttr(shift)}`;
}

function focusEditorShift(row, day) {
  const input = els.editorGrid.querySelector(`.editor-shift[data-row="${row}"][data-day="${day}"]`);
  if (input) input.focus();
}

function renameEditorStaff(row, value) {
  const name = value.trim();
  const oldName = Object.keys(state.editorSchedule.schedule)[row];
  if (!name || (name !== oldName && state.editorSchedule.schedule[name])) {
    els.editorFeedback.textContent = "직원 이름을 입력하고 중복되지 않게 해주세요.";
    renderScheduleEditor();
    return;
  }
  if (name !== oldName) {
    const schedule = state.editorSchedule.schedule;
    schedule[name] = schedule[oldName];
    delete schedule[oldName];
  }
}

function addEditorStaff() {
  const name = els.editorStaffName.value.trim();
  const data = state.editorSchedule;
  if (!data || !name || data.schedule[name]) {
    els.editorFeedback.textContent = "직원 이름을 입력하고 중복 여부를 확인해 주세요.";
    return;
  }
  const dayCount = Math.max(8, ...Object.values(data.schedule).map(shifts => shifts.length));
  data.schedule[name] = Array(dayCount).fill("off");
  els.editorStaffName.value = "";
  renderScheduleEditor();
}

function saveScheduleEditor() {
  try {
    validateSchedule(state.editorSchedule);
    state.localScheduleStore[state.editorMonth] = {
      startDate: state.editorSchedule.startDate,
      schedule: state.editorSchedule.schedule
    };
    persistLocalSchedules();
    rebuildScheduleStore();
    rerunSelection();
    closeScheduleEditor();
  } catch (error) {
    els.editorFeedback.textContent = error.message;
  }
}

function renderSchedulesList() {
  const months = Object.keys(state.scheduleStore).sort();
  if (!months.length) {
    els.schedulesList.innerHTML = `<p style="color:var(--muted);font-size:14px">입력된 근무표가 없습니다.</p>`;
    return;
  }
  els.schedulesList.innerHTML = months.map(key => {
    const data = state.scheduleStore[key];
    const [y, m] = key.split("-");
    const names = Object.keys(data.schedule);
    const dayCount = Math.max(...names.map(n => data.schedule[n].length));
    const endDate = addDaysISO(data.startDate, dayCount - 1);
    const [, em, ed] = endDate.split("-");
    const [, sm, sd] = data.startDate.split("-");
    const dateLabel = `${Number(sm)}/${Number(sd)} ~ ${Number(em)}/${Number(ed)}`;
    return `
      <div class="schedule-row">
        <div class="schedule-row-info">
          <span class="schedule-row-month">${Number(m)}월 <span style="font-size:13px;color:var(--muted);font-weight:600">(${y})</span></span>
          <span class="schedule-row-meta">${dateLabel} · ${names.length}명 · ${dayCount}일</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-light" style="padding:4px 12px;font-size:12px" data-edit="${escapeAttr(key)}" type="button">수정</button>
          <button class="btn-light" style="color:#c0392b;border-color:#f5c0b8;padding:4px 12px;font-size:12px" data-delete="${escapeAttr(key)}" type="button">삭제</button>
        </div>
      </div>
    `;
  }).join("");

  els.schedulesList.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteMonth(btn.dataset.delete));
  });
  els.schedulesList.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      closeSchedulesModal();
      openScheduleEditor(btn.dataset.edit);
    });
  });
}

function deleteMonth(key) {
  delete state.localScheduleStore[key];
  rebuildScheduleStore();
  persistLocalSchedules();
  renderSchedulesList();
  if (Object.keys(state.scheduleStore).length) {
    rerunSelection();
  } else {
    state.dates = [];
    state.isoDates = [];
    state.results = [];
    state.sequenceSteps = [];
    state.windowStartDate = null;
    renderSummary();
    renderSchedulePreview();
    renderSequenceCopy();
    renderLoadedMonths();
  }
}

function addDaysISO(isoDateStr, n) {
  const d = new Date(isoDateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getShiftFromStore(name, isoDate) {
  const monthKey = isoDate.substring(0, 7);
  const monthData = state.scheduleStore[monthKey];
  if (!monthData || !monthData.schedule[name]) return "off";
  const idx = isoDateDiff(monthData.startDate, isoDate);
  return idx >= 0 ? (monthData.schedule[name][idx] || "off") : "off";
}

function isoDateDiff(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

function renderSchedulePreview() {
  const allNames = new Set();
  for (const m of Object.values(state.scheduleStore)) {
    for (const n of Object.keys(m.schedule)) allNames.add(n);
  }
  const names = [...allNames];

  const rows = names.map(name => {
    const cells = state.isoDates.map((isoDate, index) => {
      const shift = getShiftFromStore(name, isoDate);
      const selected = ["D", "E", "N"].some(s => state.results[index]?.[s]?.name === name);
      return `<td class="shift-${escapeAttr(shift)} ${selected ? "selected-cell" : ""}">${escapeHtml(shift)}</td>`;
    }).join("");
    return `<tr><td class="name-cell">${escapeHtml(name)}</td>${cells}</tr>`;
  }).join("");

  const resultRows = ["D", "E", "N"].map(shift => {
    const cells = state.results.map(day => {
      const cell = day[shift];
      return `<td>${escapeHtml(cell?.name || "수동 확인")}</td>`;
    }).join("");
    return `<tr><td class="name-cell">${shift}</td>${cells}</tr>`;
  }).join("");

  els.schedulePreview.innerHTML = `
    <table class="schedule-table">
      <thead>
        <tr><th>이름</th>${state.dates.map(date => `<th>${escapeHtml(date)}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="result-table">
      <thead>
        <tr><th>근무</th>${state.dates.map(date => `<th>${escapeHtml(date)}</th>`).join("")}</tr>
      </thead>
      <tbody>${resultRows}</tbody>
    </table>
  `;
}

function buildSequenceSteps() {
  const shiftLabels = { D: "Day", E: "Eve", N: "Night" };
  const steps = [];
  const total = state.dates.length;

  for (const shift of ["D", "E", "N"]) {
    let startIndex = 0;
    while (startIndex < total) {
      const name = state.results[startIndex]?.[shift]?.name || "";
      let endIndex = startIndex;

      while (
        endIndex + 1 < total
        && (state.results[endIndex + 1]?.[shift]?.name || "") === name
      ) {
        endIndex += 1;
      }

      steps.push({
        shift,
        shiftLabel: shiftLabels[shift],
        name,
        dates: state.dates.slice(startIndex, endIndex + 1),
        cellCount: endIndex - startIndex + 1
      });

      startIndex = endIndex + 1;
    }
  }

  return steps;
}

function renderSequenceCopy() {
  if (!state.sequenceSteps.length) {
    state.prevRenderedShift = null;
    els.sequencePanel.innerHTML = `
      <div class="sequence-card">
        <div class="sequence-card-body" style="padding:18px 15px 16px">
          <p class="sequence-meta">근무표를 먼저 입력해 주세요.</p>
        </div>
      </div>
    `;
    return;
  }

  if (state.sequenceIndex >= state.sequenceSteps.length) {
    state.sequenceIndex = state.sequenceSteps.length - 1;
  }

  const step = state.sequenceSteps[state.sequenceIndex];
  const isShiftChange = step.shift !== state.prevRenderedShift;
  const animClass = isShiftChange ? "anim-shift" : "";
  state.prevRenderedShift = step.shift;

  const dateRange = step.dates.length > 1
    ? `${step.dates[0]}~${step.dates[step.dates.length - 1]}`
    : step.dates[0];

  const count = step.cellCount;
  const sizeClass = count >= 6 ? "repeat-sm" : count >= 4 ? "repeat-md" : count >= 2 ? "repeat-lg" : "repeat-xl";
  const nameLines = step.name
    ? Array(count).fill(null).map(() => `<span class="repeat-name">${escapeHtml(step.name)}</span>`).join("")
    : `<span class="repeat-name no-name">수동 확인</span>`;

  els.sequencePanel.innerHTML = `
    <div class="sequence-card shift-${step.shift} ${animClass}">
      <div class="shift-strip">${escapeHtml(step.shift)}</div>
      <div class="sequence-card-content">
        <div class="sequence-card-body">
          <p class="sequence-date">${escapeHtml(dateRange)}<span class="cell-count-badge cell-count-${step.shift}">${count}칸</span></p>
          <div class="sequence-names-repeat ${sizeClass}">${nameLines}</div>
          <div class="sequence-actions">
            <button class="btn-primary" id="advance-sequence" type="button">완료 후 다음</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("advance-sequence")?.addEventListener("click", advanceSequence);
}

function currentSequenceStep() {
  return state.sequenceSteps[state.sequenceIndex] || null;
}

async function advanceSequence() {
  if (!state.sequenceSteps.length) return;
  state.sequenceIndex = (state.sequenceIndex + 1) % state.sequenceSteps.length;
  renderSequenceCopy();
  const step = currentSequenceStep();

  if (step?.name) {
    await repeatCopyRow(step.name);
    showFeedback(state.sequenceIndex === 0
      ? "처음 입력으로 돌아왔고 이름을 복사했습니다."
      : "다음 입력으로 이동했고 이름을 복사했습니다.");
  } else {
    showFeedback(state.sequenceIndex === 0
      ? "처음 입력으로 돌아왔습니다. 수동 확인이 필요합니다."
      : "다음 입력으로 이동했습니다. 수동 확인이 필요합니다.");
  }
}


function updateWindowSizeButtons() {
  document.querySelectorAll(".window-size-btn").forEach(btn => {
    const active = Number(btn.dataset.size) === state.windowSize;
    btn.classList.toggle("btn-primary", active);
    btn.classList.toggle("btn-ghost", !active);
  });
  if (els.customWindowSize) {
    els.customWindowSize.value = String(state.windowSize);
  }
}

function applyWindowSize(size) {
  const parsedSize = parseWindowSize(size);
  if (!parsedSize || state.windowSize === parsedSize) {
    updateWindowSizeButtons();
    return;
  }

  state.windowSize = parsedSize;
  localStorage.setItem(STORAGE_KEYS.windowSize, String(parsedSize));
  updateWindowSizeButtons();
  if (Object.keys(state.scheduleStore).length) rerunSelection();
}

function parseWindowSize(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < MIN_WINDOW_SIZE || size > MAX_WINDOW_SIZE) return null;
  return size;
}

function toggleSelectionResult() {
  const isHidden = els.selectionBody.style.display === "none";
  els.selectionBody.style.display = isHidden ? "block" : "none";
  els.selectionToggleLabel.textContent = isHidden ? "접기" : "펼치기";
}

async function applyStartDateInput() {
  if (!Object.keys(state.scheduleStore).length) return;

  const refDate = Object.values(state.scheduleStore).map(m => m.startDate).sort()[0];
  const parsed = parseMonthDay(els.startDateInput.value, refDate);
  if (!parsed) {
    showFeedback("날짜는 6/17 형식으로 입력해 주세요.");
    return;
  }

  state.windowStartDate = parsed;
  localStorage.setItem("lastStartDate", parsed);
  rerunSelection();

  const step = currentSequenceStep();
  if (step?.name) {
    await repeatCopyRow(step.name);
    showFeedback(`${step.name} 복사됨`);
  }
}

function parseMonthDay(value, fallbackDate) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const base = new Date(fallbackDate);
  const year = Number.isNaN(base.getFullYear()) ? new Date().getFullYear() : base.getFullYear();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function saveSettings() {
  state.config = {
    staff: parseLines(els.staffList.value),
    exclude: parseLines(els.excludeList.value),
    lowPriority: parseLines(els.lowPriorityList.value)
  };
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(state.config));
  closeSettingsModal();
  if (Object.keys(state.scheduleStore).length) rerunSelection();
}

async function repeatCopyRow(text) {
  try {
    await navigator.clipboard.writeText(text);
    showFeedback("복사 완료");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showFeedback("복사 완료");
  }
}

function showFeedback(message) {
  els.copyFeedback.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function escapeJsString(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "");
}

window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;

init().catch(error => {
  showFeedback(error.message);
  openScheduleModal();
});
