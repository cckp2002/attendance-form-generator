import type { DocType } from '../types';
import type { EraseRange } from './clean';

/**
 * 기본 양식(웅촌중학교) 배치 정의.
 * 좌표는 PDF 포인트(왼쪽 아래 원점)이며, 원본 PDF의 글자 위치(기준선)를 그대로 읽어 둔 값입니다.
 * 새 양식을 추가하려면 TemplateSpec 한 개를 더 정의하면 됩니다.
 */
export interface DateSlot {
  yearX: number; // "2025년" 글자 시작 x
  monthX: number; // "월" 글자 x
  dayX: number; // "일" 글자 x
  y: number;
}

export interface TemplateSpec {
  docType: DocType;
  /** 어떤 PDF 파일(양식)의 몇 번째 페이지인가 */
  file: 'absence' | 'combo';
  page: number;
  /** 제거할 원본 글자(자리표시자·기존 연도 등)의 범위 [x시작, x끝, 기준선y] */
  erase: EraseRange[];
  /** 학교장 귀하 줄 (학교명을 바꿀 때만 제거 후 다시 씀) */
  schoolErase: EraseRange[];
  schoolY: number;
  titleKind: { x: number; w: number; y: number };
  id: { y: number };
  nameLine: { y: number; labelX: number };
  /** 서명란의 "학생 :" 오른쪽에 이름을 쓸 위치 (없으면 null) */
  studentSign: { y: number } | null;
  /** 담임 서명란 기준선 y (이름은 "담임 :"과 "(인)" 사이에 씀) */
  teacherY: number;
  dates: DateSlot[];
}

const R = (y: number, x0: number, x1: number): EraseRange => [x0, x1, y];
const school = (y: number): EraseRange[] => [R(y, 177, 420)];

export const SPECS: Record<DocType, TemplateSpec> = {
  absence: {
    docType: 'absence',
    file: 'absence',
    page: 0,
    erase: [
      R(721.5, 313, 430), // ({{결석종류}})
      R(666.8, 346, 500), // {{ 학번 }}
      R(642.9, 376, 510), // 명 : {{ 이름 }}
      R(578.6, 97, 515), R(555.2, 84, 515), // 위의 학생은 ( {{ 사유 }} )… 두 줄
      R(531.9, 84, 300), // ▶기간 : {{ 결석 기간 }}
      R(490.3, 355, 396), // 2025년
      R(465.2, 383, 471), // {{ 이름 }}
      R(284.7, 84, 515), R(264.0, 84, 515), // 담임 확인 문장 두 줄
      R(222.4, 356, 397), // 2025년
    ],
    schoolErase: school(395.4),
    schoolY: 395.4,
    titleKind: { x: 313.5, w: 112, y: 721.5 },
    id: { y: 666.8 },
    nameLine: { y: 642.9, labelX: 376.6 },
    studentSign: { y: 465.2 },
    teacherY: 196.5,
    dates: [
      { yearX: 355.7, monthX: 420.6, dayX: 466.1, y: 490.3 },
      { yearX: 357.0, monthX: 428.5, dayX: 473.9, y: 222.4 },
    ],
  },
  early: {
    docType: 'early',
    file: 'combo',
    page: 0,
    erase: [
      R(661.6, 217, 335),
      R(597.3, 346, 500),
      R(555.4, 376, 510),
      R(498.9, 97, 515), R(463.2, 84, 515),
      R(407.9, 84, 445),
      R(299.4, 358, 399),
      R(256.2, 383, 476),
    ],
    schoolErase: school(116.2),
    schoolY: 116.2,
    titleKind: { x: 217.6, w: 112, y: 661.6 },
    id: { y: 597.3 },
    nameLine: { y: 555.4, labelX: 376.6 },
    studentSign: { y: 256.2 },
    teacherY: 192.1,
    dates: [{ yearX: 359.0, monthX: 423.9, dayX: 462.8, y: 299.4 }],
  },
  late: {
    docType: 'late',
    file: 'combo',
    page: 1,
    erase: [
      R(661.6, 217, 335),
      R(613.2, 346, 500),
      R(571.3, 376, 510),
      R(513.4, 97, 515), R(477.7, 84, 515),
      R(422.4, 84, 465),
      R(384.8, 103, 400), R(365.2, 116, 290), // 등교시각 안내문 (목록 길이에 따라 다시 씀)
      R(284.1, 355, 396),
    ],
    schoolErase: school(109.8),
    schoolY: 109.8,
    titleKind: { x: 217.6, w: 112, y: 661.6 },
    id: { y: 613.2 },
    nameLine: { y: 571.3, labelX: 376.6 },
    // 원본 지각 양식에는 "학생 :" 오른쪽 이름 자리표시자가 없어 다른 양식과 동일하게 이름을 채운다
    studentSign: { y: 242.5 },
    teacherY: 181.5,
    dates: [{ yearX: 355.7, monthX: 420.6, dayX: 466.1, y: 284.1 }],
  },
  result: {
    docType: 'result',
    file: 'combo',
    page: 2,
    erase: [
      R(683.1, 217, 335),
      R(634.8, 346, 500),
      R(592.9, 376, 510),
      R(532.7, 97, 515), R(497.0, 84, 515),
      R(432.0, 84, 360),
      R(333.5, 355, 396),
      R(290.2, 383, 476),
    ],
    schoolErase: school(150.2),
    schoolY: 150.2,
    titleKind: { x: 217.6, w: 112, y: 683.1 },
    id: { y: 634.8 },
    nameLine: { y: 592.9, labelX: 376.6 },
    studentSign: { y: 290.2 },
    teacherY: 226.2,
    dates: [{ yearX: 355.7, monthX: 420.6, dayX: 466.1, y: 333.5 }],
  },
};
