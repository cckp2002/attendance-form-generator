import { useMemo, useState } from 'react';
import type { PdfEngine, PdfOptions } from '../lib/pdf/generate';
import { fileNameFor } from '../lib/pdf/generate';
import { downloadBlob, printPdf } from '../lib/runtime';
import type { Case } from '../lib/types';
import { PdfView, type BuiltInfo } from './PdfView';
import { Modal } from './ui';

export function PreviewDialog({ c, engine, opts, onClose, onEdit }: { c: Case; engine: PdfEngine | null; opts: PdfOptions; onClose: () => void; onEdit: () => void }) {
  const [built, setBuilt] = useState<BuiltInfo | null>(null);
  const list = useMemo(() => [c], [c]);
  return (
    <Modal
      wide
      title={`미리보기 — ${c.name} · ${c.category}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onEdit}>내용 수정</button>
          <button className="btn" disabled={!built} onClick={() => built && downloadBlob(built.bytes, fileNameFor(c))}>PDF 다운로드</button>
          <button className="btn navy" disabled={!built} onClick={() => built && printPdf(built.bytes)}>🖨 인쇄</button>
        </>
      }
    >
      <PdfView engine={engine} cases={list} opts={opts} onBuilt={setBuilt} />
    </Modal>
  );
}
