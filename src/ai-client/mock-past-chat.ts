// 가짜 AI(AI_MOCK)의 과거의 나 대답: 실제로 저장된 확정 일기(기준일까지)를 읽어서 답한다.
// 순수 함수라 DB 없이 테스트한다. 일기 고르기 → 반말로 바꾸기 → 참고한 기록(references)

export type MockDiary = {
  id: string;
  date: string; // YYYY-MM-DD
  content: string; // 확정본
  note: string | null; // 한 줄 설명
};

export type MockPastChatAnswer = {
  answer: string;
  references: { diary_id: string; diary_date: string }[];
};

const MAX_PICK = 2;

const md = (date: string) =>
  `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// 일기 문장(…했다.)을 그때의 나 말투(…했어.)로.
// 받침이 ㅆ·ㅄ인 글자 + 다 (했다·봤다·있다·없다) → 어, 하다 → 해, 이다 → 이야, 된다 → 돼, 한다 → 해
const END = '(?=[.!?…]|$)';
export function toCasual(sentence: string): string {
  return sentence
    .replace(new RegExp(`하다${END}`, 'g'), '해')
    .replace(new RegExp(`이다${END}`, 'g'), '이야')
    .replace(new RegExp(`된다${END}`, 'g'), '돼')
    .replace(new RegExp(`한다${END}`, 'g'), '해')
    .replace(new RegExp(`([가-힣])다${END}`, 'g'), (whole, ch: string) => {
      const jong = (ch.charCodeAt(0) - 0xac00) % 28;
      return jong === 20 || jong === 18 ? `${ch}어` : whole;
    });
}

const sentences = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

// 비슷한 말도 같이 찾는다 (예: 고민을 물으면 걱정·불안이 적힌 일기도)
const SYNONYMS: Record<string, string[]> = {
  고민: ['걱정', '불안', '고민'],
  걱정: ['걱정', '불안', '고민'],
  기분: ['기분', '마음', '뿌듯', '즐거', '행복', '피곤', '좋았'],
  마음: ['기분', '마음', '뿌듯', '즐거', '행복'],
  친구: ['친구', '동료', '팀원'],
  팀: ['팀', '팀원', '회의'],
};

// 질문에서 뜻 있는 낱말만 (두 글자 이상, 흔한 조사·어미 떼기) + 비슷한 말
function keywords(message: string): string[] {
  const stop = new Set([
    '그때',
    '그날',
    '나는',
    '내가',
    '뭐야',
    '어때',
    '있어',
    '했어',
    '뭐했어',
    '요즘',
    '어떻게',
    '무슨',
    '있었',
  ]);
  const words = message
    .replace(/[?!.,~]/g, ' ')
    .split(/\s+/)
    .map((w) =>
      w.replace(/(은|는|이|가|을|를|에|에서|랑|하고|도|야|어|니|지)$/, ''),
    )
    .filter((w) => w.length >= 1 && !stop.has(w));
  const out = new Set<string>();
  for (const w of words) {
    const syn = Object.entries(SYNONYMS).find(([k]) => w.startsWith(k));
    if (syn) syn[1].forEach((x) => out.add(x));
    else if (w.length >= 2) out.add(w);
  }
  return [...out];
}

// 질문이 가리키는 날짜 범위: "10월 11일", "어제", "일주일 전/지난주"
function mentionedDates(message: string, target: string): string[] | null {
  const m = message.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) {
    const date = `${target.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return [date];
  }
  if (/어제/.test(message)) return [addDays(target, -1)];
  if (/일주일|지난\s*주|한\s*주/.test(message)) {
    return Array.from({ length: 7 }, (_, i) => addDays(target, -(i + 1)));
  }
  return null;
}

export function mockPastChat(
  message: string,
  target: string,
  diaries: MockDiary[], // 기준일까지, 최신순
): MockPastChatAnswer {
  if (diaries.length === 0) {
    return {
      answer: `${md(target)}까지는 남겨 둔 일기가 아직 없어서 해 줄 이야기가 없네.`,
      references: [],
    };
  }

  let picked: MockDiary[];
  const dates = mentionedDates(message, target);
  if (dates) {
    picked = diaries.filter((d) => dates.includes(d.date)).slice(0, MAX_PICK);
    if (picked.length === 0) {
      return {
        answer: `${md(dates[0])}${dates.length > 1 ? ' 무렵' : ''}에는 특별히 남겨 둔 기록이 없어서 잘 모르겠어.`,
        references: [],
      };
    }
  } else {
    const words = keywords(message);
    const scored = diaries
      .map((d) => ({
        d,
        score: words.filter((w) => `${d.note ?? ''} ${d.content}`.includes(w))
          .length,
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || (a.d.date < b.d.date ? 1 : -1));
    // 가장 잘 맞는 일기만. 맞는 일기가 없으면 가장 최근 기록으로 "요즘의 나"를 이야기한다
    const best = scored[0]?.score ?? 0;
    picked = (
      scored.length > 0
        ? scored.filter((s) => s.score === best).map((s) => s.d)
        : diaries
    ).slice(0, MAX_PICK);
  }

  const lead = /기분|감정|마음/.test(message)
    ? '그때 일기를 보면,'
    : /고민|걱정|불안/.test(message)
      ? '그때 고민을 떠올려 보면,'
      : '내 기록을 보면,';
  const tail = /기분|감정|마음/.test(message)
    ? '돌아보면 바빴어도 마음은 꽤 괜찮았던 것 같아.'
    : /고민|걱정|불안/.test(message)
      ? '그래도 하나씩 해 나가고 있었어.'
      : '';

  // 오래된 날부터 이야기한다
  const parts = [...picked]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => {
      const s = sentences(d.content).slice(0, 2).map(toCasual).join(' ');
      return `${md(d.date)}에는 ${s}`;
    });

  return {
    answer: [lead, ...parts, tail].filter(Boolean).join(' '),
    references: picked.map((d) => ({ diary_id: d.id, diary_date: d.date })),
  };
}
