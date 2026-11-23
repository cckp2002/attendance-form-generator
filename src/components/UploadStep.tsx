import { useRef, useState } from 'react';
import { guessGradeClass } from '../lib/excel';

export interface UploadedFile {
  id: string;
  name: string;
  data: ArrayBuffer;
  grade: string;
  classNo: string;
  guessed: boolean;
  error?: string;
  count?: number;
}

let uid = 0;
export async function toUploaded(f: File): Promise<UploadedFile> {
  const g = guessGradeClass(f.name);
  return { id: `f${++uid}`, name: f.name, data: await f.arrayBuffer(), grade: g?.grade ?? '', classNo: g?.classNo ?? '', guessed: !!g };
}

export function UploadStep({ files, setFiles, onAnalyze, busy, hasResult, onGoReview, onSample }: {
  onSample: () => void;
  files: UploadedFile[];
  setFiles: (f: UploadedFile[] | ((p: UploadedFile[]) => UploadedFile[])) => void;
  onAnalyze: () => void;
  busy: boolean;
  hasResult: boolean;
  onGoReview: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState('');

  const add = async (list: FileList | File[]) => {
    const arr = [...list];
    const ok = arr.filter((f) => /\.xlsx$/i.test(f.name));
    const bad = arr.filter((f) => !/\.xlsx$/i.test(f.name));
    setMsg(bad.length ? `엑셀(.xlsx) 파일만 올릴 수 있습니다. 제외된 파일: ${bad.map((f) => f.name).join(', ')}${bad.some((f) => /\.xls$/i.test(f.name)) ? ' (.xls 파일은 엑셀에서 .xlsx로 다시 저장해 주세요)' : ''}` : '');
    if (!ok.length) return;
    const ups = await Promise.all(ok.map(toUploaded));
    setFiles((p) => [...p, ...ups]);
  };

  const missing = files.some((f) => !/^\d+$/.test(f.grade) || !/^\d+$/.test(f.classNo));

  return (
    <div>
      <div className="card">
        <h2>① 월별 출결 현황 엑셀 올리기</h2>
        <div
          className={`drop${over ? ' over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          aria-label="엑셀 파일 올리기"
        >
          <div className="big">엑셀 파일을 여기에 끌어다 놓거나 클릭해서 선택하세요</div>
          <div className="muted">.xlsx · 여러 달 파일을 한꺼번에 올려 함께 분석할 수 있습니다</div>
          <input ref={input} type="file" accept=".xlsx" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
        </div>
        {msg && <div className="notice err">{msg}</div>}

        {files.map((f) => (
          <div className={`filecard${f.error ? ' err' : ''}`} key={f.id}>
            <div className="name">📄 {f.name}{f.error && <div className="small" style={{ color: 'var(--err)' }}>{f.error}</div>}</div>
            <div className="row" aria-label="학년 반">
              <input className="narrow" type="text" inputMode="numeric" value={f.grade} placeholder="학년" aria-label={`${f.name} 학년`}
                onChange={(e) => setFiles((p) => p.map((x) => (x.id === f.id ? { ...x, grade: e.target.value.replace(/\D/g, ''), guessed: false } : x)))} /> 학년
              <input className="narrow" type="text" inputMode="numeric" value={f.classNo} placeholder="반" aria-label={`${f.name} 반`}
                onChange={(e) => setFiles((p) => p.map((x) => (x.id === f.id ? { ...x, classNo: e.target.value.replace(/\D/g, ''), guessed: false } : x)))} /> 반
              {f.guessed ? <span className="badge ok">파일명에서 인식</span> : (!/^\d+$/.test(f.grade) || !/^\d+$/.test(f.classNo)) && <span className="badge warn">학년·반 입력 필요</span>}
            </div>
            <button className="btn sm danger" onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}>삭제</button>
          </div>
        ))}

        {missing && files.length > 0 && <div className="notice warn">파일명에서 학년·반을 알 수 없는 파일이 있습니다. 위 칸에 학년과 반을 입력해 주세요.</div>}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={!files.length || missing || busy} onClick={onAnalyze}>
            {busy ? <><span className="spinner" /> 분석 중…</> : '출결 분석하기 →'}
          </button>
          <button className="btn" onClick={onSample} title="가상 학생의 연속 결석·조퇴·지각·결과 예시로 화면과 PDF를 미리 체험합니다">예시 데이터로 체험하기</button>
          {hasResult && <button className="btn" onClick={onGoReview}>이전 분석 결과로 돌아가기</button>}
        </div>
      </div>
      <div className="card small muted">
        <b style={{ color: 'var(--navy)' }}>엑셀 형식</b> — 1행은 제목(일자·번호·성명·출결구분·결시교시·사유), 2행부터 학생별 출결 내역입니다.
        번호·성명이 세로로 병합된 칸은 자동으로 각 행에 적용되며, 병합되지 않은 빈 칸은 임의로 채우지 않고 오류로 알려 드립니다.
      </div>
    </div>
  );
}
