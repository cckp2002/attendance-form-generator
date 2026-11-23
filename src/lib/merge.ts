import type { Calendar } from './calendar';
import { classifyCategory } from './classify';
import { fmtMD } from './dates';
import { deriveEarlyStart, deriveLateArrival, sortPeriods } from './periods';
import type { Case, DayEntry, Flag, RawRecord } from './types';

export const normReason = (s: string) => s.replace(/\s+/g, ' ').trim();

export const studentKeyOf = (r: Pick<RawRecord, 'grade' | 'classNo' | 'number' | 'name'>) =>
  `${r.grade}-${r.classNo}-${r.number}-${r.name}`;

let seq = 0;
export const newCaseId = () => `case-${++seq}`;
export function resetCaseIds() {
  seq = 0;
}

/**
 * 자동 통합: 동일 학생 + 동일 출결구분 + 동일 사유 + 연속된 등교일 → 하나의 확인서
 * (학생 식별: 학년-반-번호-이름 모두 같아야 같은 학생)
 */
export function buildCases(records: RawRecord[], cal: Calendar): Case[] {
  const groups = new Map<string, RawRecord[]>();
  for (const r of records) {
    const key = [studentKeyOf(r), r.category, normReason(r.reason)].join('\u0001');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const cases: Case[] = [];
  for (const recs of groups.values()) {
    recs.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.rowNo - b.rowNo);

    // 같은 날짜 기록은 한 날짜 항목으로 합침 (여러 파일에 중복 입력된 경우 포함)
    const days: { dateISO: string; periods: string[]; ids: string[]; dupNote: boolean }[] = [];
    for (const r of recs) {
      const last = days[days.length - 1];
      if (last && last.dateISO === r.dateISO) {
        const before = new Set(last.periods);
        const identical = r.periods.length === before.size && r.periods.every((p) => before.has(p));
        last.periods = sortPeriods([...last.periods, ...r.periods]);
        last.ids.push(r.id);
        if (!identical) last.dupNote = true;
      } else {
        days.push({ dateISO: r.dateISO, periods: sortPeriods(r.periods), ids: [r.id], dupNote: false });
      }
    }

    // 연속 등교일끼리 묶기
    const runs: (typeof days)[] = [];
    const runGapFlags: Flag[][] = [];
    for (const d of days) {
      const run = runs[runs.length - 1];
      const prev = run?.[run.length - 1];
      if (prev && cal.isSchoolDay(d.dateISO) && cal.nextSchoolDay(prev.dateISO) === d.dateISO) {
        run.push(d);
      } else {
        const flags: Flag[] = [];
        if (prev) {
          const between = cal.schoolDaysBetween(prev.dateISO, d.dateISO);
          if (between.length > 0 && between.length <= 3) {
            flags.push({
              level: 'warn',
              code: 'gap',
              message: `${fmtMD(prev.dateISO)} 기록과 사유·구분이 같지만 사이에 등교일(${between.map(fmtMD).join(', ')})이 있어 통합하지 않았습니다. 휴업일이라면 '휴업일 설정'에 추가한 뒤 다시 분석하세요.`,
            });
          }
        }
        runs.push([d]);
        runGapFlags.push(flags);
      }
    }

    runs.forEach((run, i) => {
      const first = recs[0];
      const ids = run.flatMap((d) => d.ids);
      const { docType } = classifyCategory(first.category);
      const autoFlags: Flag[] = [...runGapFlags[i]];
      if (run.some((d) => d.ids.length > 1)) {
        const diff = run.some((d) => d.dupNote);
        autoFlags.push({
          level: diff ? 'warn' : 'info',
          code: 'dup',
          message: diff
            ? '같은 날짜에 결시교시가 다른 기록이 여러 건 있어 교시를 합쳤습니다.'
            : '같은 날짜의 동일한 기록이 중복되어 1건으로 정리했습니다.',
        });
      }
      cases.push({
        id: newCaseId(),
        studentKey: studentKeyOf(first),
        grade: first.grade,
        classNo: first.classNo,
        number: first.number,
        name: first.name,
        category: first.category,
        docType,
        reason: normReason(first.reason),
        entries: run.map((d) => ({ dateISO: d.dateISO, periods: d.periods })),
        recordIds: ids,
        merged: ids.length > 1,
        manual: false,
        reviewed: false,
        autoFlags,
      });
    });
  }

  cases.sort(
    (a, b) =>
      a.entries[0].dateISO.localeCompare(b.entries[0].dateISO) ||
      a.grade.localeCompare(b.grade) ||
      a.classNo.localeCompare(b.classNo, undefined, { numeric: true }) ||
      +a.number - +b.number,
  );
  return cases;
}

/** 항목들이 모두 연속된 등교일인가 (기간 "~" 표기 가능 여부) */
export function isContiguous(entries: DayEntry[], cal: Calendar): boolean {
  const dates = entries.map((e) => e.dateISO).sort();
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] === dates[i - 1]) continue;
    if (!cal.isSchoolDay(dates[i]) || cal.nextSchoolDay(dates[i - 1]) !== dates[i]) return false;
  }
  return true;
}

