// 메아리 첫 메시지와 알림 문구. 순수 함수라 DB 없이 테스트한다.
// 첫 메시지는 고른 일기를 주된 근거로, 그날의 나가 먼저 거는 짧은 연락이다.
// - 근거(그 일기)를 인용하지 않은 AI 답은 버리고 검증된 기본 문구를 쓴다
// - 기록에 없는 일·지금의 사용자에 대한 짐작을 넣지 않도록, AI 답은 앞 두 문장만 쓰고 질문은 고정 문구로 붙인다

const MAX_AI_SENTENCES = 2;
const MAX_AI_LENGTH = 220;
const PREVIEW_LENGTH = 60;

export const ECHO_TITLE = '기억하고 싶었던 하루가 찾아왔어요';
export const ECHO_QUESTION = '그날을 다시 떠올려 보면 어때?';

const md = (date: string) =>
  `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;

// 알림 발신자: 2026.10.18의 나
export const echoSender = (date: string) => `${date.replaceAll('-', '.')}의 나`;

// AI(과거의 나)에게 보내는 요청. 날짜를 넣어 그날 일기를 찾게 한다
export const echoPrompt = (date: string) =>
  `${md(date)}에 있었던 일을 짧게 이야기해 줘.`;

export function fallbackMessage(date: string, hasPhotos: boolean): string {
  return hasPhotos
    ? `${md(date)}의 나야. 이날 이 사진을 남겼어. 이 순간을 함께 돌아볼래?`
    : `${md(date)}의 나야. 이날 일기를 남겼어. 이 하루를 함께 돌아볼래?`;
}

const sentences = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export type EchoMessage = { message: string; source: 'AI' | 'FALLBACK' };

export function composeEchoMessage(input: {
  date: string;
  hasPhotos: boolean;
  // AI 답. 실패했으면 null
  ai: { answer: string; citedEntryIds: string[] } | null;
  entryId: string;
}): EchoMessage {
  const { date, hasPhotos, ai, entryId } = input;
  const fallback = {
    message: fallbackMessage(date, hasPhotos),
    source: 'FALLBACK' as const,
  };
  // 고른 일기를 근거로 삼지 않은 답은 쓰지 않는다
  if (!ai || !ai.citedEntryIds.includes(entryId)) return fallback;

  const body = ai.answer
    .trim()
    // 과거의 나 답의 머리말 ("내 기록을 보면," 등)과 날짜 머리 ("10월 18일에는")
    .replace(
      /^(내 기록을 보면|그때 일기를 보면|그때 고민을 떠올려 보면),\s*/,
      '',
    )
    .replace(new RegExp(`^${md(date)}에는\\s*`), '');
  const picked = sentences(body)
    // 질문은 고정 문구 하나만
    .filter((s) => !s.endsWith('?'))
    .slice(0, MAX_AI_SENTENCES);
  const text = picked.join(' ');
  if (picked.length === 0 || text.length > MAX_AI_LENGTH) return fallback;

  return {
    message: `${md(date)}의 나야. 이날은 ${text} ${ECHO_QUESTION}`,
    source: 'AI',
  };
}

export const previewOf = (message: string) => {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH
    ? `${flat.slice(0, PREVIEW_LENGTH)}…`
    : flat;
};

export type EchoPushContent = {
  title: string;
  subtitle: string;
  body: string;
};

// 잠금 화면에 일기 내용이 드러나지 않게 기본은 일반 문구. 사용자가 고르면 메시지 미리보기
// iOS는 부제(subtitle)에 발신자를 따로 보여 주고, 안드로이드는 부제가 없어 본문 앞에 붙인다
export function echoPushContent(input: {
  date: string;
  message: string;
  showPreview: boolean;
  platform: string;
}): EchoPushContent {
  const sender = echoSender(input.date);
  const text = input.showPreview
    ? previewOf(input.message)
    : '메시지가 도착했어요. 눌러서 확인해 보세요.';
  return {
    title: ECHO_TITLE,
    subtitle: sender,
    body: input.platform === 'ios' ? text : `${sender} · ${text}`,
  };
}
