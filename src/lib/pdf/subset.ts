/**
 * 글꼴 서브셋(필요한 글자만 남기기) — HarfBuzz(wasm, MIT) 직접 호출.
 * pdf-lib 내장 서브셋은 한글 합성 글리프에서 글자가 빠지는 문제가 있어 사용하지 않는다.
 * (npm 'subset-font'을 참고해 브라우저에서도 동작하도록 만든 최소 구현)
 */
export type WasmSource = () => Promise<ArrayBuffer | Uint8Array>;

let source: WasmSource | null = null;
let instance: Promise<any> | null = null;

export function setSubsetWasmSource(s: WasmSource) {
  source = s;
  instance = null;
}
export const hasSubsetSupport = () => source !== null;

async function load() {
  if (!source) throw new Error('글꼴 서브셋 모듈이 설정되지 않았습니다.');
  if (!instance) {
    instance = (async () => {
      const bytes = await source!();
      const { instance: inst } = await WebAssembly.instantiate(bytes as BufferSource);
      const ex = inst.exports as any;
      ex._initialize();
      return ex;
    })();
  }
  return instance;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

export async function subsetTTF(font: Uint8Array, text: string): Promise<Uint8Array> {
  const hb = await load();
  const heap = () => new Uint8Array(hb.memory.buffer); // wasm 메모리가 커지면 뷰가 무효화되므로 매번 새로 만든다

  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error('글꼴 서브셋 초기화에 실패했습니다.');
  const ptr = hb.malloc(font.byteLength);
  heap().set(font, ptr);
  const blob = hb.hb_blob_create(ptr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
  hb.hb_set_clear(features);
  hb.hb_set_invert(features); // 모든 레이아웃 기능 유지

  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const ch of text) hb.hb_set_add(unicodes, ch.codePointAt(0));

  let subset = 0;
  try {
    subset = hb.hb_subset_or_fail(face, input);
  } finally {
    hb.hb_subset_input_destroy(input);
  }
  if (!subset) {
    hb.hb_face_destroy(face);
    hb.free(ptr);
    throw new Error('글꼴 서브셋 생성에 실패했습니다.');
  }
  const result = hb.hb_face_reference_blob(subset);
  const offset = hb.hb_blob_get_data(result, 0);
  const length = hb.hb_blob_get_length(result);
  const out = heap().slice(offset, offset + length);
  hb.hb_blob_destroy(result);
  hb.hb_face_destroy(subset);
  hb.hb_face_destroy(face);
  hb.free(ptr);
  if (!length) throw new Error('글꼴 서브셋 결과가 비어 있습니다.');
  return out;
}
