import { useState } from 'react';
import type { Calendar } from '../lib/calendar';
import { classifyCategory } from '../lib/classify';
import { parseDateString } from '../lib/dates';
import { deriveEarlyStart, deriveLateArrival, parsePeriods, sortPeriods } from '../lib/periods';
import { DOC_LABEL, DOC_ORDER, DOC_SHORT, type Case, type DocType } from '../lib/types';
import { Modal } from './ui';

const KINDS = ['질병', '출석인정', '미인정', '기타'];
const CATEGORY_OPTIONS = DOC_ORDER.flatMap((d) => KINDS.map((k) => `${k}${DOC_SHORT[d]}`));

interface Row {
  date: string; // 사용자가 보는 날짜 문자열 (2026.10.21. 또는 2026-10-21)
  periods: string;
  override: string;
}

const toDisplay = (iso: string) => iso.replace(/-/g, '.') + '.';

export function EditDialog({ c, cal, onSave, onSplit, onClose }: { c: Case; cal: Calendar; onSave: (n: Case) => void; onSplit: () => void; onClose: () => void }) {
  const [category, setCategory] = useState(c.category);
  const [docChoice, setDocChoice] = useState<DocType | ''>(c.docType ?? '');
  const [reason, setReason] = useState(c.reason);
  const [attachment, setAttachment] = useState(c.attachment ?? '');
  const [rows, setRows] = useState<Row[]>(c.entries.map((e) => ({ date: toDisplay(e.dateISO), periods: e.periods.join(','), override: e.periodOverride ?? '' })));
  const [err, setErr] = useState('');

  const auto = classifyCategory(category).docType;
  const doc: DocType | null = auto ?? (docChoice || null);
  const options = CATEGORY_OPTIONS.includes(category) ? CATEGORY_OPTIONS : [category, ...CATEGORY_OPTIONS];

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const hint = (r: Row) => {
    const e = { dateISO: '', periods: parsePeriods(r.periods) };
    if (doc === 'early') return deriveEarlyStart(e).label ?? '입력 필요';
    if (doc === 'late') return deriveLateArrival(e).label ?? '입력 필요';
    return '';
  };

  const save = () => {
    if (!rows.length) return setErr('날짜를 한 개 이상 입력하세요.');
    const entries = [];
    for (const r of rows) {
      const iso = parseDateString(r.date);
      if (!iso) return setErr(`날짜 형식을 확인하세요: "${r.date}" (예: 2026.10.21.)`);
      entries.push({ dateISO: iso, periods: sortPeriods(parsePeriods(r.periods)), ...(r.override.trim() ? { periodOverride: r.override.trim() } : {}) });
    }
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.dateISO)) return setErr(`같은 날짜가 두 번 입력되었습니다: ${e.dateISO}`);
      seen.add(e.dateISO);
    }
    entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    onSave({ ...c, category: category.replace(/\s+/g, ''), docType: doc, reason: reason.replace(/\s+/g, ' ').trim(), attachment: attachment.trim() || undefined, entries, merged: entries.length > 1, manual: true, reviewed: false });
  };

  const showOverride = doc === 'early' || doc === 'late';
  return (
    <Modal
      title={`기록 수정 — ${c.grade}학년 ${c.classNo}반 ${c.number}번 ${c.name}`}
      onClose={onClose}
      footer={
        <>
          {c.entries.length > 1 && <button className="btn" onClick={onSplit} title="날짜별로 확인서를 따로 만듭니다">자동 통합 해제(날짜별 분리)</button>}
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save}>저장</button>
        </>
      }
    >
      <div className="formgrid">
        <label>출결 종류</label>
        <div className="row">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="출결 종류">
            {options.map((o) => (
              <option key={o} value={o}>{o}{o === c.category && !CATEGORY_OPTIONS.includes(o) ? ' (원본)' : ''}</option>
            ))}
          </select>
          {!auto && (
            <>
              <span className="badge err">자동 분류 불가</span>
              <select value={docChoice} onChange={(e) => setDocChoice(e.target.value as DocType | '')} aria-label="확인서 종류">
                <option value="">확인서 종류 선택…</option>
                {DOC_ORDER.map((d) => (
                  <option key={d} value={d}>{DOC_LABEL[d]}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <label>사유</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 독감" aria-label="사유" />
        {doc === 'absence' && (
          <>
            <label>첨부</label>
            <input type="text" value={attachment} onChange={(e) => setAttachment(e.target.value)} placeholder="이 신고서만 다르게 쓸 첨부 내용 (비우면 출력 화면의 공통 첨부)" aria-label="첨부" />
          </>
        )}
        <label>날짜·결시교시</label>
        <div>
          <table className="entries" style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>날짜</th>
                <th>결시교시 (쉼표로 구분)</th>
                {showOverride && <th>{doc === 'early' ? '조퇴 시작 교시' : '등교 교시'} (직접 입력)</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const iso = parseDateString(r.date);
                return (
                  <tr key={i}>
                    <td style={{ width: 150 }}>
                      <input type="text" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} aria-label="날짜" style={{ borderColor: r.date && !iso ? 'var(--err)' : undefined }} />
                      {iso && !cal.isSchoolDay(iso) && <div className="small" style={{ color: 'var(--warn)' }}>주말/휴업일</div>}
                    </td>
                    <td><input type="text" value={r.periods} onChange={(e) => setRow(i, { periods: e.target.value })} placeholder="조회,1교시,2교시" aria-label="결시교시" /></td>
                    {showOverride && (
                      <td style={{ width: 180 }}>
                        <input type="text" value={r.override} onChange={(e) => setRow(i, { override: e.target.value })} placeholder={`자동: ${hint(r)}`} aria-label="직접 입력 교시" />
                      </td>
                    )}
                    <td style={{ width: 60 }}>
                      <button className="btn sm danger" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label="이 날짜 삭제">삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setRows([...rows, { date: '', periods: '', override: '' }])}>+ 날짜 추가</button>
        </div>
      </div>
      {doc === 'late' && <p className="muted small">지각 확인서는 "마지막 결시교시의 다음 교시"를 등교 교시로 자동 추정합니다. 실제 등교 교시가 다르면 직접 입력하세요.</p>}
      {doc === 'early' && <p className="muted small">조퇴 확인서는 결시교시 중 가장 이른 교시를 시작 교시로 사용합니다. 다르면 직접 입력하세요.</p>}
      {err && <div className="notice err">{err}</div>}
    </Modal>
  );
}
