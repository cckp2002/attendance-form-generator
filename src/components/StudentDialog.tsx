import type { Calendar } from '../lib/calendar';
import { fmtFull } from '../lib/dates';
import { shortPeriod } from '../lib/format';
import { DOC_LABEL, type Case, type RawRecord } from '../lib/types';
import { Modal } from './ui';

export function StudentDialog({ studentKey, cases, records, cal, onClose, onPreview, onEdit }: {
  studentKey: string;
  cases: Case[];
  records: RawRecord[];
  cal: Calendar;
  onClose: () => void;
  onPreview: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const mine = cases.filter((c) => c.studentKey === studentKey);
  const first = mine[0];
  const recs = records.filter((r) => `${r.grade}-${r.classNo}-${r.number}-${r.name}` === studentKey).sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.rowNo - b.rowNo);
  const caseOf = new Map<string, Case>();
  for (const c of mine) for (const id of c.recordIds) caseOf.set(id, c);
  return (
    <Modal wide title={first ? `${first.grade}학년 ${first.classNo}반 ${first.number}번 ${first.name} — 출결 기록` : '학생 기록'} onClose={onClose}>
      <h4 style={{ margin: '0 0 6px' }}>원본 엑셀 기록 ({recs.length}건)</h4>
      <div className="tablewrap">
        <table style={{ minWidth: 640 }}>
          <thead>
            <tr><th>일자</th><th>출결구분</th><th>결시교시</th><th>사유</th><th>파일·행</th><th>통합 결과</th></tr>
          </thead>
          <tbody>
            {recs.map((r) => {
              const c = caseOf.get(r.id);
              return (
                <tr key={r.id}>
                  <td>{r.dateRaw}</td>
                  <td>{r.category}</td>
                  <td className="small">{r.periodsRaw}</td>
                  <td>{r.reason}</td>
                  <td className="small muted">{r.sourceFile} · {r.rowNo}행</td>
                  <td className="small">{c ? `${c.docType ? DOC_LABEL[c.docType] : '분류 필요'}${c.entries.length > 1 ? ` (${c.entries.length}일 통합)` : ''}` : '수정됨'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h4 style={{ margin: '16px 0 6px' }}>통합 결과 — 확인서 {mine.length}건</h4>
      <div className="tablewrap">
        <table style={{ minWidth: 640 }}>
          <thead>
            <tr><th>확인서</th><th>출결구분</th><th>기간</th><th>사유</th><th>포함 날짜</th><th /></tr>
          </thead>
          <tbody>
            {mine.map((c) => (
              <tr key={c.id}>
                <td>{c.docType ? DOC_LABEL[c.docType] : '분류 필요'}</td>
                <td>{c.category}</td>
                <td>{shortPeriod(c.entries, cal)}</td>
                <td>{c.reason}</td>
                <td className="small">{c.entries.map((e) => fmtFull(e.dateISO)).join(' / ')}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => onPreview(c.id)}>미리보기</button>{' '}
                  <button className="btn sm" onClick={() => onEdit(c.id)}>수정</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
