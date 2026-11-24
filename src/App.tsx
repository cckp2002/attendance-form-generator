import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditDialog } from './components/EditDialog';
import { OutputStep, type OutputActions } from './components/OutputStep';
import { PreviewDialog } from './components/PreviewDialog';
import { ReviewStep } from './components/ReviewStep';
import { SettingsDialog } from './components/SettingsDialog';
import { StudentDialog } from './components/StudentDialog';
import { SummaryStep } from './components/SummaryStep';
import { UploadStep, type UploadedFile } from './components/UploadStep';
import { buildCalendar } from './lib/calendar';
import { todayISO } from './lib/dates';
import { parseWorkbook } from './lib/excel';
import { buildCases, mergeCases, resetCaseIds, splitCase } from './lib/merge';
import type { PdfEngine, PdfOptions } from './lib/pdf/generate';
import { buildZip, downloadBlob, makeEngine, printPdf, type CustomTemplates } from './lib/runtime';
import { sampleRecords } from './lib/sample';
import { loadSettings, saveSettings } from './lib/settings';
import type { Case, ParseIssue, RawRecord, Settings } from './lib/types';

type Notice = { level: 'err' | 'warn' | 'ok'; text: string } | null;

const STEPS = [
  ['엑셀 업로드', '파일 선택'],
  ['출결 분석', '자동 분류·통합'],
  ['통합 결과 검토', '확인·수정'],
  ['확인서 생성·출력', 'PDF·ZIP·인쇄'],
] as const;

