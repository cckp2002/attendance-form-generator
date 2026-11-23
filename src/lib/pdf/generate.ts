import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { hasSubsetSupport, subsetTTF } from './subset';
import type { Calendar } from '../calendar';
import { classifyCategory, euro } from '../classify';
import { fmtFull, fmtMD, parts, WEEK_KO, weekday } from '../dates';
import { entryPeriodText } from '../periods';
import { DOC_LABEL, type Case, type DayEntry, type DocType } from '../types';
import { cleanTemplatePage } from './clean';
import { SPECS, type TemplateSpec } from './spec';

export interface PdfAssets {
  font: Uint8Array;
  fontBold: Uint8Array;
  templates: { absence: Uint8Array; combo: Uint8Array };
  /** 사용자가 교체한 양식의 페이지 번호(0부터). 없으면 기본 배치 사용 */
  pageOverride?: Partial<Record<DocType, number>>;
  /** 캐시 구분용 */
  version: string;
}

export interface PdfOptions {
  issueDateISO: string;
  schoolName: string;
  teacherName?: string;
  /** 결석 신고서 "첨부" 칸 공통 내용 */
  attachment?: string;
  idFormat: 'text' | 'digits';
  cal: Calendar;
}

export interface BuildResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: { caseId: string; message: string }[];
}

export const DEFAULT_SCHOOL = '웅촌중학교';
const BODY = 12.9;
const BLACK = rgb(0, 0, 0);
const SPACE_EM = 0.32;

export function studentIdText(c: Pick<Case, 'grade' | 'classNo' | 'number'>, fmt: 'text' | 'digits'): string {
  if (fmt === 'digits') return `${c.grade}${c.classNo.padStart(2, '0')}${c.number.padStart(2, '0')}`;
  return `${c.grade}학년 ${c.classNo}반 ${c.number}번`;
}

/** 기간 문구: 연속된 날짜는 "~"로, 떨어진 날짜는 쉼표로 구분 (일수는 실제 기록 일수) */
export function formatPeriodText(entries: DayEntry[], cal: Calendar): string {
  const dates = [...new Set(entries.map((e) => e.dateISO))].sort();
  if (!dates.length) return '';
  const runs: string[][] = [];
  for (const d of dates) {
    const run = runs[runs.length - 1];
    if (run && cal.isSchoolDay(d) && cal.nextSchoolDay(run[run.length - 1]) === d) run.push(d);
    else runs.push([d]);
  }
  let lastYear = -1;
  const show = (iso: string) => {
    const { y } = parts(iso);
    const s = y === lastYear ? fmtMD(iso) : fmtFull(iso);
    lastYear = y;
    return s;
  };
  const txt = runs.map((r) => (r.length === 1 ? show(r[0]) : `${show(r[0])} ~ ${show(r[r.length - 1])}`)).join(', ');
  return `${txt} (${dates.length}일)`;
}

