/** 날짜 문자열 파싱 / 포맷 유틸 (모두 로컬 시간 기준, 타임존 오차 방지를 위해 UTC 계산) */

export function parseDateString(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(일)?\.?$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return validISO(y, mo, d);
}

export function validISO(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return toISO(dt);
}

export function toISO(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function weekday(iso: string): number {
  return fromISO(iso).getUTCDay(); // 0=일
}

export const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function todayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** 2026년 10월 21일 */
export function fmtFull(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${y}년 ${m}월 ${d}일`;
}
/** 10월 21일 (같은 해일 때 연도 생략용) */
export function fmtMD(iso: string): string {
  const { m, d } = parts(iso);
  return `${m}월 ${d}일`;
}
/** 10.21. */
export function fmtShort(iso: string): string {
  const { m, d } = parts(iso);
  return `${m}.${d}.`;
}
/** 20261021 */
export function fmtCompact(iso: string): string {
  return iso.replace(/-/g, '');
}
