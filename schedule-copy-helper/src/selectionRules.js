/**
 * 날짜별 D/E/N 담당자 자동 선택
 *
 * 규칙:
 * 1. 해당 날짜/근무조 후보 추출
 * 2. exclude 제외
 * 3. lowPriority 후순위
 * 4. 전날 선택자가 오늘도 후보면 연속 선택
 * 5. 없으면 오늘부터 가장 긴 연속 근무자 선택
 * 6. 연속 길이 동일하면 staff.txt 순서 fallback
 * 7. 일반 후보 없고 lowPriority만 있으면 선택
 * 8. 후보 없으면 null (수동 확인)
 */

export function runAutoSelection(scheduleData, config) {
  const { startDate, schedule } = scheduleData;
  const { staff, exclude, lowPriority } = config;

  const names = Object.keys(schedule);
  const dateCount = 8;
  const dates = buildDates(startDate, dateCount);
  const shifts = ['D', 'E', 'N'];

  // 결과: results[dateIndex][shift] = { name, reason, excluded, candidates }
  const results = Array.from({ length: dateCount }, () => ({}));

  // 이전 선택 추적 (규칙 4용)
  const prevSelected = {}; // shift -> name

  for (let d = 0; d < dateCount; d++) {
    for (const shift of shifts) {
      // 이 날짜/근무조에서 근무하는 사람 목록 (staff.txt 순서 기준)
      const staffOrdered = staff.filter(n => names.includes(n));
      const allOnShift = staffOrdered.filter(n => schedule[n][d] === shift);
      const excluded = allOnShift.filter(n => exclude.includes(n));
      const candidates = allOnShift.filter(n => !exclude.includes(n));
      const normalCandidates = candidates.filter(n => !lowPriority.includes(n));
      const lowCandidates = candidates.filter(n => lowPriority.includes(n));

      let selected = null;
      let reason = '';

      const pool = normalCandidates.length > 0 ? normalCandidates : lowCandidates;

      if (pool.length === 0) {
        // 규칙 8
        selected = null;
        reason = '후보 없음 — 수동 확인 필요';
      } else if (pool.length === 1) {
        selected = pool[0];
        reason = normalCandidates.length === 0
          ? `후순위(${selected})만 존재하여 선택`
          : '단독 후보';
      } else {
        // 규칙 4: 전날 선택자가 오늘도 후보면 연속
        const prev = prevSelected[shift];
        if (prev && pool.includes(prev)) {
          selected = prev;
          reason = '전날 선택자와 연속됨';
        } else {
          // 규칙 5: 오늘부터 가장 긴 연속 근무자
          const streaks = pool.map(n => ({
            name: n,
            streak: calcStreakFrom(schedule[n], shift, d)
          }));
          const maxStreak = Math.max(...streaks.map(s => s.streak));
          const topCandidates = streaks.filter(s => s.streak === maxStreak);

          if (topCandidates.length === 1) {
            selected = topCandidates[0].name;
            reason = `오늘부터 가장 긴 연속 근무 (${maxStreak}일)`;
          } else {
            // 규칙 6: staff.txt 순서 fallback
            const fallback = staffOrdered.find(n => topCandidates.some(t => t.name === n));
            selected = fallback;
            reason = `연속 길이 동일 (${maxStreak}일) — 근무표 순서 우선`;
          }
        }
      }

      results[d][shift] = {
        date: dates[d],
        shift,
        name: selected,
        reason,
        candidates: allOnShift,
        excluded
      };

      prevSelected[shift] = selected;
    }
  }

  return { dates, results };
}

// d번째 날부터 시작하는 연속 근무 길이 계산
function calcStreakFrom(shiftArr, shift, startIdx) {
  let count = 0;
  for (let i = startIdx; i < shiftArr.length; i++) {
    if (shiftArr[i] === shift) count++;
    else break;
  }
  return count;
}

function buildDates(startDate, count) {
  const dates = [];
  const base = new Date(startDate);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    dates.push(`${m}/${day}`);
  }
  return dates;
}
