import { runAutoSelection } from "./selectionRules.js";
const STORAGE_KEYS = {
  schedule: "schedule-copy-helper:schedule",
  config: "schedule-copy-helper:config"
};

const state = {
  scheduleData: null,
  config: {
    staff: [],
    exclude: [],
    lowPriority: []
  },
  dates: [],
  results: [],
  sequenceSteps: [],
  sequenceIndex: 0
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
  repeatCopyPanel: document.getElementById("repeat-copy-panel"),
  copyFeedback: document.getElementById("copy-feedback"),
  dateRange: document.getElementById("date-range-display"),
  startDateInput: document.getElementById("start-date-input")
};

async function init() {
  await loadConfig();
  hydrateSettings();

  const saved = localStorage.getItem(STORAGE_KEYS.schedule) || localStorage.getItem("lastSchedule");
  if (saved) {
    try {
      loadSchedule(JSON.parse(saved), false);
      closeScheduleModal();
    } catch (error) {
      els.scheduleJson.value = formatSavedSchedule(saved);
      openScheduleModal();
      els.scheduleFeedback.textContent = error.message;
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
  document.getElementById("import-schedule").addEventListener("click", saveScheduleFromTextarea);
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
  if (state.scheduleData) {
    els.scheduleJson.value = JSON.stringify(state.scheduleData, null, 2);
  }
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
  state.scheduleData = data;
  els.scheduleJson.value = JSON.stringify(data, null, 2);

  if (persist) {
    localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(data));
    localStorage.setItem("lastSchedule", JSON.stringify(data));
  }

  rerunSelection();
  closeScheduleModal();
}

function validateSchedule(data) {
  if (!data || typeof data !== "object" || !data.startDate || !data.schedule) {
    throw new Error("month, startDate, schedule 필드가 필요합니다.");
  }

  const maxDays = Math.max(...Object.values(data.schedule).map(shifts => Array.isArray(shifts) ? shifts.length : 0));
  if (maxDays < 8) {
    throw new Error("1블록과 2블록 복사를 위해 시작일부터 최소 8일치 근무표가 필요합니다.");
  }
}

function rerunSelection() {
  if (!state.scheduleData) return;

  const selection = runAutoSelection(state.scheduleData, state.config);
  state.dates = selection.dates;
  state.results = selection.results;
  state.sequenceSteps = buildSequenceSteps();
  state.sequenceIndex = 0;

  els.startDateInput.value = state.dates[0] || "";

  renderSummary();
  renderSchedulePreview();
  renderSequenceCopy();
  renderRepeatCopy();
}

function renderSummary() {
  els.dateRange.textContent = state.dates.length
    ? `${state.dates[0]} - ${state.dates[state.dates.length - 1]}`
    : "-";
}

function renderSchedulePreview() {
  const schedule = state.scheduleData.schedule;
  const names = Object.keys(schedule);
  const rows = names.map(name => {
    const cells = state.dates.map((date, index) => {
      const shift = schedule[name][index] || "off";
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
  const blockSize = 4;
  const steps = [];

  for (let blockStart = 0; blockStart < state.dates.length; blockStart += blockSize) {
    const blockEnd = Math.min(blockStart + blockSize, state.dates.length);
    const blockIndex = Math.floor(blockStart / blockSize) + 1;

    for (const shift of ["D", "E", "N"]) {
      let startIndex = blockStart;
      while (startIndex < blockEnd) {
        const name = state.results[startIndex]?.[shift]?.name || "";
        let endIndex = startIndex;

        while (
          endIndex + 1 < blockEnd
          && (state.results[endIndex + 1]?.[shift]?.name || "") === name
        ) {
          endIndex += 1;
        }

        steps.push({
          blockIndex,
          shift,
          shiftLabel: shiftLabels[shift],
          name,
          dates: state.dates.slice(startIndex, endIndex + 1),
          cellCount: endIndex - startIndex + 1
        });

        startIndex = endIndex + 1;
      }
    }
  }

  return steps;
}

function renderSequenceCopy() {
  if (!state.sequenceSteps.length) {
    els.sequencePanel.innerHTML = `
      <div class="sequence-card">
        <div class="sequence-card-head">
          <span class="sequence-kicker">다음 입력</span>
          <span class="sequence-progress">0 / 0</span>
        </div>
        <div class="sequence-card-body">
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
  const dateRange = step.dates.length > 1
    ? `${step.dates[0]}~${step.dates[step.dates.length - 1]}`
    : step.dates[0];
  const displayName = step.name || "수동 확인";

  els.sequencePanel.innerHTML = `
    <div class="sequence-card">
      <div class="sequence-card-head">
        <span class="sequence-kicker">다음 입력</span>
        <span class="sequence-progress">${state.sequenceIndex + 1} / ${state.sequenceSteps.length}</span>
      </div>
      <div class="sequence-card-body">
        <p class="sequence-meta">${step.blockIndex}블록 · ${escapeHtml(step.shiftLabel)} · ${escapeHtml(dateRange)} · ${step.cellCount}칸</p>
        <p class="sequence-name">${escapeHtml(displayName)}</p>
        <div class="sequence-actions">
          <button class="btn-primary" id="advance-sequence" type="button">완료 후 다음</button>
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

function renderRepeatCopy() {
  const blockSize = 4;
  const blocks = [];

  for (let start = 0; start < state.dates.length; start += blockSize) {
    const blockIndex = blocks.length + 1;
    const dates = state.dates.slice(start, start + blockSize);
    const dateText = dates.join("\t");

    const allNames = dates
      .flatMap((_, offset) => ["D", "E", "N"].map(shift => state.results[start + offset]?.[shift]?.name || ""))
      .join("\t");

    blocks.push(`
      <div class="repeat-block">
        <div class="repeat-block-header">
          <span>
            ${blockIndex}블록
            <span class="repeat-range">${escapeHtml(dates[0] || "")}${dates.length > 1 ? ` - ${escapeHtml(dates[dates.length - 1])}` : ""}</span>
          </span>
          <span class="repeat-actions">
            <button class="repeat-date-btn" id="rbtn-date-${blockIndex}" type="button" onclick="repeatCopyRow('${escapeJsString(dateText)}')">날짜 복사</button>
            <button class="repeat-copy-btn" id="rbtn-${blockIndex}" type="button" onclick="repeatCopyRow('${escapeJsString(allNames)}')">복사 (${allNames.split("\t").filter(Boolean).length}개)</button>
          </span>
        </div>
      </div>
    `);
  }

  els.repeatCopyPanel.innerHTML = blocks.length
    ? `<div class="repeat-grid">${blocks.join("")}</div>`
    : `<div class="repeat-block"><div class="repeat-title">근무표를 먼저 입력해 주세요.</div></div>`;
}

function toggleSelectionResult() {
  const isHidden = els.selectionBody.style.display === "none";
  els.selectionBody.style.display = isHidden ? "block" : "none";
  els.selectionToggleLabel.textContent = isHidden ? "접기" : "펼치기";
}

function applyStartDateInput() {
  if (!state.scheduleData) return;

  const parsed = parseMonthDay(els.startDateInput.value, state.scheduleData.startDate);
  if (!parsed) {
    showFeedback("날짜는 6/17 형식으로 입력해 주세요.");
    return;
  }

  state.scheduleData = {
    ...state.scheduleData,
    startDate: parsed
  };
  localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(state.scheduleData));
  localStorage.setItem("lastSchedule", JSON.stringify(state.scheduleData));
  localStorage.setItem("lastStartDate", parsed);
  rerunSelection();
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
  rerunSelection();
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
window.repeatCopyRow = repeatCopyRow;

init().catch(error => {
  showFeedback(error.message);
  openScheduleModal();
});
