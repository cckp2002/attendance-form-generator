import type { Settings } from './types';

/**
 * 브라우저에 저장하는 것은 "설정"뿐입니다 (학교명, 휴업일 등).
 * 학생 이름·학번·출결 사유 등 개인정보는 어디에도 저장하지 않습니다.
 */
const KEY = 'attendance-form-settings-v1';

export const DEFAULT_SETTINGS: Settings = {
  schoolName: '웅촌중학교',
  teacherName: '',
  idFormat: 'text',
  useDefaultHolidays: true,
  holidays: [],
  holidayRanges: [],
  extraSchoolDays: [],
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      schoolName: typeof p.schoolName === 'string' && p.schoolName.trim() ? p.schoolName : DEFAULT_SETTINGS.schoolName,
      teacherName: typeof p.teacherName === 'string' ? p.teacherName : '',
      idFormat: p.idFormat === 'digits' ? 'digits' : 'text',
      useDefaultHolidays: p.useDefaultHolidays !== false,
      holidays: Array.isArray(p.holidays) ? p.holidays.filter((x) => typeof x === 'string') : [],
      holidayRanges: Array.isArray(p.holidayRanges)
        ? p.holidayRanges.filter((r): r is [string, string] => Array.isArray(r) && r.length === 2)
        : [],
      extraSchoolDays: Array.isArray(p.extraSchoolDays) ? p.extraSchoolDays.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장이 막혀 있어도 사용에는 문제 없음 */
  }
}
