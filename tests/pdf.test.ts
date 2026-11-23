import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildCalendar } from '../src/lib/calendar';
import { PdfEngine, formatPeriodText, fileNameFor, DEFAULT_SCHOOL } from '../src/lib/pdf/generate';
import type { Case, Settings } from '../src/lib/types';
import { extractPages, loadAssets, renderPng } from './helpers/pdfutil';

const settings: Settings = { schoolName: DEFAULT_SCHOOL, idFormat: 'text', useDefaultHolidays: true, holidays: [], holidayRanges: [], extraSchoolDays: [] };
const cal = buildCalendar(settings);
const OUT = process.env.PDF_OUT; // 시각 검토용 PNG 출력 폴더 (선택)

let n = 0;
function mk(p: Partial<Case>): Case {
  n++;
  return {
    id: `c${n}`, studentKey: 'k', grade: '1', classNo: '1', number: '23', name: '홍길동',
    category: '출석인정결석', docType: 'absence', reason: '독감',
    entries: [{ dateISO: '2026-10-29', periods: ['조회', '1교시'] }],
    recordIds: [], merged: false, manual: false, reviewed: false, autoFlags: [], ...p,
  };
}
const opts = { issueDateISO: '2026-11-03', schoolName: DEFAULT_SCHOOL, idFormat: 'text' as const, cal };

const cases: Record<string, Case> = {
  absence2: mk({ entries: [{ dateISO: '2026-10-29', periods: [] }, { dateISO: '2026-10-30', periods: [] }] }),
  absenceLong: mk({ category: '질병결석', reason: '고열과 기침 및 인후통으로 인한 병원 진료 및 가정 요양, 의사 소견에 따른 휴식', entries: [{ dateISO: '2026-10-23', periods: [] }, { dateISO: '2026-10-26', periods: [] }] }),
  early: mk({ docType: 'early', category: '출석인정조퇴', entries: [{ dateISO: '2026-10-21', periods: ['5교시', '6교시', '7교시', '종례'] }, { dateISO: '2026-10-22', periods: ['3교시', '4교시', '5교시', '6교시', '7교시', '종례'] }] }),
  late: mk({ docType: 'late', category: '질병지각', name: '김가상', number: '14', reason: '병원 진료', entries: [{ dateISO: '2026-10-26', periods: ['조회', '1교시', '2교시'] }] }),
  lateMany: mk({ docType: 'late', category: '미인정지각', reason: '늦잠', entries: ['2026-10-19', '2026-10-20', '2026-10-21'].map((d) => ({ dateISO: d, periods: ['조회', '1교시'] })) }),
  result: mk({ docType: 'result', category: '미인정결과', reason: '무단 이탈', entries: [{ dateISO: '2026-10-21', periods: ['3교시', '4교시'] }, { dateISO: '2026-10-22', periods: ['1교시', '3교시', '5교시'] }] }),
  earlyMany: mk({ docType: 'early', category: '질병조퇴', reason: '병원 진료', entries: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'].map((d) => ({ dateISO: d, periods: ['5교시', '6교시', '종례'] })) }),
};

describe('테스트 3: PDF 생성', () => {
  const engine = new PdfEngine(loadAssets());

  it('모든 유형 생성, 자리표시자/2025년 제거, 값 정확', async () => {
    const all = Object.values(cases);
    const r = await engine.build(all, opts);
    const pages = await extractPages(r.bytes);
    const joined = pages.join('\n');
    expect(joined).not.toMatch(/\{\{|\}\}/);
    expect(joined).not.toMatch(/2025/);
    expect(joined).toContain('2026년');
    const squeeze = (s: string) => s.replace(/\s+/g, '');
    // 결석: 기간/사유/종류 (상단 + 담임 확인서 모두)
    const p0 = squeeze(pages[0]);
    expect(p0).toContain('2026년10월29일~10월30일(2일)');
    expect((p0.match(/독감/g) ?? []).length).toBe(2);
    expect((p0.match(/출석인정결석/g) ?? []).length).toBe(2);
    expect(p0).toContain('1학년1반23번');
    // 지각: 마지막 결시교시(2교시)가 아니라 다음 교시(3교시)에 등교
    const late = pages.map(squeeze).find((p) => p.includes('김가상') && p.includes('지각'))!;
    expect(late).toContain('2026년10월26일3교시부터');
    // 조퇴 여러 날: 날짜별 개별 표시
    const early = pages.map(squeeze).find((p) => p.includes('2026년10월22일3교시부터'))!;
    expect(early).toContain('2026년10월21일5교시부터');
    // 결과: 불연속 교시
    expect(pages.map(squeeze).some((p) => p.includes('1교시,3교시,5교시'))).toBe(true);
    // 별지: earlyMany(7일 > 5) → 별지 페이지 생성
    expect(joined).toContain('별지');
    expect(r.pageCount).toBe(all.length + 1);

    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'all.pdf'), r.bytes);
      await renderPng(r.bytes, path.join(OUT, 'p'));
    }
  });

  it('학교명 변경 시 귀하 줄을 다시 작성', async () => {
    const r = await engine.build([cases.absence2], { ...opts, schoolName: '가나다중학교' });
    const t = (await extractPages(r.bytes))[0].replace(/\s+/g, '');
    expect(t).toContain('가나다중학교장귀하');
    expect(t).not.toContain('웅촌');
  });

  it('담임교사 이름이 모든 확인서에 반영됨 (비우면 공란)', async () => {
    const some = [cases.absence2, cases.early, cases.late, cases.result];
    const r = await engine.build(some, { ...opts, teacherName: '김담임' });
    const pages = (await extractPages(r.bytes)).map((p) => p.replace(/\s+/g, ''));
    expect(pages.every((p) => p.includes('김담임'))).toBe(true);
    if (OUT) await renderPng(r.bytes, path.join(OUT, 'teacher'));
    const r2 = await engine.build(some, opts);
    expect((await extractPages(r2.bytes)).join('')).not.toContain('김담임');
  });

  it('기간/파일명 표기', () => {
    expect(formatPeriodText(cases.absence2.entries, cal)).toBe('2026년 10월 29일 ~ 10월 30일 (2일)');
    expect(formatPeriodText(cases.absenceLong.entries, cal)).toBe('2026년 10월 23일 ~ 10월 26일 (2일)');
    expect(formatPeriodText([{ dateISO: '2026-12-30', periods: [] }, { dateISO: '2027-01-04', periods: [] }], cal)).toContain('2027년');
    expect(fileNameFor(cases.absence2)).toBe('1-1_홍길동_출석인정결석_20261029-20261030.pdf');
    expect(fileNameFor(cases.late)).toBe('1-1_김가상_질병지각_20261026.pdf');
  });
});
