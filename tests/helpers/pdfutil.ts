import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfAssets } from '../../src/lib/pdf/generate';
import { setSubsetWasmSource } from '../../src/lib/pdf/subset';

const root = path.resolve(__dirname, '../..');
export function loadAssets(): PdfAssets {
  setSubsetWasmSource(async () => new Uint8Array(fs.readFileSync(path.join(root, "node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm"))));
  const f = (p: string) => new Uint8Array(fs.readFileSync(path.join(root, p)));
  return {
    font: f('public/fonts/NanumGothic-Regular.ttf'),
    fontBold: f('public/fonts/NanumGothic-Bold.ttf'),
    templates: { absence: f('public/templates/absence.pdf'), combo: f('public/templates/early-late-result.pdf') },
    version: 'test',
  };
}

export async function extractPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const t = await p.getTextContent();
    out.push(t.items.map((it: any) => it.str).join(''));
  }
  return out;
}

export async function renderPng(bytes: Uint8Array, outPrefix: string, scale = 1.6) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale });
    const c = createCanvas(v.width, v.height);
    await p.render({ canvasContext: c.getContext('2d') as any, viewport: v, canvas: c as any }).promise;
    fs.writeFileSync(`${outPrefix}-${i}.png`, c.toBuffer('image/png'));
  }
}
