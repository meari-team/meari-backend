import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiClient } from '../ai-client/ai-client.service.js';
import type {
  ChecklistInput,
  ImageAnalysis,
} from '../ai-client/ai-client.types.js';
import { toDbDate } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import type {
  AnalyzeResultDto,
  AnswersDto,
  ConfirmDto,
  EntryDto,
  UpdateMemoryDto,
  GenerateDto,
  GenerateResultDto,
} from '../entries/entries.dto.js';
import { EntriesService } from '../entries/entries.service.js';
import { entryNotFound } from '../entries/entries.service.js';
import { assertCanDo } from '../entries/entry-state.js';
import { toQuestionDto } from '../entries/entry.mapper.js';
import { MemorySyncService } from '../memory-sync/memory-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotoStorage } from '../storage/photo-storage.js';

const MAX_QUESTIONS = 2; // AI 서버 계약

const generationInclude = {
  photos: { orderBy: { sortOrder: 'asc' } },
  questions: { orderBy: { sortOrder: 'asc' } },
  checks: {
    select: {
      item: { select: { label: true, category: { select: { name: true } } } },
    },
  },
} satisfies Prisma.EntryInclude;

type EntryForGeneration = Prisma.EntryGetPayload<{
  include: typeof generationInclude;
}>;

// AI에 보낼 설명: 하루 한 줄 설명 + 사진별 캡션
export function describeEntry(entry: {
  note: string | null;
  photos: { caption: string | null }[];
}): string {
  return [
    entry.note,
    ...entry.photos.map((p, i) =>
      p.caption ? `사진 ${i + 1}: ${p.caption}` : null,
    ),
  ]
    .filter((line): line is string => !!line)
    .join('\n');
}

// 체크한 항목만 "카테고리/항목": true 로 평탄화 (erd.md)
export function checklistOf(entry: {
  checks: { item: { label: string; category: { name: string } } }[];
}): ChecklistInput {
  return Object.fromEntries(
    entry.checks.map((c) => [`${c.item.category.name}/${c.item.label}`, true]),
  );
}

