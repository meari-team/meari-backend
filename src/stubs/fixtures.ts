// MEA-4 스텁 엔드포인트가 돌려주는 목 데이터. 실제 구현으로 교체되면 해당 부분을 지운다.
import type { ChecklistCategoryDto } from '../checklist/checklist.dto.js';
import type {
  EntryDto,
  EntrySummaryDto,
  PhotoDto,
  QuestionDto,
} from '../entries/entries.dto.js';

const NOW = '2026-10-24T03:00:00.000Z';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const photoUrl = (seed: string) => `https://picsum.photos/seed/${seed}/800/600`;

export const stubPhotos = (date: string): PhotoDto[] => [
  {
    id: id(101),
    url: photoUrl(`${date}-a`),
    width: 800,
    height: 600,
    caption: '학교 앞 파스타집',
    sortOrder: 0,
  },
  {
    id: id(102),
    url: photoUrl(`${date}-b`),
    width: 800,
    height: 600,
    caption: null,
    sortOrder: 1,
  },
];

export const stubQuestions = (): QuestionDto[] => [
  {
    id: id(201),
    question: '음식점에서 찍은 사진 같아요. 누구와 함께였나요?',
    reason: '함께한 사람이 사진만으로 확인되지 않아요.',
    options: null,
    answer: null,
    skipped: false,
  },
];

export const STUB_DRAFT =
  '오늘은 중간고사가 끝난 날이었다. 고등학교 친구 민지와 학교 앞 파스타집에 갔다. 오랜만에 수다를 떨어서 홀가분했던 것 같다.';

export const stubEntry = (date: string): EntryDto => ({
  id: id(1),
  date,
  status: 'GENERATED',
  note: '중간고사 끝난 날',
  photos: stubPhotos(date),
  coverPhotoId: id(101),
  checkedItemIds: [id(301), id(302)],
  questions: stubQuestions(),
  aiDraft: STUB_DRAFT,
  aiUncertain: ['오랜만에 수다를 떨어서 홀가분했던 것 같다.'],
  finalContent: null,
  summary: null,
  excludedFromMemory: false,
  aiIndexStatus: 'NONE',
  confirmedAt: null,
  updatedAt: NOW,
});

// from~to 사이 3일에 하나씩 확정 일기가 있는 것처럼 만든다.
export const stubEntrySummaries = (
  from: string,
  to: string,
): EntrySummaryDto[] => {
  const items: EntrySummaryDto[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (
    let d = new Date(`${from}T00:00:00Z`), i = 0;
    d <= end && items.length < 366;
    d.setUTCDate(d.getUTCDate() + 1), i++
  ) {
    if (i % 3 !== 0) continue;
    const date = d.toISOString().slice(0, 10);
    items.push({
      id: id(1000 + i),
      date,
      status: 'CONFIRMED',
      coverPhotoUrl: photoUrl(date),
      summary: null,
      categoryColors: i % 2 ? ['#4CAF50', '#FF9800'] : ['#EC407A'],
    });
  }
  return items;
};

export const stubCategories = (): ChecklistCategoryDto[] => [
  {
    id: id(401),
    name: '운동',
    color: '#4CAF50',
    sortOrder: 0,
    items: [
      { id: id(301), label: '걷기', sortOrder: 0 },
      { id: id(303), label: '헬스', sortOrder: 1 },
    ],
  },
  {
    id: id(402),
    name: '식사',
    color: '#FF9800',
    sortOrder: 1,
    items: [
      { id: id(302), label: '외식', sortOrder: 0 },
      { id: id(304), label: '집밥', sortOrder: 1 },
    ],
  },
];
