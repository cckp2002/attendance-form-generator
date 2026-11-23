import type { Calendar } from './calendar';
import { fmtShort } from './dates';
import type { Case, DayEntry } from './types';

/** 표에 표시하는 짧은 기간: 10.22.~10.23. (2일) */
export function shortPeriod(entries: DayEntry[], cal: Calendar): string {
  const dates = [...new Set(entries.map((e) => e.dateISO))].sort();
  if (!dates.length) return '-';
  const runs: string[][] = [];
  for (const d of dates) {
    const run = runs[runs.length - 1];
    if (run && cal.isSchoolDay(d) && cal.nextSchoolDay(run[run.length - 1]) === d) run.push(d);
    else runs.push([d]);
  }
  const txt = runs.map((r) => (r.length === 1 ? fmtShort(r[0]) : `${fmtShort(r[0])}~${fmtShort(r[r.length - 1])}`)).join(', ');
  return dates.length > 1 ? `${txt} (${dates.length}일)` : txt;
}

export const studentLabel = (c: Pick<Case, 'grade' | 'classNo' | 'number' | 'name'>) => `${c.grade}-${c.classNo} ${c.number}번 ${c.name}`;

/** 목록에서 학년·반 선택용 */
export const classKey = (c: Pick<Case, 'grade' | 'classNo'>) => `${c.grade}-${c.classNo}`;
