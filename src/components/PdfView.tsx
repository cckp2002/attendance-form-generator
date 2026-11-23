import { useEffect, useRef, useState } from 'react';
import type { PdfEngine } from '../lib/pdf/generate';
import type { PdfOptions } from '../lib/pdf/generate';
import { renderPdfToCanvases } from '../lib/runtime';
import type { Case } from '../lib/types';

export interface BuiltInfo {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

/** 실제 다운로드되는 PDF와 같은 결과를 화면에 그려 보여줍니다. */
export function PdfView({ engine, cases, opts, onBuilt, scale = 1.25 }: { engine: PdfEngine | null; cases: Case[]; opts: PdfOptions; onBuilt?: (b: BuiltInfo | null) => void; scale?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const cb = useRef(onBuilt);
  cb.current = onBuilt;

  useEffect(() => {
    let cancelled = false;
    if (!engine || !cases.length) {
      setState('idle');
      cb.current?.(null);
      return;
    }
    setState('loading');
    (async () => {
      try {
        const r = await engine.build(cases, opts);
        if (cancelled) return;
        const w = r.warnings.map((x) => x.message);
        setWarnings(w);
        cb.current?.({ bytes: r.bytes, pageCount: r.pageCount, warnings: w });
        if (ref.current) await renderPdfToCanvases(r.bytes, ref.current, scale, () => cancelled);
        if (!cancelled) setState('idle');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
        cb.current?.(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, cases, opts.issueDateISO, opts.schoolName, opts.teacherName, opts.attachment, opts.idFormat, opts.cal, scale]);

  return (
    <div>
      {state === 'error' && <div className="notice err">미리보기를 만들 수 없습니다: {error}</div>}
      {warnings.map((w, i) => (
        <div key={i} className="notice warn">{w}</div>
      ))}
      {state === 'loading' && <div className="muted small" style={{ marginBottom: 6 }}><span className="spinner" /> 확인서를 만드는 중…</div>}
      <div className="pdfview" ref={ref} aria-label="확인서 미리보기" />
    </div>
  );
}
