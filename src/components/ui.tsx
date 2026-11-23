import { useEffect, useRef, type ReactNode } from 'react';
import { DOC_LABEL, type DocType, type Flag } from '../lib/types';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button className="btn sm" onClick={onClose} aria-label="닫기">닫기 ✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function DocBadge({ doc }: { doc: DocType | null }) {
  if (!doc) return <span className="badge err">분류 필요</span>;
  return <span className={`badge ${doc}`}>{DOC_LABEL[doc]}</span>;
}

export function FlagList({ flags, hideInfo }: { flags: Flag[]; hideInfo?: boolean }) {
  const list = hideInfo ? flags.filter((f) => f.level !== 'info') : flags;
  if (!list.length) return null;
  return (
    <ul className="flaglist">
      {list.map((f, i) => (
        <li key={i} className={f.level}>{f.message}</li>
      ))}
    </ul>
  );
}

/** 비동기 PDF 미리보기 영역 */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
