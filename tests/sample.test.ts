import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildCalendar } from '../src/lib/calendar';
import { buildCases } from '../src/lib/merge';
import { PdfEngine, DEFAULT_SCHOOL } from '../src/lib/pdf/generate';
import { sampleRecords } from '../src/lib/sample';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { extractPages, loadAssets, renderPng } from './helpers/pdfutil';

describe('예시 데이터', () => {
  const cal = buildCalendar(DEFAULT_SETTINGS);
  const cases = buildCases(sampleRecords(), cal);
  it('연속 기록이 통합되고 첨부 내용이 반영됨', async () => {
    expect(cases.length).toBe(6);
    expect(cases.map((c) => c.entries.length).sort()).toEqual([2, 2, 3, 3, 5, 7]);
    const r = await new PdfEngine(loadAssets()).build(cases, { issueDateISO: '2026-11-09', schoolName: DEFAULT_SCHOOL, idFormat: 'text', cal, attachment: '진료확인서 1부' });
    const pages = (await extractPages(r.bytes)).map((p) => p.replace(/\s+/g, ''));
    expect(pages.filter((p) => p.includes('진료확인서1부')).length).toBe(1); // 결석 신고서 1건
    // 학생별 작성일: 한 건만 다른 날짜
    const abs = cases.find((c) => c.docType === 'absence')!;
    const other = cases.find((c) => c.docType === 'late')!;
    const one = { ...abs, issueDate: '2026-12-24', confirmDate: '2026-12-28' };
    const r2 = await new PdfEngine(loadAssets()).build([one, other], { issueDateISO: '2026-11-09', schoolName: DEFAULT_SCHOOL, idFormat: 'text', cal });
    const t = (await extractPages(r2.bytes)).map((p) => p.replace(/\s+/g, ''));
    expect(t[0]).toContain('2026년1224'); // 신고서 날짜
    expect(t[0]).toContain('2026년1228'); // 담임확인서 날짜
    expect(t[1]).toContain('2026년119'); // 다른 학생은 공통 작성일
    if (process.env.PDF_OUT) await renderPng(r.bytes, path.join(process.env.PDF_OUT, 's'));
  });
});

describe('기본 작성일 자동 설정', () => {
  const cal2 = buildCalendar(DEFAULT_SETTINGS);
  const base = { issueDate: undefined, confirmDate: undefined };
  it('마지막 출결일 다음 등교일, 담임확인서는 그 다음 등교일 (주말·공휴일 제외)', async () => {
    const { resolveDates } = await import('../src/lib/pdf/generate');
    // 금요일(10/23) 결석 → 월요일(10/26) / 화요일(10/27)
    expect(resolveDates({ ...base, entries: [{ dateISO: '2026-10-22', periods: [] }, { dateISO: '2026-10-23', periods: [] }] }, { issueDateISO: '', cal: cal2 })).toEqual({ issue: '2026-10-26', confirm: '2026-10-27' });
    // 10/2(금) 출결 → 10/5·10/9 공휴일 고려: 다음 등교일 10/6, 확인 10/7
    expect(resolveDates({ ...base, entries: [{ dateISO: '2026-10-02', periods: [] }] }, { issueDateISO: '', cal: cal2 })).toEqual({ issue: '2026-10-06', confirm: '2026-10-07' });
    // 공통 작성일을 직접 지정하면 그 값, 담임확인서는 그 다음 등교일
    expect(resolveDates({ ...base, entries: [{ dateISO: '2026-10-22', periods: [] }] }, { issueDateISO: '2026-11-06', cal: cal2 })).toEqual({ issue: '2026-11-06', confirm: '2026-11-09' });
  });
});