export function fileNameFor(c: Case): string {
  const dates = c.entries.map((e) => e.dateISO.replace(/-/g, '')).sort();
  const range = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}-${dates[dates.length - 1]}`) : 'nodate';
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '');
  return `${c.grade}-${c.classNo}_${safe(c.name)}_${safe(c.category)}_${range}.pdf`;
}

/**
 * 글자 조판 도우미.
 * - 공백은 글리프를 쓰지 않고 간격으로만 처리한다 (서브셋 폰트의 빈 글리프 문제 회피)
 * - collect 모드에서는 실제로 그리지 않고 사용한 글자만 모은다
 */
class Face {
  used = new Set<string>();
  unsupported = new Set<string>();
  private supported: Set<number>;
  constructor(public font: PDFFont, private collect: boolean) {
    this.supported = new Set(font.getCharacterSet());
  }
  w(t: string, size: number): number {
    const p = t.split(' ');
    let w = (p.length - 1) * size * SPACE_EM;
    for (const s of p) if (s) w += this.font.widthOfTextAtSize(s, size);
    return w;
  }
  draw(page: PDFPage, t: string, x: number, y: number, size: number) {
    let cx = x;
    const p = t.split(' ');
    p.forEach((s, i) => {
      if (s) {
        for (const ch of s) {
          this.used.add(ch);
          if (!this.supported.has(ch.codePointAt(0)!)) this.unsupported.add(ch);
        }
        if (!this.collect) page.drawText(s, { x: cx, y, size, font: this.font, color: BLACK });
        cx += this.font.widthOfTextAtSize(s, size);
      }
      if (i < p.length - 1) cx += size * SPACE_EM;
    });
  }
}

interface Fitted {
  lines: string[];
  size: number;
  lh: number;
  overflow: boolean;
}

interface Appendix {
  label: string;
  headers: [string, string, string];
  rows: string[][];
}

export class PdfEngine {
  private cleaned = new Map<string, Promise<Uint8Array>>();
  constructor(private assets: PdfAssets) {}

  private spec(doc: DocType): TemplateSpec {
    const s = SPECS[doc];
    const ov = this.assets.pageOverride?.[doc];
    return ov === undefined ? s : { ...s, page: ov };
  }

  private cleanedFor(spec: TemplateSpec, eraseSchool: boolean): Promise<Uint8Array> {
    const key = `${this.assets.version}|${spec.docType}|${spec.page}|${eraseSchool}`;
    let p = this.cleaned.get(key);
    if (!p) {
      const src = spec.file === 'absence' ? this.assets.templates.absence : this.assets.templates.combo;
      const ranges = eraseSchool ? [...spec.erase, ...spec.schoolErase] : spec.erase;
      p = cleanTemplatePage(src, spec.page, ranges).then((r) => {
        if (r.unmatched.length) {
          throw new Error(
            `양식 PDF가 기본 양식과 배치가 달라 자동 작성할 수 없습니다 (${DOC_LABEL[spec.docType]}: 인식하지 못한 위치 ${r.unmatched.length}곳). 기본 양식을 사용하거나 같은 배치의 양식을 올려 주세요.`,
          );
        }
        return r.bytes;
      });
      this.cleaned.set(key, p);
    }
    return p;
  }

  /** 1단계: 사용할 글자를 모은다 → 2단계: 필요한 글자만 담은 폰트로 실제 작성 */
  async build(cases: Case[], opts: PdfOptions): Promise<BuildResult> {
    if (!cases.length) throw new Error('출력할 확인서가 없습니다.');
    for (const c of cases) if (!c.docType) throw new Error(`${c.name}: 확인서 종류가 정해지지 않았습니다.`);
    const customSchool = opts.schoolName.trim() !== DEFAULT_SCHOOL;

    // 글자 수집(실제 그리기 없음)
    const scratch = await PDFDocument.create();
    scratch.registerFontkit(fontkit);
    const sFont = new Face(await scratch.embedFont(this.assets.font, { subset: false }), true);
    const sBold = new Face(await scratch.embedFont(this.assets.fontBold, { subset: false }), true);
    const sPage = scratch.addPage([595, 841]);
    for (const c of cases) {
      const spec = this.spec(c.docType!);
      const ap = this.drawDoc(sPage, sFont, spec, c, opts, customSchool, () => {});
      if (ap) this.drawAppendix(scratch, sFont, sBold, c, ap);
    }
    sFont.used.add('.');
    let regularBytes = this.assets.font;
    let boldBytes = this.assets.fontBold;
    if (hasSubsetSupport()) {
      try {
        regularBytes = await subsetTTF(this.assets.font, [...sFont.used].join(''));
        boldBytes = await subsetTTF(this.assets.fontBold, [...sBold.used, ...sFont.used].join(''));
      } catch {
        /* 서브셋에 실패하면 전체 글꼴을 그대로 포함 (용량만 커짐) */
      }
    }

    const out = await PDFDocument.create();
    out.registerFontkit(fontkit);
    out.setTitle('출결 확인서');
    out.setProducer('출결 확인서 자동작성 시스템');
    out.setCreator('출결 확인서 자동작성 시스템');
    const font = new Face(await out.embedFont(regularBytes, { subset: false }), false);
    const bold = new Face(await out.embedFont(boldBytes, { subset: false }), false);
    const embedded = new Map<string, PDFEmbeddedPage>();
    const warnings: BuildResult['warnings'] = [];

    for (const c of cases) {
      const spec = this.spec(c.docType!);
      const key = `${c.docType}|${spec.page}`;
      let emb = embedded.get(key);
      if (!emb) {
        const bytes = await this.cleanedFor(spec, customSchool);
        [emb] = await out.embedPdf(bytes, [0]);
        embedded.set(key, emb);
      }
      const page = out.addPage([emb.width, emb.height]);
      page.drawPage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
      const w = (m: string) => warnings.push({ caseId: c.id, message: m });
      const ap = this.drawDoc(page, font, spec, c, opts, customSchool, w);
      if (ap) this.drawAppendix(out, font, bold, c, ap);
    }
    // 글꼴에 없는 글자 안내 (수집 단계에서 확인)
    if (sFont.unsupported.size) {
      warnings.push({ caseId: '', message: `PDF 글꼴에 없는 글자가 있어 네모로 표시될 수 있습니다: ${[...sFont.unsupported].join(' ')}` });
    }
    const bytes = await out.save();
    return { bytes, pageCount: out.getPageCount(), warnings };
  }

  // ───────────────────────── 본문 그리기 ─────────────────────────

  private drawDoc(
    page: PDFPage,
    face: Face,
    spec: TemplateSpec,
    c: Case,
    opts: PdfOptions,
    customSchool: boolean,
    warn: (m: string) => void,
  ): Appendix | null {
    const doc = spec.docType;
    const W = (t: string, s: number) => face.w(t, s);
    const text = (t: string, x: number, y: number, size = BODY) => face.draw(page, t, x, y, size);
    const textAlign = (t: string, x: number, y: number, size: number, align: 'center' | 'right') => {
      const w = W(t, size);
      text(t, align === 'center' ? x - w / 2 : x - w, y, size);
    };
    const arrow = (x: number, y: number) => {
      const h = BODY * 0.78;
      page.drawSvgPath(`M 0 0 L 0 ${-h} L ${BODY * 0.62} ${-h / 2} Z`, { x, y: y - 0.9, color: BLACK, borderWidth: 0 });
    };

    const kind = classifyCategory(c.category).kind || c.category;
    const reasonShown = c.reason.trim() || '        ';
    const idText = studentIdText(c, opts.idFormat);

    // 제목의 종류 / 학번 / 성명 / 서명란 이름
    textAlign(`(${kind})`, spec.titleKind.x + spec.titleKind.w / 2, spec.titleKind.y, 15.9, 'center');
    textAlign(idText, 496.5, spec.id.y, 15, 'right');
    text('명 :', spec.nameLine.labelX, spec.nameLine.y, 15);
    textAlign(c.name, 496.5, spec.nameLine.y, 15, 'right');
    if (spec.studentSign) textAlign(c.name, 428, spec.studentSign.y, 13.5, 'center');

    // 담임교사 이름 ("담임 :"과 "(인)" 사이, 비워 두면 공란)
    const teacher = (opts.teacherName ?? '').trim();
    if (teacher) textAlign(teacher, doc === 'absence' ? 434 : 428, spec.teacherY, 13.5, 'center');

    // 작성일 (연도는 원본 "2025년" 자리에, 월/일은 원본 "월"·"일" 앞 빈칸에)
    const { y: yy, m: mm, d: dd } = parts(opts.issueDateISO);
    for (const s of spec.dates) {
      const yt = `${yy}년`;
      text(yt, s.yearX + 39 - W(yt, BODY), s.y); // 원본 "2025년" 칸의 오른쪽 끝에 맞춤
      textAlign(String(mm), (s.yearX + 39 + s.monthX) / 2, s.y, BODY, 'center');
      textAlign(String(dd), (s.monthX + 13 + s.dayX) / 2, s.y, BODY, 'center');
    }

    // 학교장 귀하 (학교명을 바꾼 경우에만 다시 씀)
    if (customSchool) {
      const size = 20;
      const sp = 8.3;
      const chars = (t: string) => [...t.replace(/\s+/g, '')];
      const left = chars(`${opts.schoolName.trim()}장`);
      const right = chars('귀하');
      const wOf = (a: string[]) => a.reduce((s, ch) => s + W(ch, size) + sp, -sp);
      const gap = 30;
      let x = 297.5 - (wOf(left) + gap + wOf(right)) / 2;
      for (const ch of left) {
        text(ch, x, spec.schoolY, size);
        x += W(ch, size) + sp;
      }
      x += gap - sp;
      for (const ch of right) {
        text(ch, x, spec.schoolY, size);
        x += W(ch, size) + sp;
      }
    }

    const para = (body: string, first: number, y0: number, lh0: number, minY: number, x = 85, maxX = 510) => {
      const f = this.fit(face, body, first - x, maxX - x, y0, lh0, minY);
      if (f.overflow) warn('사유가 매우 길어 글자를 줄여도 칸에 다 들어가지 않을 수 있습니다. 사유를 줄여 주세요.');
      f.lines.forEach((ln, i) => text(ln, i === 0 ? first : x, y0 - i * f.lh, f.size));
    };

    const josa = euro(c.reason.trim() || '사유');

    if (doc === 'absence') {
      para(`위의 학생은 ( ${reasonShown} )${josa} 인하여 ( ${c.category} )하였기에 보호자의 연서로서 결석 신고서를 제출합니다.`, 98, 578.6, 23.4, 552.5);
      arrow(85, 531.9);
      const label = '기간 :';
      text(label, 98, 531.9);
      const per = formatPeriodText(c.entries, opts.cal);
      const vx = 98 + W(label + ' ', BODY);
      let ps = BODY;
      while (W(per, ps) > 510 - vx && ps > 8.5) ps -= 0.3;
      text(per, vx, 531.9, ps);
      // 원본 "▶첨부 :" 오른쪽에 입력 (비워 두면 공란)
      const att = (c.attachment ?? opts.attachment ?? '').replace(/\s+/g, ' ').trim();
      if (att) {
        let as = BODY;
        while (W(att, as) > 510 - 142 && as > 8.5) as -= 0.3;
        text(att, 142, 511.1, as);
      }
      para(`위 학생은 ( ${reasonShown} )${josa} 인하여 ( ${c.category} )하였음을 확인합니다.`, 85, 284.7, 20.7, 252);
      return null;
    }

    const labelOf = { early: '조퇴시각 :', late: '등교일시 :', result: '기간 :' } as const;
    const verb = { early: '조퇴', late: '지각', result: '결과' } as const;
    const d = doc as 'early' | 'late' | 'result';
    const sent =
      d === 'result'
        ? `위의 학생은 ( ${reasonShown} )${josa} 결과하였기에 보호자의 연서로서 결과 확인서를 제출합니다.`
        : `위의 학생은 ( ${reasonShown} )${josa} 인하여 ${verb[d]}하였기에 보호자의 연서로서 ${verb[d]} 확인서를 제출합니다.`;
    const paraCfg = {
      early: { first: 498.9, lh: 35.7, minY: 440 },
      late: { first: 513.4, lh: 35.7, minY: 455 },
      result: { first: 532.7, lh: 35.7, minY: 470 },
    }[d];
    para(sent, 98, paraCfg.first, paraCfg.lh, paraCfg.minY);

    // 날짜별 목록 (칸이 모자라면 별지)
    const geo = {
      early: { y0: 407.9, minBase: 299.4 + BODY + 14 },
      late: { y0: 422.4, minBase: 311 + 19.6 + 37.6 },
      result: { y0: 432.0, minBase: 333.5 + BODY + 14 },
    }[d];
    const step = 20;
    const cap = Math.floor((geo.y0 - geo.minBase) / step) + 1;
    const entries = [...c.entries].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const lineFor = (e: DayEntry) => {
      const pt = entryPeriodText(d, e);
      return d === 'result' ? `${fmtFull(e.dateISO)}  ${pt}` : `${fmtFull(e.dateISO)}  ${pt} 부터`;
    };
    arrow(85, geo.y0);
    text(labelOf[d], 98, geo.y0);
    const vx = 98 + W(labelOf[d] + ' ', BODY);
    let lastY = geo.y0;
    let appendix: Appendix | null = null;
    if (entries.length <= cap) {
      entries.forEach((e, i) => {
        lastY = geo.y0 - i * step;
        let s = BODY;
        const t = lineFor(e);
        while (W(t, s) > 510 - vx && s > 9) s -= 0.3;
        text(t, vx, lastY, s);
      });
    } else {
      text(`별지 참조 (총 ${entries.length}일)`, vx, geo.y0);
      appendix = {
        label: DOC_LABEL[d],
        headers: ['날짜', '요일', d === 'early' ? '조퇴 시작 교시' : d === 'late' ? '등교 교시' : '해당 교시'],
        rows: entries.map((e) => [
          fmtFull(e.dateISO),
          WEEK_KO[weekday(e.dateISO)],
          d === 'result' ? entryPeriodText(d, e) : `${entryPeriodText(d, e)} 부터`,
        ]),
      };
    }

    if (d === 'late') {
      const y1 = lastY - 37.6;
      text('* 등교시각(8시 50분) 이후부터 지각으로 한다.', 104.5, y1);
      text('(학업성적관리규정 제11조)', 117.4, y1 - 19.6);
    }
    return appendix;
  }

  /** 문단을 칸에 맞게 줄바꿈 (넘치면 글자 크기를 줄임) */
  private fit(face: Face, body: string, firstIndent: number, width: number, y0: number, lh0: number, minY: number): Fitted {
    const avail = y0 - minY;
    let best: Fitted | null = null;
    for (let size = BODY; size >= 8.8; size -= 0.3) {
      const lines = this.wrap(face, body, size, width - firstIndent, width);
      const lh = lines.length > 1 ? Math.min(lh0, avail / (lines.length - 1)) : lh0;
      best = { lines, size, lh, overflow: false };
      if (lines.length === 1 || lh >= size * 1.25) return best;
    }
    return { ...best!, overflow: true };
  }

  private wrap(face: Face, body: string, size: number, firstW: number, otherW: number): string[] {
    const lines: string[] = [];
    let cur = '';
    const lim = () => (lines.length === 0 ? firstW : otherW);
    for (const word of body.split(' ')) {
      const trial = cur ? `${cur} ${word}` : word;
      if (face.w(trial, size) <= lim()) {
        cur = trial;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      // 한 단어가 한 줄보다 길면 글자 단위로 나눔
      let rest = word;
      while (face.w(rest, size) > lim()) {
        let n = rest.length;
        while (n > 1 && face.w(rest.slice(0, n), size) > lim()) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      cur = rest;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ───────────────────────── 별지 ─────────────────────────

  private drawAppendix(out: PDFDocument, font: Face, bold: Face, c: Case, ap: Appendix) {
    const PAGE_W = 595;
    const PAGE_H = 841;
    const rowH = 26;
    const left = 85;
    const right = 510;
    const colX = [left, left + 190, left + 250];
    const perPage = 24;
    for (let start = 0; start < ap.rows.length; start += perPage) {
      const page = out.addPage([PAGE_W, PAGE_H]);
      page.drawRectangle({ x: 70.4, y: 70.8, width: 454.3, height: 685.2, borderColor: BLACK, borderWidth: 1.08 });
      const ctr = (t: string, y: number, size: number, f: Face) => f.draw(page, t, 297.5 - f.w(t, size) / 2, y, size);
      ctr('별   지', 712, 24, bold);
      ctr(`${ap.label} 날짜별 내역`, 686, 13, font);
      let y = 650;
      [`학번 : ${c.grade}학년 ${c.classNo}반 ${c.number}번`, `성명 : ${c.name}`, `출결구분 : ${c.category}`].forEach((t) => {
        font.draw(page, t, left, y, BODY);
        y -= 20;
      });
      const reason = `사유 : ${c.reason || ''}`;
      let rs = BODY;
      while (font.w(reason, rs) > right - left && rs > 8.5) rs -= 0.3;
      font.draw(page, reason, left, y, rs);
      y -= 30;

      const drawRow = (cells: string[], yTop: number, head: boolean) => {
        page.drawRectangle({
          x: left, y: yTop - rowH, width: right - left, height: rowH,
          borderColor: BLACK, borderWidth: 0.7, color: head ? rgb(0.93, 0.95, 0.97) : undefined,
        });
        [colX[1], colX[2]].forEach((x) => page.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - rowH }, thickness: 0.7, color: BLACK }));
        cells.forEach((t, i) => {
          const f = head ? bold : font;
          const w = f.w(t, BODY);
          const x0 = colX[i];
          const x1 = i === 0 ? colX[1] : i === 1 ? colX[2] : right;
          f.draw(page, t, x0 + (x1 - x0 - w) / 2, yTop - 17.5, BODY);
        });
      };
      drawRow(ap.headers, y, true);
      y -= rowH;
      ap.rows.slice(start, start + perPage).forEach((r) => {
        drawRow(r, y, false);
        y -= rowH;
      });
      font.draw(page, `※ ${ap.label}에 첨부하는 별지입니다. (총 ${ap.rows.length}일)`, left, 90, 11);
    }
  }
}
