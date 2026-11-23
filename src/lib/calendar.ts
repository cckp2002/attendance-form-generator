import { addDays, fromISO, weekday } from './dates';
import { DEFAULT_HOLIDAYS } from './holidays';
import type { Settings } from './types';

export interface Calendar {
  isSchoolDay(iso: string): boolean;
  /** iso 다음의 등교일 */
  nextSchoolDay(iso: string): string;
  /** a와 b 사이(양 끝 제외)의 등교일 목록 */
  schoolDaysBetween(a: string, b: string): string[];
}

export function buildCalendar(
  s: Pick<Settings, 'holidays' | 'holidayRanges' | 'extraSchoolDays' | 'useDefaultHolidays'>,
): Calendar {
  const off = new Set<string>(s.holidays);
  if (s.useDefaultHolidays) DEFAULT_HOLIDAYS.forEach((h) => off.add(h));
  const extra = new Set(s.extraSchoolDays);
  const ranges = s.holidayRanges
    .filter(([a, b]) => a && b)
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [string, string]);

  const isSchoolDay = (iso: string) => {
    if (extra.has(iso)) return true;
    const w = weekday(iso);
    if (w === 0 || w === 6) return false;
    if (off.has(iso)) return false;
    return !ranges.some(([a, b]) => iso >= a && iso <= b);
  };

  const nextSchoolDay = (iso: string) => {
    let d = iso;
    for (let i = 0; i < 400; i++) {
      d = addDays(d, 1);
      if (isSchoolDay(d)) return d;
    }
    return d;
  };

  const schoolDaysBetween = (a: string, b: string) => {
    const out: string[] = [];
    if (fromISO(b) <= fromISO(a)) return out;
    let d = addDays(a, 1);
    for (let i = 0; i < 800 && d < b; i++, d = addDays(d, 1)) if (isSchoolDay(d)) out.push(d);
    return out;
  };

  return { isSchoolDay, nextSchoolDay, schoolDaysBetween };
}
