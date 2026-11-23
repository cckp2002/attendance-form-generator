import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseWorkbook, guessGradeClass } from '../src/lib/excel';
import { buildCalendar } from '../src/lib/calendar';
import { buildCases, resetCaseIds, canMerge, mergeCases, splitCase, computeFlags } from '../src/lib/merge';
import { classifyCategory, euro } from '../src/lib/classify';
import type { RawRecord, Settings } from '../src/lib/types';

const baseSettings: Settings = {
  schoolName: '웅촌중학교',
  idFormat: 'text',
  useDefaultHolidays: true,
  holidays: [],
  holidayRanges: [],
  extraSchoolDays: [],
};
const cal = buildCalendar(baseSettings);

let n = 0;
function rec(p: Partial<RawRecord> & { dateISO: string }): RawRecord {
  n++;
  return {
    id: `r${n}`,
    sourceFile: 'f.xlsx',
    rowNo: n,
    grade: '1',
    classNo: '1',
    dateRaw: p.dateISO,
    number: '5',
    name: '홍길동',
    category: '질병결석',
    periodsRaw: '',
    periods: ['조회', '1교시', '2교시', '종례'],
    reason: '독감',
    ...p,
  };
}

beforeEach(() => resetCaseIds());

const privateXlsx = path.resolve(__dirname, '../private-test/1학년 1반 월별 출결 현황.xlsx');
describe.skipIf(!fs.existsSync(privateXlsx))('테스트 1: 실제 엑셀 분석 (비공개 테스트 파일)', () => {
  it('13건 → 11건, 병합 셀 학생 정보 정확', async () => {
    const buf = fs.readFileSync(privateXlsx);
    const g = guessGradeClass('1학년 1반 월별 출결 현황.xlsx')!;
    expect(g).toEqual({ grade: '1', classNo: '1' });
    const parsed = await parseWorkbook(new Uint8Array(buf), 'a.xlsx', g.grade, g.classNo);
    expect(parsed.issues).toEqual([]);
    expect(parsed.records.length).toBe(13);
    // 병합 셀(B11:B14)의 행들은 모두 같은 학생
    const merged = parsed.records.filter((r) => r.rowNo >= 11 && r.rowNo <= 14);
    expect(new Set(merged.map((r) => `${r.number}${r.name}`)).size).toBe(1);

    const cases = buildCases(parsed.records, cal);
    expect(cases.length).toBe(11);
    const multi = cases.filter((c) => c.entries.length > 1);
    expect(multi.length).toBe(2);
    expect(multi.map((c) => c.entries.map((e) => e.dateISO)).sort()).toEqual([
      ['2026-10-22', '2026-10-23'],
      ['2026-10-29', '2026-10-30'],
    ]);
    // 10/28 조퇴와 10/29~30 결석은 별개
    const s = cases.filter((c) => c.name === parsed.records[7].name && c.reason === '독감');
    expect(s.map((c) => c.docType).sort()).toEqual(['absence', 'early']);
    // 결석계 4: 질병결석/출석인정결석 서로 다른 유형은 절대 통합 안 됨
    const docs = cases.reduce<Record<string, number>>((a, c) => ((a[c.docType!] = (a[c.docType!] ?? 0) + 1), a), {});
    expect(docs).toEqual({ absence: 8, early: 2, late: 1 });
    // 지각 등교교시 추정: 조회,1교시,2교시 → 3교시
    const late = cases.find((c) => c.docType === 'late')!;
    expect(computeFlags(late, cal).some((f) => f.code === 'late-est')).toBe(true);
  });
});

describe('분류', () => {
  it('출결구분을 문서 종류와 세부 종류로 분리', () => {
    expect(classifyCategory('질병결석')).toEqual({ docType: 'absence', kind: '질병' });
    expect(classifyCategory('출석인정조퇴')).toEqual({ docType: 'early', kind: '출석인정' });
    expect(classifyCategory('질병지각')).toEqual({ docType: 'late', kind: '질병' });
    expect(classifyCategory('미인정결과')).toEqual({ docType: 'result', kind: '미인정' });
    expect(classifyCategory('이상한값').docType).toBeNull();
    expect(classifyCategory('결석').docType).toBeNull();
  });
  it('조사 로/으로', () => {
    expect(euro('독감')).toBe('으로');
    expect(euro('감기')).toBe('로');
    expect(euro('몸살')).toBe('로'); // ㄹ받침
    expect(euro('체험학습 참가')).toBe('로');
  });
});

