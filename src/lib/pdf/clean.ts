import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/**
 * 템플릿 PDF 한 페이지에서 지정한 범위의 글자 블록을 콘텐츠 스트림에서 실제로 제거한다.
 * 범위 = [x시작, x끝, 기준선 y]  (PDF 포인트, 왼쪽 아래 원점). 글자 블록의 시작 x가 [x시작, x끝) 에 있고
 * 기준선이 y와 같으면 제거 대상이다.
 */
export type EraseRange = [number, number, number];

function bytesToLatin1(u: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH));
  return s;
}
function latin1ToBytes(s: string): Uint8Array {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

export interface CleanResult {
  bytes: Uint8Array;
  /** 제거된 글자 블록 수 */
  removed: number;
  /** 블록을 하나도 찾지 못한 범위 (양식이 기본 배치와 다르다는 신호) */
  unmatched: EraseRange[];
}

export async function cleanTemplatePage(src: Uint8Array, pageIndex: number, ranges: EraseRange[]): Promise<CleanResult> {
  const source = await PDFDocument.load(src);
  const count = source.getPageCount();
  if (pageIndex < 0 || pageIndex >= count) throw new Error(`양식 PDF에 ${pageIndex + 1}페이지가 없습니다.`);
  // 필요한 페이지만 새 문서로 복사 (removePage 후 getPage는 캐시 문제가 있어 사용하지 않음)
  const pdf = await PDFDocument.create();
  const [copied] = await pdf.copyPages(source, [pageIndex]);
  const page = pdf.addPage(copied);

  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFArray) {
    for (const ref of contents.asArray()) streams.push(pdf.context.lookup(ref) as PDFRawStream);
  } else if (contents) {
    streams.push(contents as PDFRawStream);
  }
  const text = streams.map((s) => bytesToLatin1(decodePDFRawStream(s).decode())).join('\n');

  // 줄 단위 해석: q / Q / cm / BT / Tm / ET  (이 양식의 콘텐츠 스트림은 연산자마다 한 줄)
  const lines = text.split('\n');
  const stack: M[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let btStart = -1;
  let tm: M | null = null;
  let ctmAtBT: M = ctm;
  const drop = new Set<number>();
  const hit = new Set<number>();
  const TOL = 1.2;
  let removed = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === 'q') stack.push(ctm);
    else if (l === 'Q') ctm = stack.pop() ?? ctm;
    else if (l.endsWith(' cm')) {
      const n = l.slice(0, -3).trim().split(/\s+/).map(Number);
      if (n.length === 6 && n.every((v) => Number.isFinite(v))) ctm = mul(n as M, ctm);
    } else if (l === 'BT') {
      btStart = i;
      tm = null;
      ctmAtBT = ctm;
    } else if (l.endsWith(' Tm') && btStart >= 0 && !tm) {
      const n = l.slice(0, -3).trim().split(/\s+/).map(Number);
      if (n.length === 6) tm = n as M;
    } else if (l === 'ET' && btStart >= 0) {
      if (tm) {
        const full = mul(tm, ctmAtBT);
        const x = full[4];
        const y = full[5];
        const ri = ranges.findIndex(([x0, x1, ry]) => Math.abs(ry - y) <= TOL && x >= x0 - TOL && x < x1);
        if (ri >= 0) {
          for (let k = btStart; k <= i; k++) drop.add(k); // BT..ET 구간만 제거 (q/Q 균형 유지)
          hit.add(ri);
          removed++;
        }
      }
      btStart = -1;
    }
  }

  const out = lines.filter((_, i) => !drop.has(i)).join('\n');
  const newStream = pdf.context.flateStream(latin1ToBytes(out));
  page.node.set(PDFName.of('Contents'), pdf.context.register(newStream));

  const saved = await pdf.save();
  return { bytes: saved, removed, unmatched: ranges.filter((_, i) => !hit.has(i)) };
}
