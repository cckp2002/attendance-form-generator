import type { DayEntry, DocType } from './types';

export function parsePeriods(raw: string): string[] {
  return raw
    .split(/[,，、\n]+/)
    .map((p) => p.replace(/\s+/g, '').trim())
    .filter(Boolean);
}

/** 조회=0, N교시=N, 종례=99, 그 외=null */
export function periodKey(p: string): number | null {
  if (p === '조회') return 0;
  if (p === '종례') return 99;
  const m = p.match(/^(\d+)교시$/);
  return m ? +m[1] : null;
}

export function sortPeriods(periods: string[]): string[] {
  return [...new Set(periods)].sort((a, b) => (periodKey(a) ?? 50) - (periodKey(b) ?? 50));
}

/** 3교시,4교시,5교시 → "3~5교시", 조회,1교시 → "조회, 1교시" */
export function formatPeriods(periods: string[]): string {
  const sorted = sortPeriods(periods);
  const out: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(run.length === 1 ? `${run[0]}교시` : `${run[0]}~${run[run.length - 1]}교시`);
    run = [];
  };
  for (const p of sorted) {
    const k = periodKey(p);
    if (k !== null && k > 0 && k < 99) {
      if (run.length && k !== run[run.length - 1] + 1) flush();
      run.push(k);
    } else {
      flush();
      out.push(p);
    }
  }
  flush();
  return out.join(', ');
}

export interface Derived {
  /** 문서에 표시할 교시 문구 (예: "5교시") — null이면 교사 입력 필요 */
  label: string | null;
  estimated: boolean;
  note?: string;
}

/** 조퇴: 결시교시 중 가장 이른 교시를 시작 교시로 사용 */
export function deriveEarlyStart(e: DayEntry): Derived {
  if (e.periodOverride?.trim()) return { label: e.periodOverride.trim(), estimated: false };
  const sorted = sortPeriods(e.periods).filter((p) => periodKey(p) !== null);
  if (!sorted.length) return { label: null, estimated: true, note: '결시교시가 없어 조퇴 시작 교시를 알 수 없습니다' };
  const first = sorted[0];
  const k = periodKey(first)!;
  if (k <= 1) {
    return { label: first, estimated: true, note: `조퇴 시작이 ${first}입니다 (결석과 구분되는지 확인)` };
  }
  return { label: first, estimated: true, note: `결시교시 중 첫 교시(${first})를 조퇴 시작 교시로 사용` };
}

/** 지각: 마지막 결시교시의 "다음" 교시를 등교 교시로 추정 (마지막 결시교시와 혼동 금지) */
export function deriveLateArrival(e: DayEntry): Derived {
  if (e.periodOverride?.trim()) return { label: e.periodOverride.trim(), estimated: false };
  const sorted = sortPeriods(e.periods).filter((p) => periodKey(p) !== null);
  if (!sorted.length) return { label: null, estimated: true, note: '결시교시가 없어 등교 교시를 알 수 없습니다' };
  if (sorted.includes('종례')) return { label: null, estimated: true, note: '결시교시에 종례가 포함되어 등교 교시를 추정할 수 없습니다' };
  const nums = sorted.map((p) => periodKey(p)!);
  const last = Math.max(...nums);
  const lastLabel = sorted[sorted.length - 1];
  const next = last === 0 ? 1 : last + 1;
  const label = next > 7 ? '종례' : `${next}교시`;
  return { label, estimated: true, note: `마지막 결시교시(${lastLabel}) 다음인 ${label}에 등교한 것으로 추정` };
}

export function entryPeriodText(doc: DocType, e: DayEntry): string {
  if (doc === 'early') return deriveEarlyStart(e).label ?? '(교시 입력 필요)';
  if (doc === 'late') return deriveLateArrival(e).label ?? '(교시 입력 필요)';
  return formatPeriods(e.periods);
}