@Injectable()
export class GenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PhotoStorage,
    private readonly ai: AiClient,
    private readonly entries: EntriesService,
    private readonly memorySync: MemorySyncService,
  ) {}

  // G1: 사진 분석(캐시) → 추가 질문 0~2개
  async analyze(userId: string, date: string): Promise<AnalyzeResultDto> {
    const entry = await this.load(userId, date);
    assertCanDo('analyze', entry.status);
    if (entry.photos.length === 0) {
      throw new AppException(
        'PHOTO_REQUIRED',
        HttpStatus.UNPROCESSABLE_ENTITY,
        '사진을 1장 이상 올려 주세요.',
      );
    }

    const description = describeEntry(entry);
    const analysis =
      (entry.imageAnalysis as ImageAnalysis | null) ??
      (await this.analyzeAndCache(entry, description));

    const result = await this.ai.clarify({
      image_analysis: analysis,
      description: description || null,
      checklist: checklistOf(entry),
      diary_date: date,
    });
    const questions = result.questions.slice(0, MAX_QUESTIONS);

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.entryQuestion.deleteMany({ where: { entryId: entry.id } });
      await tx.entryQuestion.createMany({
        data: questions.map((q, i) => ({
          entryId: entry.id,
          aiQuestionId: q.id,
          question: q.question,
          reason: q.reason,
          sortOrder: i,
        })),
      });
      await tx.entry.update({
        where: { id: entry.id },
        data: { status: questions.length > 0 ? 'QUESTIONING' : 'READY' },
      });
      return tx.entryQuestion.findMany({
        where: { entryId: entry.id },
        orderBy: { sortOrder: 'asc' },
      });
    });

    return {
      status: saved.length > 0 ? 'QUESTIONING' : 'READY',
      questions: saved.map(toQuestionDto),
    };
  }

  // G2: 답변·건너뛰기. 모든 질문이 처리되면 READY
  async answer(
    userId: string,
    date: string,
    dto: AnswersDto,
  ): Promise<AnalyzeResultDto> {
    const entry = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!entry) throw entryNotFound();
    assertCanDo('answer', entry.status);

    const known = new Set(entry.questions.map((q) => q.id));
    for (const a of dto.answers) {
      if (!known.has(a.questionId) || (a.skipped && a.answer !== undefined)) {
        throw new AppException(
          'VALIDATION_FAILED',
          HttpStatus.BAD_REQUEST,
          '답변 형식을 확인해 주세요.',
          [
            {
              field: 'answers',
              reasons: [
                known.has(a.questionId)
                  ? 'answerAndSkipped'
                  : 'unknownQuestion',
              ],
            },
          ],
        );
      }
    }

    const questions = await this.prisma.$transaction(async (tx) => {
      for (const a of dto.answers) {
        await tx.entryQuestion.update({
          where: { id: a.questionId },
          data: a.skipped
            ? { answer: null, skipped: true }
            : { answer: a.answer ?? null, skipped: false },
        });
      }
      const updated = await tx.entryQuestion.findMany({
        where: { entryId: entry.id },
        orderBy: { sortOrder: 'asc' },
      });
      const done = updated.every((q) => q.skipped || q.answer !== null);
      if (done) {
        await tx.entry.update({
          where: { id: entry.id },
          data: { status: 'READY' },
        });
      }
      return updated;
    });

    const done = questions.every((q) => q.skipped || q.answer !== null);
    return {
      status: done ? 'READY' : 'QUESTIONING',
      questions: questions.map(toQuestionDto),
    };
  }

  // G3: 초안 생성. 자동 저장·색인하지 않는다 (확정은 G4)
  async generate(
    userId: string,
    date: string,
    dto: GenerateDto,
  ): Promise<GenerateResultDto> {
    let entry = await this.load(userId, date);
    assertCanDo(
      dto.skipRemainingQuestions ? 'skipAndGenerate' : 'generate',
      entry.status,
    );
    if (entry.photos.length === 0) {
      throw new AppException(
        'PHOTO_REQUIRED',
        HttpStatus.UNPROCESSABLE_ENTITY,
        '사진을 1장 이상 올려 주세요.',
      );
    }

    // "그냥 생성": 아직 처리하지 않은 질문은 건너뛴 것으로 남긴다
    if (dto.skipRemainingQuestions) {
      await this.prisma.entryQuestion.updateMany({
        where: { entryId: entry.id, answer: null, skipped: false },
        data: { skipped: true },
      });
      entry = await this.load(userId, date);
    }

    const description = describeEntry(entry);
    const analysis =
      (entry.imageAnalysis as ImageAnalysis | null) ??
      (await this.analyzeAndCache(entry, description));
    const answers = Object.fromEntries(
      entry.questions.map((q) => [q.aiQuestionId, q.skipped ? null : q.answer]),
    );

    const { content } = await this.ai.generateDiary({
      diary_date: date,
      image_analysis: analysis,
      description: description || null,
      checklist: checklistOf(entry),
      clarification_answers: entry.questions.length > 0 ? answers : null,
    });

    const coverPhotoId = entry.coverPhotoId ?? entry.photos[0].id;
    await this.prisma.entry.update({
      where: { id: entry.id },
      data: {
        aiDraft: content,
        aiUncertain: [], // AI-3(추정 문장)이 붙으면 채운다
        coverPhotoId,
        status: 'GENERATED',
      },
    });
    return {
      status: 'GENERATED',
      aiDraft: content,
      aiUncertain: [],
      coverPhotoId,
    };
  }

  // G4: 확정. 확정본만 기억이 된다 → PENDING으로 표시하고 응답 후 뒤에서 색인한다
  async confirm(
    userId: string,
    date: string,
    dto: ConfirmDto,
  ): Promise<EntryDto> {
    const entry = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      select: { id: true, status: true, excludedFromMemory: true },
    });
    if (!entry) throw entryNotFound();
    assertCanDo('confirm', entry.status);

    await this.prisma.entry.update({
      where: { id: entry.id },
      data: {
        finalContent: dto.finalContent,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        aiIndexStatus: entry.excludedFromMemory ? 'NONE' : 'PENDING',
        aiIndexError: null,
      },
    });
    // 응답(PENDING)을 먼저 만든 뒤 색인을 시작한다
    const confirmed = await this.entries.get(userId, date);
    if (!entry.excludedFromMemory) this.memorySync.schedule(entry.id);
    return confirmed;
  }

  // G5: 기억에서 제외/복원. 제외는 AI 기억을 먼저 지워야 성공 (실패 시 503, 상태 유지)
  async setMemory(
    userId: string,
    date: string,
    dto: UpdateMemoryDto,
  ): Promise<EntryDto> {
    const entry = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      select: { id: true, status: true, excludedFromMemory: true },
    });
    if (!entry) throw entryNotFound();
    if (entry.status !== 'CONFIRMED') {
      throw new AppException(
        'INVALID_ENTRY_STATE',
        HttpStatus.CONFLICT,
        '확정된 일기만 기억에서 제외할 수 있어요.',
        { status: entry.status, action: 'memory' },
      );
    }

    if (dto.excluded) {
      await this.memorySync.exclusive(entry.id, async () => {
        await this.ai.deleteDiaryIndex(userId, entry.id);
        await this.prisma.entry.update({
          where: { id: entry.id },
          data: {
            excludedFromMemory: true,
            aiIndexStatus: 'NONE',
            aiIndexError: null,
          },
        });
      });
      return this.entries.get(userId, date);
    }

    await this.prisma.entry.update({
      where: { id: entry.id },
      data: {
        excludedFromMemory: false,
        aiIndexStatus: 'PENDING',
        aiIndexError: null,
      },
    });
    const restored = await this.entries.get(userId, date);
    this.memorySync.schedule(entry.id);
    return restored;
  }

  private async load(
    userId: string,
    date: string,
  ): Promise<EntryForGeneration> {
    const entry = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      include: generationInclude,
    });
    if (!entry) throw entryNotFound();
    return entry;
  }

  // 사진 분석 결과는 저장해 두고 재사용한다 (사진이 바뀌면 PhotosService가 비운다)
  private async analyzeAndCache(
    entry: EntryForGeneration,
    description: string,
  ): Promise<ImageAnalysis> {
    const images = await Promise.all(
      entry.photos.map(async (p) => ({
        buffer: await this.storage.read(p.storageKey),
        filename: `${p.id}.jpg`,
        mimetype: 'image/jpeg' as const,
      })),
    );
    const analysis = await this.ai.analyzeImages(images, description);
    await this.prisma.entry.update({
      where: { id: entry.id },
      data: { imageAnalysis: analysis as unknown as Prisma.InputJsonObject },
    });
    return analysis;
  }
}
