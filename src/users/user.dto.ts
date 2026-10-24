import type { DiaryStyle, User } from '@prisma/client';

export type UserDto = {
  id: string;
  email: string;
  nickname: string;
  diaryStyle: DiaryStyle;
  createdAt: string;
};

// 응답에 나가는 필드를 명시적으로 고른다. passwordHash는 절대 포함하지 않는다.
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    diaryStyle: user.diaryStyle,
    createdAt: user.createdAt.toISOString(),
  };
}
