import { useMemo, useState } from 'react';
import type { Calendar } from '../lib/calendar';
import { parseDateString } from '../lib/dates';
import { classKey, shortPeriod } from '../lib/format';
import { canMerge, computeFlags, hasError, needsReview } from '../lib/merge';
import { DOC_LABEL, DOC_ORDER, type Case, type DocType, type Flag, type RawRecord } from '../lib/types';
import { StatCards } from './SummaryStep';
import { DocBadge, FlagList } from './ui';

export function ReviewStep({ cases, records, cal, selected, setSelected, onEdit, onPreview, onStudent, onMerge, onSplit, onReviewed, onBack, onNext, onSettings }: {
  cases: Case[];
  records: RawRecord[];
  cal: Calendar;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onStudent: (key: string) => void;
  onMerge: (ids: string[]) => void;
  onSplit: (id: string) => void;
  onReviewed: (id: string, v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  onSettings: () => void;
}) {
  const [classSel, setClassSel] = useState('');
  const [q, setQ] = useState('');
  const [docSel, setDocSel] = useState<DocType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [mergeMsg, setMergeMsg] = useState('');

  const flags = useMemo(() => new Map<string, Flag[]>(cases.map((c) => [c.id, computeFlags(c, cal)])), [cases, cal]);
  const classes = useMemo(() => [...new Set(cases.map(classKey))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [cases]);

  const fromISO = parseDateString(from);
  const toISO = parseDateString(to);
  const rows = cases.filter((c) => {
    if (classSel && classKey(c) !== classSel) return false;
    if (q.trim() && !c.name.includes(q.trim()) && !c.reason.includes(q.trim())) return false;
    if (docSel && c.docType !== docSel) return false;
    if (fromISO && !c.entries.some((e) => e.dateISO >= fromISO)) return false;
    if (toISO && !c.entries.some((e) => e.dateISO <= toISO)) return false;
    if (onlyReview && !needsReview(c, flags.get(c.id)!)) return false;
    return true;
  });

  const allChecked = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const toggleAll = () => {
    const n = new Set(selected);
    if (allChecked) rows.forEach((c) => n.delete(c.id));
    else rows.forEach((c) => n.add(c.id));
    setSelected(n);
  };
  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const selCases = cases.filter((c) => selected.has(c.id));
  const errSel = selCases.filter((c) => hasError(flags.get(c.id)!));
  const reviewCount = cases.filter((c) => needsReview(c, flags.get(c.id)!)).length;

  const tryMerge = () => {
    const err = canMerge(selCases);
    if (err) return setMergeMsg(err);
    setMergeMsg('');
    onMerge(selCases.map((c) => c.id));
  };

  return (
    <div>
      <div className="card" style={{ paddingBottom: 8 }}>
        <h2>③ 통합 결과 검토</h2>
        <StatCards records={records} cases={cases} />
        <div className="filters">
          <label>학년·반
            <select value={classSel} onChange={(e) => setClassSel(e.target.value)} aria-label="학년 반 필터">
              <option value="">전체</option>
              {classes.map((k) => <option key={k} value={k}>{k.replace('-', '학년 ')}반</option>)}
            </select>
          </label>
          <label>출결 유형
            <select value={docSel} onChange={(e) => setDocSel(e.target.value as DocType | '')} aria-label="출결 유형 필터">
              <option value="">전체</option>
              {DOC_ORDER.map((d) => <option key={d} value={d}>{DOC_LABEL[d]}</option>)}
            </select>
          </label>
          <label>학생·사유 검색
            <input type="text" value={q} placeholder="이름 또는 사유" onChange={(e) => setQ(e.target.value)} aria-label="학생 이름 검색" style={{ width: 140 }} />
          </label>
          <label>기간
            <input type="text" value={from} placeholder="2026.10.01." onChange={(e) => setFrom(e.target.value)} aria-label="기간 시작" style={{ width: 120, borderColor: from && !fromISO ? 'var(--err)' : undefined }} />
            ~
            <input type="text" value={to} placeholder="2026.10.31." onChange={(e) => setTo(e.target.value)} aria-label="기간 끝" style={{ width: 120, borderColor: to && !toISO ? 'var(--err)' : undefined }} />
          </label>
          <label><input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> 검토 필요만 ({reviewCount})</label>
          <button className="btn sm" onClick={() => { setClassSel(''); setQ(''); setDocSel(''); setFrom(''); setTo(''); setOnlyReview(false); }}>필터 초기화</button>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn sm" onClick={onSettings}>휴업일 설정</button>
        </div>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th className="chk"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="전체 선택 또는 해제" /></th>
              <th>학생</th><th>출결구분</th><th>기간</th><th>사유</th><th>확인서</th><th>상태</th><th>작업</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const f = flags.get(c.id)!;
              const err = hasError(f);
              const rev = needsReview(c, f);
              return (
                <tr key={c.id} className={`${err ? 'flag-error' : rev ? 'flag-warn' : ''}${selected.has(c.id) ? ' sel' : ''}`}>
                  <td className="chk"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`${c.name} 선택`} /></td>
                  <td>
                    <button className="btn link" onClick={() => onStudent(c.studentKey)} title="원본 기록과 통합 결과 보기">{c.name}</button>
                    <div className="muted small">{c.grade}학년 {c.classNo}반 {c.number}번</div>
                  </td>
                  <td>{c.category}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {shortPeriod(c.entries, cal)}
                    {c.merged && <div><span className="badge info">{c.manual ? '수동 통합' : '자동 통합'} {c.entries.length}일</span></div>}
                  </td>
                  <td>{c.reason || <span className="muted">(없음)</span>}</td>
                  <td><DocBadge doc={c.docType} /></td>
                  <td style={{ minWidth: 200 }}>
                    {err ? <span className="badge err">필수 확인</span> : rev ? <span className="badge warn">검토 필요</span> : <span className="badge ok">이상 없음</span>}
                    <FlagList flags={f} hideInfo={!err && !rev} />
                    {!err && f.some((x) => x.level === 'warn') && (
                      <label className="small" style={{ display: 'block', marginTop: 2 }}>
                        <input type="checkbox" checked={c.reviewed} onChange={(e) => onReviewed(c.id, e.target.checked)} /> 확인함
                      </label>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => onPreview(c.id)} disabled={!c.docType}>미리보기</button>{' '}
                    <button className="btn sm" onClick={() => onEdit(c.id)}>수정</button>
                    {c.entries.length > 1 && <> <button className="btn sm" onClick={() => onSplit(c.id)} title="날짜별로 분리">분리</button></>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 28 }}>조건에 맞는 기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {mergeMsg && <div className="notice err">{mergeMsg}</div>}
      {errSel.length > 0 && <div className="notice err">선택한 항목 중 <b>필수 확인</b> 상태인 {errSel.length}건은 수정한 뒤에야 출력할 수 있습니다.</div>}

      <div className="actionbar no-print">
        <span className="info">선택 {selCases.length}건 / 전체 {cases.length}건</span>
        <button className="btn" onClick={onBack}>← 분석 요약</button>
        <button className="btn" onClick={tryMerge} disabled={selCases.length < 2} title="같은 학생·같은 출결구분의 기록을 하나의 확인서로 합칩니다">선택 항목 수동 통합</button>
        <button className="btn primary" onClick={onNext} disabled={!selCases.length}>확인서 생성·출력 →</button>
      </div>
    </div>
  );
}