const calKey = (s: Settings) => JSON.stringify([s.holidays, s.holidayRanges, s.extraSchoolDays, s.useDefaultHolidays]);

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const cal = useMemo(() => buildCalendar(settings), [settings]);
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [records, setRecords] = useState<RawRecord[]>([]);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issueDate, setIssueDate] = useState(''); // '' = 출결 다음 등교일로 자동
  const [attachment, setAttachment] = useState(''); // 저장하지 않음 (출력할 때마다 입력)
  const [busy, setBusy] = useState(false);
  const [outBusy, setOutBusy] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [custom, setCustom] = useState<CustomTemplates | null>(null);
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [studentKey, setStudentKey] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'school' | 'holiday' | 'template' | null>(null);

  useEffect(() => {
    let alive = true;
    makeEngine(custom).then((e) => alive && setEngine(e)).catch((e) => alive && setNotice({ level: 'err', text: `글꼴·양식 파일을 불러오지 못했습니다: ${e.message}` }));
    return () => {
      alive = false;
    };
  }, [custom]);

  const opts: PdfOptions = useMemo(() => ({ issueDateISO: issueDate, schoolName: settings.schoolName, teacherName: settings.teacherName, attachment, idFormat: settings.idFormat, cal }), [issueDate, attachment, settings.schoolName, settings.teacherName, settings.idFormat, cal]);

  // ── 분석 ──
  const analyze = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const allRecs: RawRecord[] = [];
      const allIssues: ParseIssue[] = [];
      const updated: UploadedFile[] = [];
      for (const f of files) {
        try {
          const r = await parseWorkbook(f.data, f.name, f.grade, f.classNo, f.id);
          if (r.sheets === 0) {
            updated.push({ ...f, error: '출결 현황 형식을 찾지 못했습니다. (일자·번호·성명·출결구분·결시교시·사유 제목이 있는 엑셀이어야 합니다)', count: 0 });
            continue;
          }
          allRecs.push(...r.records);
          allIssues.push(...r.issues);
          updated.push({ ...f, error: undefined, count: r.records.length });
        } catch {
          updated.push({ ...f, error: '파일을 읽을 수 없습니다. 손상되었거나 암호가 걸린 파일일 수 있습니다.', count: 0 });
        }
      }
      setFiles(updated);
      if (!allRecs.length) {
        setNotice({ level: 'err', text: allIssues.length ? '읽을 수 있는 출결 기록이 없습니다. 오류 내용을 확인해 주세요.' : '엑셀에서 출결 기록을 찾지 못했습니다. 파일 형식과 내용을 확인해 주세요.' });
        setIssues(allIssues);
        return;
      }
      resetCaseIds();
      const cs = buildCases(allRecs, cal);
      setRecords(allRecs);
      setIssues(allIssues);
      setCases(cs);
      setSelected(new Set(cs.map((c) => c.id)));
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  // ── 예시 데이터로 체험 (가상 학생, 엑셀 없이) ──
  const loadSample = () => {
    const recs = sampleRecords();
    resetCaseIds();
    const cs = buildCases(recs, cal);
    setFiles([]); setRecords(recs); setIssues([]); setCases(cs);
    setSelected(new Set(cs.map((c) => c.id)));
    setNotice({ level: 'ok', text: '가상 학생의 예시 데이터를 불러왔습니다. 실제 학생 정보가 아닙니다.' });
    setStep(3);
  };

  // ── 설정 저장 (휴업일이 바뀌면 통합 결과를 다시 계산) ──
  const onSaveSettings = (s: Settings) => {
    const calChanged = calKey(s) !== calKey(settings);
    if (calChanged && records.length) {
      if (cases.some((c) => c.manual) && !window.confirm('휴업일 설정이 바뀌어 통합 결과를 다시 계산합니다.\n직접 수정·통합·분리한 내용은 사라집니다. 계속할까요?')) return;
      resetCaseIds();
      const cs = buildCases(records, buildCalendar(s));
      setCases(cs);
      setSelected(new Set(cs.map((c) => c.id)));
      setNotice({ level: 'ok', text: '휴업일 설정을 반영해 통합 결과를 다시 계산했습니다.' });
    }
    setSettings(s);
    saveSettings(s);
  };

  const reset = () => {
    if (!window.confirm('올린 엑셀과 분석·수정 내용, 미리보기가 모두 지워집니다. 초기화할까요?')) return;
    setFiles([]); setRecords([]); setIssues([]); setCases([]); setSelected(new Set());
    setEditId(null); setPreviewId(null); setStudentKey(null); setNotice(null); setStep(1);
    resetCaseIds();
  };

  // ── 기록 수정 ──
  const replaceCase = (n: Case) => setCases((cs) => cs.map((c) => (c.id === n.id ? n : c)));
  const doSplit = (id: string) => {
    const c = cases.find((x) => x.id === id);
    if (!c) return;
    const parts = splitCase(c);
    setCases((cs) => cs.flatMap((x) => (x.id === id ? parts : [x])));
    setSelected((s) => {
      const n = new Set(s);
      if (n.delete(id)) parts.forEach((p) => n.add(p.id));
      return n;
    });
  };
  const doMerge = (ids: string[]) => {
    const list = cases.filter((c) => ids.includes(c.id));
    const m = mergeCases(list);
    setCases((cs) => {
      const first = cs.findIndex((c) => ids.includes(c.id));
      const rest = cs.filter((c) => !ids.includes(c.id));
      rest.splice(Math.max(first, 0), 0, m);
      return rest;
    });
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((i) => n.delete(i));
      n.add(m.id);
      return n;
    });
  };

  // ── 출력 ──
  const run = useCallback(async (label: string, job: () => Promise<void>) => {
    setOutBusy(label);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setNotice({ level: 'err', text: `PDF를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setOutBusy('');
    }
  }, []);

  const actions: OutputActions = {
    busy: outBusy,
    download: (list, name) =>
      run('PDF를 만드는 중…', async () => {
        const r = await engine!.build(list, opts);
        downloadBlob(r.bytes, name);
        if (r.warnings.length) setNotice({ level: 'warn', text: r.warnings.map((w) => w.message).join(' / ') });
      }),
    zip: (list, byStudent) =>
      run('ZIP을 만드는 중…', async () => {
        const bytes = await buildZip(engine!, list, opts, byStudent, (n, t) => setOutBusy(`PDF 생성 ${n}/${t}`));
        downloadBlob(bytes, byStudent ? '출결확인서_학생별.zip' : '출결확인서_개별PDF.zip', 'application/zip');
      }),
    print: (list) =>
      run('인쇄용 PDF를 만드는 중…', async () => {
        const r = await engine!.build(list, opts);
        printPdf(r.bytes);
      }),
  };

  const maxStep = cases.length ? 4 : 1;
  const edit = cases.find((c) => c.id === editId) ?? null;
  const preview = cases.find((c) => c.id === previewId) ?? null;

  return (
    <div className="app">
      <header className="topbar no-print">
        <h1>출결 확인서 자동작성 시스템</h1>
        <span className="meta">
          {settings.schoolName}
          {cases.length > 0 && files.length > 0 && ` · ${[...new Set(files.filter((f) => f.count).map((f) => `${f.grade}학년 ${f.classNo}반`))].join(', ')}`}
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setSettingsTab('template')}>PDF 양식 설정</button>
        <button className="btn sm" onClick={() => setSettingsTab('holiday')}>휴업일 설정</button>
        <button className="btn sm" onClick={() => setSettingsTab('school')}>학교·표기</button>
        <button className="btn sm danger" onClick={reset}>작업 초기화</button>
      </header>
      <div className="privacy no-print">🔒 모든 출결 자료는 현재 브라우저에서만 처리됩니다.</div>

      <nav className="stepper no-print" aria-label="작업 단계">
        {STEPS.map(([t, s], i) => {
          const n = i + 1;
          return (
            <button key={n} className={`step${step === n ? ' active' : ''}${step > n ? ' done' : ''}`} disabled={n > maxStep} onClick={() => setStep(n)} aria-current={step === n ? 'step' : undefined}>
              <span className="n">{step > n ? '✓' : n}</span>
              <span><div className="t">{t}</div><div className="s">{s}</div></span>
            </button>
          );
        })}
      </nav>

      <main className="main">
        {notice && (
          <div className={`notice ${notice.level}`} role="alert">
            {notice.text} <button className="btn link" onClick={() => setNotice(null)}>닫기</button>
          </div>
        )}
        {step === 1 && <UploadStep files={files} setFiles={setFiles} onAnalyze={analyze} busy={busy} hasResult={cases.length > 0} onGoReview={() => setStep(3)} onSample={loadSample} />}
        {step === 2 && <SummaryStep records={records} cases={cases} issues={issues} cal={cal} onBack={() => setStep(1)} onNext={() => setStep(3)} onSettings={() => setSettingsTab('holiday')} />}
        {step === 3 && (
          <ReviewStep
            cases={cases} records={records} cal={cal} selected={selected} setSelected={setSelected}
            onEdit={setEditId} onPreview={setPreviewId} onStudent={setStudentKey}
            onMerge={doMerge} onSplit={doSplit}
            onReviewed={(id, v) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, reviewed: v } : c)))}
            onBack={() => setStep(2)} onNext={() => setStep(4)} onSettings={() => setSettingsTab('holiday')}
          />
        )}
        {step === 4 && (
          <OutputStep
            cases={cases} selectedIds={selected} cal={cal} engine={engine} opts={opts}
            issueDate={issueDate} setIssueDate={setIssueDate} actions={actions}
            onBack={() => setStep(3)} onSettings={() => setSettingsTab('template')} schoolName={settings.schoolName}
            attachment={attachment} setAttachment={setAttachment}
            onEditCase={setEditId}
            setCaseConfirmDate={(id, iso) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, confirmDate: iso || undefined } : c)))}
            setCaseIssueDate={(id, iso) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, issueDate: iso || undefined } : c)))}
            setCaseAttachment={(id, t) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, attachment: t || undefined } : c)))}
            teacherName={settings.teacherName ?? ''}
            setTeacherName={(t) => { const s = { ...settings, teacherName: t }; setSettings(s); saveSettings(s); }}
          />
        )}
      </main>
      <footer className="site no-print">출결 자료는 서버로 전송되거나 저장되지 않습니다. 브라우저 창을 닫거나 새로 고치면 작업 내용이 사라집니다.</footer>

      {edit && (
        <EditDialog key={edit.id} c={edit} cal={cal} onClose={() => setEditId(null)}
          onSave={(n) => { replaceCase(n); setEditId(null); }}
          onSplit={() => { doSplit(edit.id); setEditId(null); }} />
      )}
      {preview && preview.docType && (
        <PreviewDialog c={preview} engine={engine} opts={opts} onClose={() => setPreviewId(null)} onEdit={() => { setEditId(preview.id); setPreviewId(null); }} />
      )}
      {studentKey && <StudentDialog studentKey={studentKey} cases={cases} records={records} cal={cal} onClose={() => setStudentKey(null)} onPreview={(id) => { setStudentKey(null); setPreviewId(id); }} onEdit={(id) => { setStudentKey(null); setEditId(id); }} />}
      {settingsTab && <SettingsDialog settings={settings} custom={custom} initialTab={settingsTab} onSave={onSaveSettings} onCustom={setCustom} onClose={() => setSettingsTab(null)} />}
    </div>
  );
}
