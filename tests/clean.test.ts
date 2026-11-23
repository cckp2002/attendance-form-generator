import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanTemplatePage } from '../src/lib/pdf/clean';
import { SPECS } from '../src/lib/pdf/spec';

const pub = (f: string) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../public/templates', f)));

describe('양식 PDF 자리표시자 제거', () => {
  for (const spec of Object.values(SPECS)) {
    it(`${spec.docType}: 모든 기준 글자 블록이 제거됨`, async () => {
      const src = pub(spec.file === 'absence' ? 'absence.pdf' : 'early-late-result.pdf');
      const r = await cleanTemplatePage(src, spec.page, [...spec.erase, ...spec.schoolErase]);
      expect(r.unmatched).toEqual([]);
    });
  }
});
