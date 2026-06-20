import { runAutoSelection, formatDateShort } from "./selectionRules.js";
const STORAGE_KEYS = {
  schedule: "schedule-copy-helper:schedule",
  config: "schedule-copy-helper:config"
};

const state = {
  scheduleStore: {},    // { "2025-06": { startDate, schedule }, ... }
  windowStartDate: null,
  config: {
    staff: [],
    exclude: [],
    lowPriority: []
  },
  dates: [],
  isoDates: [],
  results: [],
  sequenceSteps: [],
  sequenceIndex: 0,
  prevRenderedShift: null
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
  loadedMonths: document.getElementById("loaded-months-display")
};

async function init() {
  await loadConfig();
  hydrateSettings();

  const saved = localStorage.getItem(STORAGE_KEYS.schedule) || localStorage.getItem("lastSchedule");
  const savedWindowDate = localStorage.getItem("lastStartDate");

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const firstValue = parsed && typeof parsed === "object" ? Object.values(parsed)[0] : null;

      if (firstValue?.startDate && firstValue?.schedule) {
        // 새 스토어 형식
        state.scheduleStore = parsed;
      } else if (parsed?.startDate && parsed?.schedule) {
        // 구 단일 형식 마이그레이션
        const monthKey = parsed.month || parsed.startDate.substring(0, 7);
        state.scheduleStore[monthKey] = {
          startDate: parsed.originalStartDate || parsed.startDate,
          schedule: parsed.schedule
        };
      }

      if (Object.keys(state.scheduleStore).length > 0) {
        const earliest = Object.values(state.scheduleStore).map(m => m.startDate).sort()[0];
        state.windowStartDate = savedWindowDate || earliest;
        rerunSelection();
        closeScheduleModal();
      } else {
        openScheduleModal();
      }
    } catch {
      openScheduleModal();
    }
  } else {
    openScheduleModal();
  }

  bindEvents();
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
  if (saved) {
    try {
      state.config = JSON.parse(saved);
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEYS.config);
    }
  }

  const [staff, exclude, lowPriority] = await Promise.all([
    fetchText("config/staff.txt"),
    fetchText("config/exclude_names.txt"),
    fetchText("config/low_priority_names.txt")
  ]);

  state.config = {
    staff: parseLines(staff),
    exclude: parseLines(exclude),
    lowPriority: parseLines(lowPriority)
  };
}

async function fetchText(url) {
  try {
    const res = await fetch(url);
    return res.ok ? res.text() : "";
  } catch {
    return "";
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
  document.getElementById("save-schedule").addEventListener("click", saveScheduleFromTextarea);
  document.getElementById("open-settings").addEventListener("click", openSettingsModal);
  document.getElementById("close-settings").addEventListener("click", closeSettingsModal);
  document.getElementById("save-settings").addEventListener("click", saveSettings);
  document.getElementById("apply-date").addEventListener("click", applyStartDateInput);

  document.getElementById("selection-toggle").addEventListener("click", toggleSelectionResult);

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
  state.scheduleStore[monthKey] = { startDate: data.startDate, schedule: data.schedule };

  if (!state.windowStartDate) {
    state.windowStartDate = data.startDate;
  }

  if (persist) {
    localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(state.scheduleStore));
    localStorage.setItem("lastSchedule", JSON.stringify(state.scheduleStore));
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

  const selection = runAutoSelection(state.scheduleStore, state.windowStartDate, state.config);
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
    els.loadedMonths.textContent = "-";
    return;
  }
  els.loadedMonths.innerHTML = months.map(key => {
    const [, m] = key.split("-");
    return `<span class="month-chip">${Number(m)}월</span>`;
  }).join("");
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
  const animClass = isShiftChange ? "anim-shift" : "anim-step";
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
    <div class="sequence-card cells-${Math.min(count, 3)} ${animClass}">
      <div class="shift-strip">${escapeHtml(step.shift)}</div>
      <div class="sequence-card-content">
        <div class="sequence-card-body">
          <p class="sequence-date">${escapeHtml(dateRange)}<span class="cell-count-badge cell-count-${Math.min(count, 3)}">${count}칸</span></p>
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
