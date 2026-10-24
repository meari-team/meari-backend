// 회원가입 시 기본으로 만들어 주는 체크리스트 (기획안: 운동·식사·수면·학습/업무·사람·기분)
export const DEFAULT_CHECKLIST = [
  { name: '운동', color: '#4CAF50', items: ['걷기', '러닝', '헬스', '요가'] },
  { name: '식사', color: '#FF9800', items: ['집밥', '외식', '카페', '야식'] },
  { name: '수면', color: '#5C6BC0', items: ['일찍 잠', '늦게 잠', '낮잠'] },
  {
    name: '학습/업무',
    color: '#29B6F6',
    items: ['수업', '공부', '과제', '업무'],
  },
  { name: '사람', color: '#EC407A', items: ['가족', '친구', '연인', '동료'] },
  { name: '기분', color: '#FFCA28', items: ['좋음', '보통', '피곤', '힘듦'] },
] as const;

export function defaultChecklistCreateInput() {
  return DEFAULT_CHECKLIST.map((category, i) => ({
    name: category.name,
    color: category.color,
    sortOrder: i,
    items: {
      create: category.items.map((label, j) => ({ label, sortOrder: j })),
    },
  }));
}
