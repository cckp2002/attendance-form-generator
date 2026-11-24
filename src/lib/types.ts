export type DocType = 'absence' | 'early' | 'late' | 'result';

export const DOC_LABEL: Record<DocType, string> = {
  absence: '결석 신고서',
  early: '조퇴 확인서',
  late: '지각 확인서',
  result: '결과 확인서',
};
export const DOC_SHORT: Record<DocType, string> = {
  absence: '결석',
  early: '조퇴',
  late: '지각',
  result: '결과',
};
export const DOC_ORDER: DocType[] = ['absence', 'early', 'late', 'result'];

/** 엑셀 한 행(원본 값 유지) */
export interface RawRecord {
  id: string;
  sourceFile: string;
  rowNo: number;
  grade: string;
  classNo: string;
  dateISO: string; // YYYY-MM-DD
  dateRaw: string;
  number: string;
  name: string;
  category: string; // 출결구분 원본 (예: 질병결석)
  periodsRaw: string;
  periods: string[];
  reason: string;
}

export interface ParseIssue {
  sourceFile: string;
  rowNo: number;
  message: string;
}

export interface DayEntry {
  dateISO: string;
  periods: string[];
  /** 조퇴 시작 / 지각 등교 교시를 교사가 직접 지정한 값 */
  periodOverride?: string;
}

export interface Flag {
  level: 'error' | 'warn' | 'info';
  code: string;
  message: string;
}

export interface Case {
  id: string;
  studentKey: string;
  grade: string;
  classNo: string;
  number: string;
  name: string;
  /** 출결구분 원본 값 */
  category: string;
  /** 문서 종류 (분류 불가면 null) */
  docType: DocType | null;
  reason: string;
  /** 결석 신고서 "첨부" 칸에 쓸 내용 (비우면 출력 화면의 공통 첨부 사용) */
  attachment?: string;
  /** 이 확인서만 다르게 쓸 작성일 (YYYY-MM-DD, 없으면 공통 작성일) */
  issueDate?: string;
  /** 결석 신고서 하단 "담임확인서" 날짜 (없으면 작성일과 같음) */
  confirmDate?: string;
  entries: DayEntry[];
  recordIds: string[];
  /** 자동 통합 여부 (기록 2건 이상) */
  merged: boolean;
  manual: boolean;
  reviewed: boolean;
  /** 통합 과정에서 자동 생성된 안내 (예: 사이에 등교일이 있어 통합하지 않음) */
  autoFlags: Flag[];
}

export interface Settings {
  schoolName: string;
  /** 담임교사 이름 (확인서의 담임 서명란 옆에 인쇄) */
  teacherName?: string;
  idFormat: 'text' | 'digits';
  useDefaultHolidays: boolean;
  /** YYYY-MM-DD 목록 */
  holidays: string[];
  /** 방학 등 기간 [시작, 끝] */
  holidayRanges: [string, string][];
  /** 토/일이지만 수업이 있는 날 */
  extraSchoolDays: string[];
}
