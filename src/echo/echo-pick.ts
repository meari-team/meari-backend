// 메아리로 보낼 일기 고르기. 순수 함수라 DB 없이 테스트한다.
// - 덜 보낸 일기부터 (한 번도 안 보낸 일기가 있으면 그중에서)
// - 다 한 번씩 보냈으면 다시 섞되, 후보가 여럿이면 바로 전에 보낸 일기는 연속으로 고르지 않는다
// - 후보가 하나면 같은 일기를 또 보낼 수 있다

export function pickEchoEntry(
  candidates: string[],
  // 지금까지 보낸 일기 id (최근 것부터)
  sentHistory: string[],
  random: () => number = Math.random,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const counts = new Map(candidates.map((id) => [id, 0]));
  for (const id of sentHistory) {
    if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const last = sentHistory.find((id) => counts.has(id));
  const pool = candidates.filter((id) => id !== last);
  const min = Math.min(...pool.map((id) => counts.get(id) ?? 0));
  const least = pool.filter((id) => counts.get(id) === min);
  return least[Math.floor(random() * least.length)] ?? least[0];
}
