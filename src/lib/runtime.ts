import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist';
import hbWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import type { Calendar } from './calendar';
import { PdfEngine, fileNameFor, type PdfAssets, type PdfOptions } from './pdf/generate';
import { setSubsetWasmSource } from './pdf/subset';
import type { Case, DocType } from './types';

// 워커는 번들러를 거치지 않고 정적 파일(public/pdf.worker.min.mjs, 빌드 전에 node_modules에서 복사)로 직접 불러온다
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
setSubsetWasmSource(async () => (await fetch(hbWasmUrl)).arrayBuffer());

/** 같은 사이트에서 정적 파일(글꼴·기본 양식)만 불러옵니다. 학생 정보는 전송되지 않습니다. */
const fetchBytes = async (path: string) => {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error(`${path} 파일을 불러오지 못했습니다 (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};

let defaultAssets: Promise<PdfAssets> | null = null;
export function loadDefaultAssets(): Promise<PdfAssets> {
  if (!defaultAssets) {
    defaultAssets = Promise.all([
      fetchBytes('fonts/NanumGothic-Regular.ttf'),
      fetchBytes('fonts/NanumGothic-Bold.ttf'),
      fetchBytes('templates/absence.pdf'),
      fetchBytes('templates/early-late-result.pdf'),
    ]).then(([font, fontBold, absence, combo]) => ({
      font,
      fontBold,
      templates: { absence, combo },
      version: 'default',
    }));
    defaultAssets.catch(() => (defaultAssets = null));
  }
  return defaultAssets;
}

/** 사용자가 교체한 양식 (이 브라우저 탭의 메모리에만 존재) */
export interface CustomTemplates {
  absence?: Uint8Array;
  combo?: Uint8Array;
  pages?: Partial<Record<DocType, number>>;
  version: string;
}

export async function makeEngine(custom: CustomTemplates | null): Promise<PdfEngine> {
  const base = await loadDefaultAssets();
  const assets: PdfAssets = custom
    ? {
        ...base,
        templates: { absence: custom.absence ?? base.templates.absence, combo: custom.combo ?? base.templates.combo },
        pageOverride: custom.pages,
        version: custom.version,
      }
    : base;
  return new PdfEngine(assets);
}

export interface PdfJob {
  cases: Case[];
  opts: PdfOptions;
}

export function downloadBlob(bytes: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();

/** 개별 PDF를 ZIP으로 묶음. byStudent=true 면 학생별 폴더로 분류 */
export async function buildZip(engine: PdfEngine, cases: Case[], opts: PdfOptions, byStudent: boolean, onProgress?: (n: number, total: number) => void): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = new Set<string>();
  let i = 0;
  for (const c of cases) {
    const r = await engine.build([c], opts);
    let name = fileNameFor(c);
    const folder = byStudent ? `${c.grade}-${c.classNo}_${String(c.number).padStart(2, '0')}_${safe(c.name)}/` : '';
    let full = folder + name;
    for (let k = 2; used.has(full); k++) full = folder + name.replace(/\.pdf$/, `_${k}.pdf`);
    used.add(full);
    zip.file(full, r.bytes);
    onProgress?.(++i, cases.length);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export function printPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = url;
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
    }, 300);
  };
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 10 * 60 * 1000);
}

export async function renderPdfToCanvases(bytes: Uint8Array, container: HTMLElement, scale: number, isCancelled: () => boolean) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const frag: HTMLCanvasElement[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (isCancelled()) return;
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
    canvas.style.height = `${vp.height / (window.devicePixelRatio || 1)}px`;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    frag.push(canvas);
  }
  if (isCancelled()) return;
  container.replaceChildren(...frag);
}

export type { Calendar };
