import { useMemo, useState } from 'react';
import type { Calendar } from '../lib/calendar';
import { shortPeriod } from '../lib/format';
import { computeFlags, hasError } from '../lib/merge';
import type { PdfEngine, PdfOptions } from '../lib/pdf/generate';
import { fileNameFor, resolveDates } from '../lib/pdf/generate';
import { todayISO } from '../lib/dates';
import { DOC_LABEL, type Case } from '../lib/types';
import { PdfView } from './PdfView';
import { DocBadge } from './ui';

export interface OutputActions {
  busy: string;
  download: (cases: Case[], name: string) => void;
  zip: (cases: Case[], byStudent: boolean) => void;
  print: (cases: Case[]) => void;
}

export function OutputStep({ cases, selectedIds, cal, engine, opts, issueDate, setIssueDate, actions, onBack, onSettings, schoolName, teacherName, setTeacherName, attachment, setAttachment, setCaseAttachment, setCaseIssueDate, setCaseConfirmDate, onEditCase }: {
  setCaseIssueDate: (id: string, iso: string) => void;
  setCaseConfirmDate: (id: string, iso: string) => void;
  onEditCase: (id: string) => void;
  setCaseAttachment: (id: string, text: string) => void;
  attachment: string;
  setAttachment: (t: string) => void;
  cases: Case[];
  selectedIds: Set<string>;
  cal: Calendar;
  engine: PdfEngine | null;
  opts: PdfOptions;
  issueDate: string;
  setIssueDate: (s: string) => void;
  actions: OutputActions;
  onBack: () => void;
  onSettings: () => void;
  schoolName: string;
  teacherName: string;
  setTeacherName: (t: string) => void;
}) {
  const selected = cases.filter((c) => selectedIds.has(c.id));
  const usable = selected.filter((c) => !hasError(computeFlags(c, cal)));
  const blocked = selected.length - usable.length;
  const [idx, setIdx] = useState(0);
  const cur = usable[Math.min(idx, usable.length - 1)];
  const one = useMemo(() => (cur ? [cur] : []), [cur]);
  const all = cases.filter((c) => !hasError(computeFlags(c, cal)));
  const busy = !!actions.busy;
  const curDates = cur ? resolveDates(cur, opts) : null;

  return (
    <div>
      <div className="card">
        <h2>④ 확인서 생성 및 출력</h2>
        <div className="row">
          <label className="row">
            <input type="checkbox" checked={!issueDate} onChange={(e) => setIssueDate(e.target.checked ? '' : todayISO())} aria-label="작성일 자동 설정" />
            작성일 자동 (출결 다음 등교일)
          </label>
          {issueDate && (
            <label className="row">공통 작성일
              <input type="date" value={issueDate} onChange={(e) => e.target.value && setIssueDate(e.target.value)} aria-label="서류 작성일" />
            </label>
          )}
          <label className="row">담임교사
            <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="이름 입력" aria-label="담임교사 이름" style={{ width: 120 }} />
          </label>
          <span className="muted small">기본값: 작성일은 마지막 출결일 다음 등교일(주말·공휴일 제외), 결석 신고서의 담임확인서 날짜는 그 다음 등교일입니다. 서명란은 비워 둡니다.</span>
          <span style={{ flex: 1 }} />
          <span className="muted small">{schoolName}</span>
          <button className="btn sm" onClick={onSettings}>양식·학교 설정</button>
        </div>
        {usable.some((c) => c.docType === 'absence') && (
          <label className="row" style={{ marginTop: 10 }}>결석 신고서 첨부
            <input type="text" value={attachment} onChange={(e) => setAttachment(e.target.value)} placeholder="모든 결석 신고서에 같이 쓸 첨부 (학생마다 다르면 아래 미리보기에서 개별 입력)" aria-label="결석 신고서 첨부 내용" style={{ flex: 1, minWidth: 260 }} />
          </label>
        )}
        {blocked > 0 && <div className="notice err">필수 확인 상태인 {blocked}건은 출력 대상에서 제외됩니다. 검토 화면에서 수정해 주세요.</div>}
      </div>

      <div className="split">
        <div>
          <div className="muted small" style={{ marginBottom: 4 }}>출력 대상 {usable.length}건 — 눌러서 미리보기</div>
          <div className="doclist" role="listbox" aria-label="출력 대상 목록">
            {usable.map((c, i) => (
              <button key={c.id} className={c === cur ? 'active' : ''} onClick={() => setIdx(i)} role="option" aria-selected={c === cur}>
                <b>{c.name}</b> <span className="muted small">{c.grade}-{c.classNo} {c.number}번</span> <DocBadge doc={c.docType} />
                <div className="small muted">{c.category} · {shortPeriod(c.entries, cal)}</div>
              </button>
            ))}
            {!usable.length && <div className="muted" style={{ padding: 16 }}>출력할 확인서가 없습니다. 이전 단계에서 항목을 선택하세요.</div>}
          </div>
        </div>
        <div>
          {cur ? (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <b>{DOC_LABEL[cur.docType!]}</b>
                <span className="muted small">{fileNameFor(cur)}</span>
                <span style={{ flex: 1 }} />
                <button className="btn sm" disabled={idx <= 0} onClick={() => setIdx(idx - 1)}>◀ 이전</button>
                <button className="btn sm" disabled={idx >= usable.length - 1} onClick={() => setIdx(idx + 1)}>다음 ▶</button>
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                <b>{cur.docType === 'absence' ? '신고서 작성일' : '작성일'}</b>
                <input type="date" value={curDates!.issue} onChange={(e) => e.target.value && setCaseIssueDate(cur.id, e.target.value)} aria-label={`${cur.name} 작성일`} />
                {cur.docType === 'absence' && (
                  <>
                    <b>담임확인서 날짜</b>
                    <input type="date" value={curDates!.confirm} onChange={(e) => e.target.value && setCaseConfirmDate(cur.id, e.target.value)} aria-label={`${cur.name} 담임확인서 날짜`} />
                  </>
                )}
                {(cur.issueDate || cur.confirmDate)
                  ? <button className="btn sm" onClick={() => { setCaseIssueDate(cur.id, ''); setCaseConfirmDate(cur.id, ''); }}>기본 날짜로 되돌리기</button>
                  : <span className="muted small">{issueDate ? '공통 작성일 사용 중' : '자동 설정 (출결 다음 등교일)'}</span>}
                <button className="btn sm" onClick={() => onEditCase(cur.id)} title="출결 날짜·교시·사유 수정">출결 날짜 수정</button>
              </div>
              {cur.docType === 'absence' && (
                <label className="row" style={{ marginBottom: 8 }}>
                  <b>이 학생 첨부</b>
                  <input type="text" value={cur.attachment ?? ''} onChange={(e) => setCaseAttachment(cur.id, e.target.value)}
                    placeholder={attachment ? `비우면 공통 첨부 사용: ${attachment}` : '예: 진료확인서 1부 (이 학생에게만 적용)'}
                    aria-label={`${cur.name} 첨부 내용`} style={{ flex: 1, minWidth: 220 }} />
                </label>
              )}
              <PdfView engine={engine} cases={one} opts={opts} />
            </>
          ) : <div className="card muted">미리볼 확인서가 없습니다.</div>}
        </div>
      </div>

      <div className="actionbar no-print">
        <span className="info">{actions.busy ? <><span className="spinner" /> {actions.busy}</> : `출력 대상 ${usable.length}건`}</span>
        <button className="btn" onClick={onBack}>← 검토로 돌아가기</button>
        <button className="btn" disabled={busy || !cur} onClick={() => actions.download([cur], fileNameFor(cur))}>이 확인서 PDF</button>
        <button className="btn" disabled={busy || !usable.length} onClick={() => actions.download(usable, '출결확인서_선택항목.pdf')}>선택 항목 통합 PDF</button>
        <button className="btn" disabled={busy || !all.length} onClick={() => actions.download(all, '출결확인서_전체.pdf')}>전체 통합 PDF</button>
        <button className="btn" disabled={busy || !usable.length} onClick={() => actions.zip(usable, false)}>개별 PDF ZIP</button>
        <button className="btn" disabled={busy || !usable.length} onClick={() => actions.zip(usable, true)}>학생별 폴더 ZIP</button>
        <button className="btn navy" disabled={busy || !usable.length} onClick={() => actions.print(usable)}>🖨 인쇄</button>
      </div>
    </div>
  );
}
