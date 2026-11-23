import { Fragment, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_HOLIDAYS } from '../lib/holidays';
import { fmtFull, parseDateString } from '../lib/dates';
import { cleanTemplatePage } from '../lib/pdf/clean';
import { SPECS } from '../lib/pdf/spec';
import type { CustomTemplates } from '../lib/runtime';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { DOC_LABEL, DOC_ORDER, type DocType, type Settings } from '../lib/types';
import { Modal } from './ui';

type Tab = 'school' | 'holiday' | 'template';

export function SettingsDialog({ settings, custom, onSave, onCustom, onClose, initialTab = 'school' }: {
  settings: Settings;
  custom: CustomTemplates | null;
  onSave: (s: Settings) => void;
  onCustom: (c: CustomTemplates | null) => void;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [s, setS] = useState<Settings>(settings);
  const [newHoliday, setNewHoliday] = useState('');
  const [rangeA, setRangeA] = useState('');
  const [rangeB, setRangeB] = useState('');
  const [extra, setExtra] = useState('');
  const [msg, setMsg] = useState('');

  const addDate = (key: 'holidays' | 'extraSchoolDays', v: string, reset: () => void) => {
    const iso = parseDateString(v) ?? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    if (!iso) return setMsg('날짜 형식을 확인하세요. 예: 2026.10.05. 또는 2026-10-05');
    setMsg('');
    setS((p) => ({ ...p, [key]: [...new Set([...p[key], iso])].sort() }));
    reset();
  };

  // ── 양식 교체 ──
  const [tplMsg, setTplMsg] = useState<{ level: 'err' | 'ok'; text: string } | null>(null);
  const [pending, setPending] = useState<{ kind: 'absence' | 'combo'; bytes: Uint8Array; pages: number; name: string; pageSel: Partial<Record<DocType, number>> } | null>(null);

  const onPickTemplate = async (kind: 'absence' | 'combo', file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFDocument.load(bytes);
      const pages = doc.getPageCount();
      const sel: Partial<Record<DocType, number>> = {};
      for (const d of DOC_ORDER) if ((kind === 'absence') === (d === 'absence')) sel[d] = Math.min(SPECS[d].page, pages - 1);
      setPending({ kind, bytes, pages, name: file.name, pageSel: sel });
      setTplMsg(null);
    } catch {
      setTplMsg({ level: 'err', text: '올바른 PDF 파일이 아닙니다.' });
    }
  };

  const applyTemplate = async () => {
    if (!pending) return;
    // 기본 양식과 같은 배치인지 시험 적용 (글자 위치를 찾지 못하면 거부)
    for (const d of DOC_ORDER) {
      const p = pending.pageSel[d];
      if (p === undefined) continue;
      try {
        const r = await cleanTemplatePage(pending.bytes, p, SPECS[d].erase);
        if (r.unmatched.length) {
          setTplMsg({ level: 'err', text: `${DOC_LABEL[d]}: 선택한 페이지가 기본 양식과 배치가 달라 자동 작성할 수 없습니다. (현재는 기본 양식과 같은 배치의 PDF만 지원합니다)` });
          return;
        }
      } catch (e) {
        setTplMsg({ level: 'err', text: `${DOC_LABEL[d]}: ${e instanceof Error ? e.message : '페이지를 읽을 수 없습니다.'}` });
        return;
      }
    }
    const next: CustomTemplates = {
      ...(custom ?? { version: '' }),
      [pending.kind]: pending.bytes,
      pages: { ...(custom?.pages ?? {}), ...pending.pageSel },
      version: `custom-${Date.now()}`,
    };
    onCustom(next);
    setPending(null);
    setTplMsg({ level: 'ok', text: `"${pending.name}" 양식을 적용했습니다. (이 브라우저 창에서만 유지됩니다)` });
  };

  return (
    <Modal
      title="설정"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn primary" onClick={() => { onSave(s); onClose(); }}>설정 저장</button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 14 }} role="tablist">
        {([['school', '학교·표기'], ['holiday', '휴업일'], ['template', 'PDF 양식']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' navy' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'school' && (
        <div className="formgrid">
          <label>학교명</label>
          <div>
            <input type="text" value={s.schoolName} onChange={(e) => setS({ ...s, schoolName: e.target.value })} aria-label="학교명" />
            <div className="muted small">기본값은 웅촌중학교입니다. 바꾸면 "○○중학교장 귀하" 줄이 새 학교명으로 작성됩니다.</div>
          </div>
          <label>담임교사</label>
          <div>
            <input type="text" value={s.teacherName ?? ''} onChange={(e) => setS({ ...s, teacherName: e.target.value })} aria-label="담임교사 이름" />
            <div className="muted small">확인서의 "담임 :" 옆에 인쇄됩니다. 비워 두면 공란입니다. (출력 화면에서도 입력할 수 있습니다)</div>
          </div>
          <label>학번 표기</label>
          <select value={s.idFormat} onChange={(e) => setS({ ...s, idFormat: e.target.value as Settings['idFormat'] })} aria-label="학번 표기">
            <option value="text">1학년 1반 7번</option>
            <option value="digits">10107 (학년·반 2자리·번호 2자리)</option>
          </select>
          <label>저장되는 정보</label>
          <div className="muted small">이 설정(학교명 등)만 이 브라우저에 저장됩니다. 학생 이름·사유 등 출결 자료는 저장되지 않습니다.</div>
        </div>
      )}

      {tab === 'holiday' && (
        <div>
          <div className="notice info small">
            연속 출결을 하나의 확인서로 묶을 때 "연속된 등교일"인지 판단하는 기준입니다. 토·일요일은 자동으로 쉬는 날입니다.
            휴업일을 사이에 둔 출결은 연속으로 보고, 등교일을 건너뛴 출결은 묶지 않습니다. <b>설정을 바꾸면 분석 결과가 다시 계산됩니다.</b>
          </div>
          <label className="row" style={{ margin: '10px 0' }}>
            <input type="checkbox" checked={s.useDefaultHolidays} onChange={(e) => setS({ ...s, useDefaultHolidays: e.target.checked })} />
            <span>기본 공휴일 사용 (2025~2026년 {DEFAULT_HOLIDAYS.length}일, 대체공휴일 포함)</span>
          </label>

          <h4 style={{ margin: '14px 0 4px' }}>재량휴업일·임시공휴일 (하루씩)</h4>
          <div className="row">
            <input type="text" placeholder="2026.10.12." value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="휴업일 날짜" />
            <button className="btn" onClick={() => addDate('holidays', newHoliday, () => setNewHoliday(''))}>추가</button>
          </div>
          <div className="chips">
            {s.holidays.map((h) => (
              <span className="chip" key={h}>{fmtFull(h)} <button aria-label={`${h} 삭제`} onClick={() => setS({ ...s, holidays: s.holidays.filter((x) => x !== h) })}>×</button></span>
            ))}
            {!s.holidays.length && <span className="muted small">추가한 날이 없습니다.</span>}
          </div>

          <h4 style={{ margin: '14px 0 4px' }}>방학 등 기간</h4>
          <div className="row">
            <input type="text" placeholder="시작 2026.12.24." value={rangeA} onChange={(e) => setRangeA(e.target.value)} aria-label="기간 시작" />
            <span>~</span>
            <input type="text" placeholder="끝 2027.02.28." value={rangeB} onChange={(e) => setRangeB(e.target.value)} aria-label="기간 끝" />
            <button className="btn" onClick={() => {
              const a = parseDateString(rangeA), b = parseDateString(rangeB);
              if (!a || !b) return setMsg('기간의 날짜 형식을 확인하세요. 예: 2026.12.24.');
              setMsg('');
              setS({ ...s, holidayRanges: [...s.holidayRanges, a <= b ? [a, b] : [b, a]] });
              setRangeA(''); setRangeB('');
            }}>추가</button>
          </div>
          <div className="chips">
            {s.holidayRanges.map(([a, b], i) => (
              <span className="chip" key={i}>{fmtFull(a)} ~ {fmtFull(b)} <button aria-label="기간 삭제" onClick={() => setS({ ...s, holidayRanges: s.holidayRanges.filter((_, k) => k !== i) })}>×</button></span>
            ))}
          </div>

          <h4 style={{ margin: '14px 0 4px' }}>수업이 있는 토요일·일요일 (등교일로 지정)</h4>
          <div className="row">
            <input type="text" placeholder="2026.10.24." value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="등교일 날짜" />
            <button className="btn" onClick={() => addDate('extraSchoolDays', extra, () => setExtra(''))}>추가</button>
          </div>
          <div className="chips">
            {s.extraSchoolDays.map((h) => (
              <span className="chip" key={h}>{fmtFull(h)} <button aria-label={`${h} 삭제`} onClick={() => setS({ ...s, extraSchoolDays: s.extraSchoolDays.filter((x) => x !== h) })}>×</button></span>
            ))}
          </div>
          {msg && <div className="notice err">{msg}</div>}
          <div style={{ marginTop: 12 }}>
            <button className="btn sm" onClick={() => setS({ ...DEFAULT_SETTINGS, schoolName: s.schoolName, idFormat: s.idFormat })}>휴업일 설정 초기화</button>
          </div>
        </div>
      )}

      {tab === 'template' && (
        <div>
          <div className="notice info small">
            현재 사용 중인 양식: <b>{custom ? '사용자가 올린 양식' : '기본 양식 (웅촌중학교 결석 신고서 / 조퇴·지각·결과 확인서)'}</b>
            <br />새 양식을 올려도 <b>기본 양식과 같은 글자 위치(자리표시자 배치)</b>일 때만 자동 작성됩니다. 배치가 다른 양식은 거부되며,
            글자 위치를 직접 지정하는 기능은 다음 단계 개발 항목입니다. 올린 양식은 이 브라우저 창에만 보관되고 서버로 전송되지 않습니다.
          </div>
          <div className="formgrid" style={{ marginTop: 10 }}>
            <label>결석 신고서</label>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => onPickTemplate('absence', e.target.files?.[0])} aria-label="결석 신고서 PDF 선택" />
            <label>조퇴·지각·결과</label>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => onPickTemplate('combo', e.target.files?.[0])} aria-label="조퇴 지각 결과 확인서 PDF 선택" />
          </div>
          {pending && (
            <div className="card" style={{ marginTop: 12 }}>
              <b>{pending.name}</b> <span className="muted small">({pending.pages}쪽) — 각 확인서에 사용할 페이지를 고르세요</span>
              <div className="formgrid" style={{ marginTop: 8 }}>
                {DOC_ORDER.filter((d) => pending.pageSel[d] !== undefined).map((d) => (
                  <Fragment key={d}>
                    <label>{DOC_LABEL[d]}</label>
                    <select value={pending.pageSel[d]} onChange={(e) => setPending({ ...pending, pageSel: { ...pending.pageSel, [d]: +e.target.value } })}>
                      {Array.from({ length: pending.pages }, (_, i) => <option key={i} value={i}>{i + 1}페이지</option>)}
                    </select>
                  </Fragment>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={applyTemplate}>이 양식 적용</button>
                <button className="btn" onClick={() => setPending(null)}>취소</button>
              </div>
            </div>
          )}
          {tplMsg && <div className={`notice ${tplMsg.level}`}>{tplMsg.text}</div>}
          {custom && <button className="btn" style={{ marginTop: 10 }} onClick={() => { onCustom(null); setTplMsg({ level: 'ok', text: '기본 양식으로 되돌렸습니다.' }); }}>기본 양식으로 복원</button>}
        </div>
      )}
    </Modal>
  );
}
