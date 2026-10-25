// 시연 계정을 만든다: test@test.com / test, 일기 90편(2026-04-01 ~ 10-25, 체크리스트 포함)과 일정.
//   npm run seed:demo            # 없으면 만든다 (이미 있으면 아무것도 바꾸지 않는다)
//   npm run seed:demo -- --reset # 있으면 탈퇴 처리(AI 기억까지 삭제) 후 처음 상태로 다시 만든다
// 오늘(KST) 이후 날짜의 일기는 넣지 않는다 — 시연 때 오늘 일기는 직접 쓴다.
// 만든 일기는 확정 상태로 넣고 끝에서 AI 기억 저장까지 한다. AI 서버가 꺼져 있으면
// 기억 저장만 실패로 남으니, AI 서버를 켠 뒤 `npm run memory:reindex`로 다시 하면 된다.
import { NestFactory } from '@nestjs/core';
import { hash } from 'bcryptjs';

process.env.MEMORY_SYNC_ON_BOOT = 'false';

const { AppModule } = await import('../app.module.js');
const { PrismaService } = await import('../prisma/prisma.service.js');
const { UsersService } = await import('../users/users.service.js');
const { MemorySyncService } =
  await import('../memory-sync/memory-sync.service.js');
const { defaultChecklistCreateInput } =
  await import('../checklist/default-checklist.js');
const { toDbDate } = await import('../common/dates.js');
const {
  DEMO_EMAIL,
  DEMO_NICKNAME,
  DEMO_PASSWORD,
  DEMO_SCHEDULES,
  entriesBefore,
  firstSentence,
} = await import('./demo-data.js');

const reset = process.argv.includes('--reset');
const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['warn', 'error'],
});
const prisma = app.get(PrismaService);

try {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
  });
  if (existing && !reset) {
    console.log(
      `이미 시연 계정(${DEMO_EMAIL})이 있어 그대로 둡니다. 처음 상태로 다시 만들려면: npm run seed:demo -- --reset`,
    );
    await app.close();
    process.exit(0);
  }
  if (existing) {
    // 탈퇴와 같은 순서: AI 기억을 먼저 지우고, 실패하면 아무것도 지우지 않는다
    await app.get(UsersService).withdraw(existing.id);
    console.log('기존 시연 계정을 지웠습니다 (AI 기억 포함).');
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await hash(DEMO_PASSWORD, 10),
      nickname: DEMO_NICKNAME,
      categories: { create: defaultChecklistCreateInput() },
    },
  });
  const items = await prisma.checklistItem.findMany({
    where: { category: { userId: user.id } },
    select: { id: true, label: true },
  });
  const itemId = new Map(items.map((i) => [i.label, i.id]));

  const entries = entriesBefore(todayKst);
  for (const [date, note, content, checks] of entries) {
    await prisma.entry.create({
      data: {
        userId: user.id,
        entryDate: toDbDate(date),
        status: 'CONFIRMED',
        note,
        finalContent: content,
        summary: firstSentence(content),
        confirmedAt: new Date(`${date}T23:00:00+09:00`),
        aiIndexStatus: 'PENDING',
        checks: {
          create: checks.map((label) => ({ itemId: itemId.get(label)! })),
        },
      },
    });
  }
  await prisma.schedule.createMany({
    data: DEMO_SCHEDULES.map(([date, title, time, completed]) => ({
      userId: user.id,
      date: toDbDate(date),
      title,
      time,
      completed,
    })),
  });
  console.log(
    `시연 계정을 만들었습니다: ${DEMO_EMAIL} / ${DEMO_PASSWORD} — 일기 ${entries.length}편, 일정 ${DEMO_SCHEDULES.length}개`,
  );

  const result = await app.get(MemorySyncService).reindex();
  console.log(
    result.failed > 0
      ? `AI 기억 저장: ${result.indexed}편 성공, ${result.failed}편 실패 — AI 서버를 켠 뒤 npm run memory:reindex`
      : `AI 기억 저장: ${result.indexed}편 완료`,
  );
} finally {
  await app.close();
}