/** 화면/출력 직전에 계산되는 점검 항목 */
export function computeFlags(c: Case, cal: Calendar): Flag[] {
  const flags: Flag[] = [...c.autoFlags];
  if (!c.docType) {
    flags.push({ level: 'error', code: 'unclassified', message: `분류할 수 없는 출결구분입니다 (원본: ${c.category}). 확인서 종류를 직접 선택해 주세요.` });
  }
  if (!c.entries.length) flags.push({ level: 'error', code: 'noentry', message: '날짜 정보가 없습니다.' });
  if (!c.reason.trim()) flags.push({ level: 'warn', code: 'noreason', message: '사유가 비어 있습니다.' });
  for (const e of c.entries) {
    if (!cal.isSchoolDay(e.dateISO)) {
      flags.push({ level: 'warn', code: 'nonschool', message: `${fmtMD(e.dateISO)}은(는) 주말 또는 휴업일입니다. 날짜를 확인하세요.` });
    }
  }
  if (c.docType === 'early') {
    for (const e of c.entries) {
      const d = deriveEarlyStart(e);
      if (!d.label) flags.push({ level: 'error', code: 'early-missing', message: `${fmtMD(e.dateISO)}: ${d.note}. 직접 입력해 주세요.` });
      else if (d.estimated && d.note && /결석과 구분/.test(d.note)) flags.push({ level: 'warn', code: 'early-first', message: `${fmtMD(e.dateISO)}: ${d.note}` });
    }
  }
  if (c.docType === 'late') {
    for (const e of c.entries) {
      const d = deriveLateArrival(e);
      if (!d.label) flags.push({ level: 'error', code: 'late-missing', message: `${fmtMD(e.dateISO)}: ${d.note}. 등교 교시를 직접 입력해 주세요.` });
      else if (d.estimated) flags.push({ level: 'warn', code: 'late-est', message: `${fmtMD(e.dateISO)}: ${d.note}` });
    }
  }
  if (c.docType === 'result' && c.entries.some((e) => !e.periods.length)) {
    flags.push({ level: 'warn', code: 'result-noperiod', message: '결시교시가 없는 날짜가 있습니다.' });
  }
  return flags;
}

export const hasError = (flags: Flag[]) => flags.some((f) => f.level === 'error');
export const needsReview = (c: Case, flags: Flag[]) => hasError(flags) || (!c.reviewed && flags.some((f) => f.level === 'warn'));

/** 자동 통합 해제: 날짜별로 분리 */
export function splitCase(c: Case): Case[] {
  if (c.entries.length < 2) return [c];
  return c.entries.map((e, i) => ({
    ...c,
    id: newCaseId(),
    entries: [e],
    recordIds: c.recordIds.length === c.entries.length ? [c.recordIds[i]] : c.recordIds,
    merged: false,
    manual: true,
    reviewed: false,
    autoFlags: [],
  }));
}

export function canMerge(cs: Case[]): string | null {
  if (cs.length < 2) return '두 건 이상 선택하세요.';
  if (new Set(cs.map((c) => c.studentKey)).size > 1) return '서로 다른 학생의 기록은 통합할 수 없습니다.';
  if (new Set(cs.map((c) => c.category)).size > 1) return '출결구분이 다른 기록은 통합할 수 없습니다. (별도 확인서로 유지)';
  if (cs.some((c) => !c.docType)) return '분류되지 않은 기록이 포함되어 있습니다.';
  return null;
}

/** 수동 통합 (canMerge 통과 후 사용) */
export function mergeCases(cs: Case[]): Case {
  const sorted = [...cs].sort((a, b) => a.entries[0].dateISO.localeCompare(b.entries[0].dateISO));
  const entries = sorted.flatMap((c) => c.entries).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const reasons = [...new Set(sorted.map((c) => c.reason).filter(Boolean))];
  const autoFlags: Flag[] = [];
  if (reasons.length > 1) {
    autoFlags.push({ level: 'warn', code: 'manual-reason', message: `사유가 서로 다른 기록을 수동 통합했습니다 (${reasons.join(' / ')}). 사유를 확인하세요.` });
  }
  return {
    ...sorted[0],
    id: newCaseId(),
    reason: reasons.join(', '),
    entries,
    recordIds: sorted.flatMap((c) => c.recordIds),
    merged: true,
    manual: true,
    reviewed: false,
    autoFlags,
  };
}

export function sortCases(cs: Case[]): Case[] {
  return [...cs].sort(
    (a, b) =>
      (a.entries[0]?.dateISO ?? '').localeCompare(b.entries[0]?.dateISO ?? '') ||
      a.grade.localeCompare(b.grade) ||
      a.classNo.localeCompare(b.classNo, undefined, { numeric: true }) ||
      +a.number - +b.number,
  );
}
