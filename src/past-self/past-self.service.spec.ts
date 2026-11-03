import { buildChatHistory, filterCitations } from './past-self.service.js';

describe('filterCitations (근거 재검증)', () => {
  const valid = [
    { id: 'e1', date: '2026-09-01' },
    { id: 'e2', date: '2026-09-05' },
  ];

  it('검증된 일기만 남기고 날짜순으로 정렬한다', () => {
    expect(
      filterCitations(
        [
          { diary_id: 'e2', diary_date: '2026-09-05' },
          { diary_id: 'other-users', diary_date: '2026-09-02' },
          { diary_id: 'e1', diary_date: '2026-09-01' },
        ],
        valid,
      ),
    ).toEqual([
      { entryId: 'e1', date: '2026-09-01' },
      { entryId: 'e2', date: '2026-09-05' },
    ]);
  });

  it('날짜는 AI가 준 값이 아니라 메인 DB 값을 쓴다', () => {
    expect(
      filterCitations([{ diary_id: 'e1', diary_date: '2099-01-01' }], valid),
    ).toEqual([{ entryId: 'e1', date: '2026-09-01' }]);
  });

  it('중복을 없애고, 남는 게 없으면 빈 배열', () => {
    expect(
      filterCitations(
        [
          { diary_id: 'e1', diary_date: '2026-09-01' },
          { diary_id: 'e1', diary_date: '2026-09-01' },
        ],
        valid,
      ),
    ).toHaveLength(1);
    expect(
      filterCitations([{ diary_id: 'x', diary_date: '2026-09-01' }], valid),
    ).toEqual([]);
  });
});

describe('buildChatHistory', () => {
  it('최신 10개만 시간순으로 전달한다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 ? 'USER' : 'ASSISTANT') as 'USER' | 'ASSISTANT',
      content: String(i),
    }));
    const result = buildChatHistory(rows);
    expect(result).toHaveLength(10);
    expect(result[0]).toEqual({ role: 'user', content: '9' });
    expect(result[9]).toEqual({ role: 'assistant', content: '0' });
    expect(rows[0].content).toBe('0');
  });
  it('20,000자를 넘기면 오래된 메시지를 자르지 않고 제외한다', () => {
    const rows = Array.from({ length: 8 }, () => ({
      role: 'USER' as const,
      content: '가'.repeat(5000),
    }));
    expect(buildChatHistory(rows)).toHaveLength(4);
    expect(buildChatHistory([])).toEqual([]);
  });
});

describe('PastSelfService history 전달', () => {
  it('소유권을 확인한 세션의 저장 메시지를 전달하고 현재 질문은 분리한다', async () => {
    const { PastSelfService } = await import('./past-self.service.js');
    const { ConfigService } = await import('@nestjs/config');
    const prisma = {
      chatSession: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ anchorDate: new Date('2026-10-20T00:00:00Z') }),
      },
      chatMessage: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { role: 'ASSISTANT', content: '어려웠어.' },
          { role: 'USER', content: 'NCS 공부는 어땠어?' },
        ]),
      },
    };
    const ai = {
      pastChat: vi.fn().mockRejectedValue(new Error('stop-after-capture')),
    };
    const service = new PastSelfService(
      prisma as unknown as import('../prisma/prisma.service.js').PrismaService,
      ai as unknown as import('../ai-client/ai-client.service.js').AiClient,
      new ConfigService(),
    );
    await expect(
      service.send('owner', 'session', '왜 그랬어?'),
    ).rejects.toThrow('stop-after-capture');
    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session', userId: 'owner' },
    });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { role: true, content: true },
    });
    expect(ai.pastChat).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'owner',
        message: '왜 그랬어?',
        history: [
          { role: 'user', content: 'NCS 공부는 어땠어?' },
          { role: 'assistant', content: '어려웠어.' },
        ],
      }),
    );
    prisma.chatSession.findFirst.mockResolvedValue(null);
    prisma.chatMessage.findMany.mockClear();
    ai.pastChat.mockClear();
    await expect(service.send('other', 'session', '몰래')).rejects.toThrow();
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
    expect(ai.pastChat).not.toHaveBeenCalled();
  });
});
