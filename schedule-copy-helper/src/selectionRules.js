/**
 * scheduleStore: { "2025-06": { startDate, schedule }, "2025-07": { ... }, ... }
 * windowStartDate: ISO date string "2025-06-29"
 */

export function runAutoSelection(scheduleStore, windowStartDate, config, windowSize = 8) {
  const { staff, exclude, lowPriority } = config;
  const shifts = ['D', 'E', 'N'];

  // 최대 windowSize일, 데이터 있는 날까지만
  const isoDates = [];
  for (let d = 0; d < windowSize; d++) {
    const isoDate = addDays(windowStartDate, d);
    if (!hasScheduleForDate(scheduleStore, isoDate)) break;
    isoDates.push(isoDate);
  }

  const dateCount = isoDates.length;
  if (dateCount === 0) return { dates: [], isoDates: [], results: [] };

  // 전체 스토어에서 인원 이름 수집
  const allNames = new Set();
  for (const m of Object.values(scheduleStore)) {
    for (const n of Object.keys(m.schedule)) allNames.add(n);
  }

  const results = Array.from({ length: dateCount }, () => ({}));
  const prevSelected = {};

  for (let d = 0; d < dateCount; d++) {
    const isoDate = isoDates[d];
    const staffOrdered = staff.filter(n => allNames.has(n));

    for (const shift of shifts) {
      const allOnShift = staffOrdered.filter(n => getShift(scheduleStore, n, isoDate) === shift);
      const excluded = allOnShift.filter(n => exclude.includes(n));
      const candidates = allOnShift.filter(n => !exclude.includes(n));
      const normalCandidates = candidates.filter(n => !lowPriority.includes(n));
      const lowCandidates = candidates.filter(n => lowPriority.includes(n));

      let selected = null;
      let reason = '';
      const pool = normalCandidates.length > 0 ? normalCandidates : lowCandidates;

      if (pool.length === 0) {
        selected = null;
        reason = '후보 없음 — 수동 확인 필요';
      } else if (pool.length === 1) {
        selected = pool[0];
        reason = normalCandidates.length === 0
          ? `후순위(${selected})만 존재하여 선택`
          : '단독 후보';
      } else {
        const prev = prevSelected[shift];
        if (prev && pool.includes(prev)) {
          selected = prev;
          reason = '전날 선택자와 연속됨';
        } else {
          const streaks = pool.map(n => ({
            name: n,
            streak: calcStreakFrom(scheduleStore, n, shift, isoDate)
          }));
          const maxStreak = Math.max(...streaks.map(s => s.streak));
          const topCandidates = streaks.filter(s => s.streak === maxStreak);

          if (topCandidates.length === 1) {
            selected = topCandidates[0].name;
            reason = `오늘부터 가장 긴 연속 근무 (${maxStreak}일)`;
          } else {
            const fallback = staffOrdered.find(n => topCandidates.some(t => t.name === n));
            selected = fallback ?? null;
            reason = `연속 길이 동일 (${maxStreak}일) — 근무표 순서 우선`;
          }
        }
      }

      results[d][shift] = { date: formatDateShort(isoDate), shift, name: selected, reason, candidates: allOnShift, excluded };
      prevSelected[shift] = selected;
    }
  }

  return { dates: isoDates.map(formatDateShort), isoDates, results };
}

function calcStreakFrom(scheduleStore, name, shift, startIsoDate) {
  let count = 0;
  let d = 0;
  while (true) {
    const isoDate = addDays(startIsoDate, d);
    const s = getShift(scheduleStore, name, isoDate);
    if (s === undefined || s !== shift) break;
    count++;
    d++;
    if (d > 60) break; // 무한루프 방지
  }
  return count;
}

function getShift(scheduleStore, name, isoDate) {
  const monthKey = isoDate.substring(0, 7);
  const monthData = scheduleStore[monthKey];
  if (!monthData || !monthData.schedule[name]) return undefined;
  const idx = daysBetween(monthData.startDate, isoDate);
  if (idx < 0) return undefined;
  return monthData.schedule[name][idx];
}

function hasScheduleForDate(scheduleStore, isoDate) {
  const monthKey = isoDate.substring(0, 7);
  const monthData = scheduleStore[monthKey];
  if (!monthData) return false;
  const idx = daysBetween(monthData.startDate, isoDate);
  return idx >= 0 && Object.values(monthData.schedule).some(arr => idx < arr.length);
}

function addDays(isoDateStr, n) {
  const d = new Date(isoDateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateShort(isoDate) {
  const [, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}
