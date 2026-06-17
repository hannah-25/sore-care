/**
 * 자동 선택 결과를 연속 구간으로 묶어 타임라인 생성
 *
 * 입력: results[dateIndex][shift] = { name, ... }
 * 출력: { D: [{name, startIdx, endIdx, span, dates}], E: [...], N: [...] }
 */
export function buildTimeline(results, dates) {
  const shifts = ['D', 'E', 'N'];
  const timeline = {};

  for (const shift of shifts) {
    const segments = [];
    let current = null;

    for (let i = 0; i < results.length; i++) {
      const cell = results[i][shift];
      const name = cell ? cell.name : null;

      if (!current || current.name !== name) {
        if (current) segments.push(current);
        current = {
          name,
          shift,
          startIdx: i,
          endIdx: i,
          span: 1,
          dates: [dates[i]],
          needsManual: name === null
        };
      } else {
        current.endIdx = i;
        current.span++;
        current.dates.push(dates[i]);
      }
    }
    if (current) segments.push(current);

    timeline[shift] = segments;
  }

  return timeline;
}

// EMR 템플릿 copyOrder에 맞춰 순차 복사 목록 생성
export function buildCopyQueue(timeline, template, dates) {
  const queue = [];

  for (const entry of template.copyOrder) {
    const { dayIndex, shift } = entry;
    if (dayIndex >= dates.length) continue;

    // 이 dayIndex가 속한 세그먼트 찾기
    const segments = timeline[shift] || [];
    const seg = segments.find(s => s.startIdx <= dayIndex && dayIndex <= s.endIdx);

    if (seg) {
      // 이미 큐에 있는 세그먼트면 건너뜀 (연속 구간은 한 번만)
      const alreadyIn = queue.find(q => q.shift === shift && q.startIdx === seg.startIdx);
      if (!alreadyIn) {
        queue.push({ ...seg });
      }
    } else {
      queue.push({
        name: null,
        shift,
        startIdx: dayIndex,
        endIdx: dayIndex,
        span: 1,
        dates: [dates[dayIndex]],
        needsManual: true
      });
    }
  }

  return queue;
}
