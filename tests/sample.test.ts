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
    if (process.env.PDF_OUT) await renderPng(r.bytes, path.join(process.env.PDF_OUT, 's'));
  });
});
