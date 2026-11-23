import type { DocType } from './types';

export interface Classified {
  docType: DocType | null;
  /** 질병 / 출석인정 / 미인정 / 기타 등 세부 종류 */
  kind: string;
}

const TYPE_WORDS: [string, DocType][] = [
  ['결석', 'absence'],
  ['조퇴', 'early'],
  ['지각', 'late'],
  ['결과', 'result'],
];

/** 출결구분 문자열을 (세부종류 + 문서종류)로 분리. 원본 문자열은 호출한 쪽에서 그대로 유지한다. */
export function classifyCategory(category: string): Classified {
  const c = category.replace(/\s+/g, '');
  for (const [word, doc] of TYPE_WORDS) {
    if (c.endsWith(word) && c.length > word.length) {
      return { docType: doc, kind: c.slice(0, c.length - word.length) };
    }
  }
  return { docType: null, kind: c };
}

export function docTypeWord(doc: DocType): string {
  return TYPE_WORDS.find(([, d]) => d === doc)![0];
}

const JONG = (ch: string) => {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28;
};

/** "~로/으로" 조사 선택 (받침 없음 또는 ㄹ받침 → 로, 그 외 → 으로) */
export function euro(word: string): string {
  const t = word.trim();
  for (let i = t.length - 1; i >= 0; i--) {
    const j = JONG(t[i]);
    if (j === null) continue; // 한글이 아닌 글자는 건너뜀
    return j === 0 || j === 8 ? '로' : '으로';
  }
  return '로';
}
