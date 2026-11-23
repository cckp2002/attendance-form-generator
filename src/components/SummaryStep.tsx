import { computeFlags, hasError } from '../lib/merge';
import type { Calendar } from '../lib/calendar';
import { DOC_LABEL, DOC_ORDER, type Case, type ParseIssue, type RawRecord } from '../lib/types';

export function computeStats(records: RawRecord[], cases: Case[]) {
  const byDoc = { absence: 0, early: 0, late: 0, result: 0 };
  let unclassified = 0;
  for (const c of cases) {
    if (c.docType) byDoc[c.docType]++;
    else unclassified++;
  }
  const autoMerged = cases.filter((c) => c.merged && !c.manual);
  return {
    total: records.length,
    docs: cases.length,
    mergedGroups: autoMerged.length,
    mergedRecords: autoMerged.reduce((a, c) => a + c.recordIds.length, 0),
    byDoc,
    unclassified,
  };
}

export function StatCards({ records, cases }: { records: RawRecord[]; cases: Case[] }) {
  const s = computeStats(records, cases);
  const cards: [string, number | string, string, boolean][] = [
    ['전체 출결 기록', s.total, '엑셀에서 읽은 행', false],
    ['자동 통합된 출결', s.mergedGroups, s.mergedGroups ? `기록 ${s.mergedRecords}건 → ${s.mergedGroups}건` : '통합된 건 없음', true],
    ['결석 신고서', s.byDoc.absence, '', false],
    ['조퇴 확인서', s.byDoc.early, '', false],
    ['지각 확인서', s.byDoc.late, '', false],
    ['결과 확인서', s.byDoc.result, '', false],
  ];
  return (
    <div className="stats">
      {cards.map(([l, v, sub, teal]) => (
        <div className={`stat${teal ? ' teal' : ''}`} key={l}>
          <div className="v">{v}</div>
          <div className="l">{l}</div>
          {sub && <div className="sub">{sub}</div>}
        </div>
      ))}
      {s.unclassified > 0 && (
        <div className="stat" style={{ borderTopColor: 'var(--err)' }}>
          <div className="v" style={{ color: 'var(--err)' }}>{s.unclassified}</div>
          <div className="l">분류 필요</div>
        </div>
      )}
    </div>
  );
}

export function SummaryStep({ records, cases, issues, cal, onNext, onBack, onSettings }: {
  records: RawRecord[];
  cases: Case[];
  issues: ParseIssue[];
  cal: Calendar;
  onNext: () => void;
  onBack: () => void;
  onSettings: () => void;
}) {
  const s = computeStats(records, cases);
  const flagged = cases.filter((c) => hasError(computeFlags(c, cal)) || computeFlags(c, cal).some((f) => f.level === 'warn'));
  const gaps = cases.filter((c) => c.autoFlags.some((f) => f.code === 'gap'));
  return (
    <div>
      <div className="card">
        <h2>② 출결 분석 결과</h2>
        <StatCards records={records} cases={cases} />
        <p style={{ margin: 0 }}>
          엑셀의 출결 기록 <b>{s.total}건</b>을 학생·출결구분·사유·연속 등교일 기준으로 정리해 <b>확인서 {s.docs}건</b>으로 만들었습니다.
          {s.mergedGroups > 0 && <> 연속된 기록 {s.mergedRecords}건이 {s.mergedGroups}건으로 자동 통합되었습니다.</>}
        </p>
        {DOC_ORDER.some((d) => s.byDoc[d]) && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {DOC_ORDER.filter((d) => s.byDoc[d]).map((d) => `${DOC_LABEL[d]} ${s.byDoc[d]}건`).join(' · ')}
          </p>
        )}
      </div>

      {issues.length > 0 && (
        <div className="notice err">
          <b>읽지 못한 행 {issues.length}건</b> — 이 행들은 확인서에 포함되지 않았습니다. 엑셀을 고친 뒤 다시 올려 주세요.
          <ul>
            {issues.slice(0, 20).map((i, k) => <li key={k}>{i.sourceFile} · {i.rowNo}행: {i.message}</li>)}
            {issues.length > 20 && <li>…외 {issues.length - 20}건</li>}
          </ul>
        </div>
      )}
      {s.unclassified > 0 && <div className="notice err"><b>분류할 수 없는 출결구분 {s.unclassified}건</b> — 다음 단계에서 확인서 종류를 직접 선택해야 출력할 수 있습니다.</div>}
      {gaps.length > 0 && (
        <div className="notice warn">
          <b>휴업일 확인이 필요한 기록 {gaps.length}건</b> — 사유·구분이 같은 기록 사이에 등교일이 끼어 있어 통합하지 않았습니다.
          해당 날이 공휴일·재량휴업일이라면 <button className="btn link" onClick={onSettings}>휴업일 설정</button>에 추가하면 자동으로 다시 통합됩니다.
        </div>
      )}
      {flagged.length > 0 && <div className="notice info">검토가 필요한 기록 {flagged.length}건이 있습니다. 다음 화면에서 노란색·붉은색으로 표시됩니다.</div>}

      <div className="row">
        <button className="btn" onClick={onBack}>← 엑셀 다시 올리기</button>
        <button className="btn primary" onClick={onNext} disabled={!cases.length}>통합 결과 검토하기 →</button>
      </div>
    </div>
  );
}
