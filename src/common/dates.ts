// DB의 @db.Date는 UTC 자정 Date로 오간다. 앱과는 KST 기록일 문자열(YYYY-MM-DD)로 주고받는다.
export const toDbDate = (date: string) => new Date(`${date}T00:00:00Z`);

export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string) =>
  (toDbDate(to).getTime() - toDbDate(from).getTime()) / (24 * 60 * 60 * 1000);
