import ExcelJS from 'exceljs';
import { parseDateString, toISO, validISO } from './dates';
import { parsePeriods } from './periods';
import type { ParseIssue, RawRecord } from './types';

export interface ParsedFile {
  records: RawRecord[];
  issues: ParseIssue[];
  /** 파일 안에서 인식한 시트 수 */
  sheets: number;
}

/** 파일명에서 학년/반 추정: "1학년 1반 ...", "1-1", "1학년1반" */
export function guessGradeClass(fileName: string): { grade: string; classNo: string } | null {
  const a = fileName.match(/(\d)\s*학년\s*(\d{1,2})\s*반/);
  if (a) return { grade: a[1], classNo: String(+a[2]) };
  const b = fileName.match(/(?:^|[^\d])(\d)\s*[-_]\s*(\d{1,2})(?:[^\d]|$)/);
  if (b) return { grade: b[1], classNo: String(+b[2]) };
  return null;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return toISO(v).replace(/-/g, '.') + '.';
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('').trim();
  if ('result' in o) return cellToString(o.result as ExcelJS.CellValue);
  if (typeof o.text === 'string') return o.text.trim();
  return '';
}

const HEAD = { date: '일자', number: '번호', name: '성명', category: '출결구분', periods: '결시교시', reason: '사유' };
type HeadKey = keyof typeof HEAD;

export async function parseWorkbook(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  grade: string,
  classNo: string,
  idPrefix: string = fileName,
): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const records: RawRecord[] = [];
  const issues: ParseIssue[] = [];
  let sheets = 0;

  for (const ws of wb.worksheets) {
    // 헤더 행 찾기 (앞 10행 안에서 '일자'+'성명'이 있는 행)
    let headerRow = -1;
    const col: Partial<Record<HeadKey, number>> = {};
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const map: Partial<Record<HeadKey, number>> = {};
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const t = cellToString(cell.value).replace(/\s+/g, '');
        for (const k of Object.keys(HEAD) as HeadKey[]) if (t === HEAD[k]) map[k] = c;
      });
      if (map.date && map.name) {
        headerRow = r;
        Object.assign(col, map);
        break;
      }
    }
    if (headerRow < 0) continue;
    sheets++;
    const need: HeadKey[] = ['date', 'number', 'name', 'category'];
    const missing = need.filter((k) => !col[k]);
    if (missing.length) {
      issues.push({ sourceFile: fileName, rowNo: headerRow, message: `필수 열을 찾을 수 없습니다: ${missing.map((k) => HEAD[k]).join(', ')}` });
      continue;
    }

    const val = (row: ExcelJS.Row, k: HeadKey) => (col[k] ? row.getCell(col[k]!).value : null);

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      // 병합 셀: ExcelJS는 병합 영역 안의 셀에 병합 대표 셀의 값을 돌려준다.
      // 병합 영역 밖의 빈칸은 그대로 비어 있게 두고 오류로 보고한다(이전 학생 정보로 채우지 않음).
      const dv = val(row, 'date');
      let dateISO: string | null = null;
      let dateRaw = '';
      if (dv instanceof Date) {
        dateISO = validISO(dv.getUTCFullYear(), dv.getUTCMonth() + 1, dv.getUTCDate());
        dateRaw = cellToString(dv);
      } else {
        dateRaw = cellToString(dv);
        dateISO = dateRaw ? parseDateString(dateRaw) : null;
      }
      const number = cellToString(val(row, 'number')).replace(/\.0+$/, '');
      const name = cellToString(val(row, 'name'));
      const category = cellToString(val(row, 'category')).replace(/\s+/g, '');
      const periodsRaw = cellToString(val(row, 'periods'));
      const reason = cellToString(val(row, 'reason'));

      if (!dateRaw && !number && !name && !category && !periodsRaw && !reason) continue;

      const problems: string[] = [];
      if (!dateRaw) problems.push('일자가 비어 있습니다');
      else if (!dateISO) problems.push(`일자 형식을 해석할 수 없습니다 ("${dateRaw}")`);
      if (!number) problems.push('번호가 비어 있습니다 (병합되지 않은 빈 칸)');
      else if (!/^\d+$/.test(number)) problems.push(`번호가 숫자가 아닙니다 ("${number}")`);
      if (!name) problems.push('성명이 비어 있습니다 (병합되지 않은 빈 칸)');
      if (!category) problems.push('출결구분이 비어 있습니다');
      if (problems.length) {
        issues.push({ sourceFile: fileName, rowNo: r, message: problems.join(' / ') });
        continue;
      }
      records.push({
        id: `${idPrefix}#${ws.name}#${r}`,
        sourceFile: fileName,
        rowNo: r,
        grade,
        classNo,
        dateISO: dateISO!,
        dateRaw,
        number: String(+number),
        name,
        category,
        periodsRaw,
        periods: parsePeriods(periodsRaw),
        reason,
      });
    }
  }
  return { records, issues, sheets };
}