describe('테스트 2: 통합 규칙', () => {
  it('같은 학생·사유·연속 결석 → 1건', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-21' }), rec({ dateISO: '2026-10-22' }), rec({ dateISO: '2026-10-23' })], cal);
    expect(cs.length).toBe(1);
    expect(cs[0].entries.length).toBe(3);
  });
  it('같은 학생·다른 사유 → 분리', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-21' }), rec({ dateISO: '2026-10-22', reason: '감기' })], cal);
    expect(cs.length).toBe(2);
  });
  it('사유의 앞뒤/연속 공백은 같은 사유로 취급', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-21', reason: ' 체험학습  참가' }), rec({ dateISO: '2026-10-22', reason: '체험학습 참가 ' })], cal);
    expect(cs.length).toBe(1);
  });
  it('같은 사유라도 출결 유형이 다르면 분리 (질병결석 vs 출석인정결석, 조퇴 vs 결석)', () => {
    const cs = buildCases(
      [
        rec({ dateISO: '2026-10-28', category: '출석인정조퇴' }),
        rec({ dateISO: '2026-10-29', category: '출석인정결석' }),
        rec({ dateISO: '2026-10-30', category: '출석인정결석' }),
        rec({ dateISO: '2026-11-02', category: '질병결석' }),
        rec({ dateISO: '2026-11-03', category: '출석인정결석' }),
      ],
      cal,
    );
    expect(cs.length).toBe(4);
  });
  it('금요일 → 월요일은 연속', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-23' }), rec({ dateISO: '2026-10-26' })], cal);
    expect(cs.length).toBe(1);
  });
  it('공휴일(10/5 대체공휴일)을 사이에 둔 출결: 기본 공휴일 → 통합', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-02' }), rec({ dateISO: '2026-10-06' })], cal);
    expect(cs.length).toBe(1);
  });
  it('휴업일 미등록이면 통합하지 않고 안내 표시, 등록하면 통합', () => {
    const noDef = buildCalendar({ ...baseSettings, useDefaultHolidays: false });
    const cs = buildCases([rec({ dateISO: '2026-10-02' }), rec({ dateISO: '2026-10-06' })], noDef);
    expect(cs.length).toBe(2);
    expect(cs[1].autoFlags.some((f) => f.code === 'gap')).toBe(true);
    const withDay = buildCalendar({ ...baseSettings, useDefaultHolidays: false, holidays: ['2026-10-05'] });
    expect(buildCases([rec({ dateISO: '2026-10-02' }), rec({ dateISO: '2026-10-06' })], withDay).length).toBe(1);
  });
  it('재량휴업일 범위(방학)', () => {
    const c2 = buildCalendar({ ...baseSettings, holidayRanges: [['2026-12-24', '2026-12-31']] });
    expect(buildCases([rec({ dateISO: '2026-12-23' }), rec({ dateISO: '2027-01-01' })], c2).length).toBe(1); // 방학 다음 첫 등교일
    expect(buildCases([rec({ dateISO: '2026-12-23' }), rec({ dateISO: '2027-01-04' })], c2).length).toBe(2); // 1/1 등교일을 건너뜀
    const c3 = buildCalendar({ ...baseSettings, holidayRanges: [['2026-12-24', '2027-01-03']] });
    expect(buildCases([rec({ dateISO: '2026-12-23' }), rec({ dateISO: '2027-01-04' })], c3).length).toBe(1);
  });
  it('정상 등교일이 중간에 있으면 통합하지 않음', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-21' }), rec({ dateISO: '2026-10-23' })], cal);
    expect(cs.length).toBe(2);
  });
  it('월이 바뀌는 연속 출결', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-30' }), rec({ dateISO: '2026-11-02' }), rec({ dateISO: '2026-11-03' })], cal);
    expect(cs.length).toBe(1);
    expect(cs[0].entries.length).toBe(3);
  });
  it('수업 있는 토요일은 등교일로 지정 가능', () => {
    const c = buildCalendar({ ...baseSettings, extraSchoolDays: ['2026-10-24'] });
    expect(buildCases([rec({ dateISO: '2026-10-23' }), rec({ dateISO: '2026-10-24' }), rec({ dateISO: '2026-10-26' })], c).length).toBe(1);
    expect(buildCases([rec({ dateISO: '2026-10-23' }), rec({ dateISO: '2026-10-26' })], c).length).toBe(2); // 토요일(등교일)에 기록 없음
  });
  it('여러 파일에 중복 입력된 출결은 1건', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-21', sourceFile: 'a' }), rec({ dateISO: '2026-10-21', sourceFile: 'b' })], cal);
    expect(cs.length).toBe(1);
    expect(cs[0].entries.length).toBe(1);
    expect(cs[0].autoFlags.some((f) => f.code === 'dup')).toBe(true);
  });
  it('동일 이름이지만 학년·반·번호가 다른 학생은 통합 금지', () => {
    const cs = buildCases(
      [
        rec({ dateISO: '2026-10-21' }),
        rec({ dateISO: '2026-10-22', classNo: '2' }),
        rec({ dateISO: '2026-10-22', number: '6', classNo: '1' }),
        rec({ dateISO: '2026-10-22', grade: '2' }),
      ],
      cal,
    );
    expect(cs.length).toBe(4);
  });
  it('수동 통합은 같은 학생·같은 구분만, 분리 가능', () => {
    const cs = buildCases([rec({ dateISO: '2026-10-21' }), rec({ dateISO: '2026-10-22', reason: '감기' }), rec({ dateISO: '2026-10-22', name: '타인', number: '9' })], cal);
    expect(canMerge([cs[0], cs[1]])).toBeNull();
    expect(canMerge(cs)).toMatch(/다른 학생/);
    const m = mergeCases([cs[0], cs[1]]);
    expect(m.entries.length).toBe(2);
    expect(splitCase(m).length).toBe(2);
  });
});
