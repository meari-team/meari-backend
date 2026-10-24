import { HttpStatus, Injectable } from '@nestjs/common';
import type { Schedule } from '@prisma/client';
import { daysBetween, fromDbDate, toDbDate } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import { isValidDateString } from '../common/pipes/parse-date.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateScheduleDto,
  ScheduleDto,
  UpdateScheduleDto,
} from './schedules.dto.js';

export const MAX_SCHEDULES_PER_DAY = 20;
const MAX_RANGE_DAYS = 366;

const notFound = () =>
  new AppException(
    'SCHEDULE_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '일정을 찾을 수 없어요.',
  );

const invalidDate = (field: string) =>
  new AppException(
    'VALIDATION_FAILED',
    HttpStatus.BAD_REQUEST,
    '날짜를 확인해 주세요.',
    [{ field, reasons: ['isDate'] }],
  );

// 날짜 → 시간(종일 먼저) → 등록순
export function compareSchedules(
  a: { date: string; time: string | null; createdAt: string },
  b: { date: string; time: string | null; createdAt: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.time !== b.time) {
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return a.time < b.time ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function toScheduleDto(s: Schedule): ScheduleDto {
  return {
    id: s.id,
    date: fromDbDate(s.date),
    title: s.title,
    time: s.time,
    createdAt: s.createdAt.toISOString(),
  };
}

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, from: string, to: string): Promise<ScheduleDto[]> {
    if (!isValidDateString(from)) throw invalidDate('from');
    if (!isValidDateString(to)) throw invalidDate('to');
    const days = daysBetween(from, to);
    if (!(days >= 0 && days < MAX_RANGE_DAYS)) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `기간은 ${MAX_RANGE_DAYS}일 이내여야 해요.`,
        [{ field: 'to', reasons: ['range'] }],
      );
    }
    const rows = await this.prisma.schedule.findMany({
      where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    });
    return rows.map(toScheduleDto).sort(compareSchedules);
  }

  // 일기 생성 때 쓰는 그날 일정 (시간순)
  async forDate(userId: string, date: string): Promise<ScheduleDto[]> {
    const rows = await this.prisma.schedule.findMany({
      where: { userId, date: toDbDate(date) },
    });
    return rows.map(toScheduleDto).sort(compareSchedules);
  }

  async create(userId: string, dto: CreateScheduleDto): Promise<ScheduleDto> {
    if (!isValidDateString(dto.date)) throw invalidDate('date');
    await this.assertRoom(userId, dto.date);
    const s = await this.prisma.schedule.create({
      data: {
        userId,
        date: toDbDate(dto.date),
        title: dto.title,
        time: dto.time ?? null,
      },
    });
    return toScheduleDto(s);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateScheduleDto,
  ): Promise<ScheduleDto> {
    const current = await this.findOwned(userId, id);
    if (dto.date !== undefined) {
      if (!isValidDateString(dto.date)) throw invalidDate('date');
      if (dto.date !== fromDbDate(current.date)) {
        await this.assertRoom(userId, dto.date);
      }
    }
    const s = await this.prisma.schedule.update({
      where: { id: current.id },
      data: {
        ...(dto.date !== undefined ? { date: toDbDate(dto.date) } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.time !== undefined ? { time: dto.time } : {}),
      },
    });
    return toScheduleDto(s);
  }

  async remove(userId: string, id: string): Promise<void> {
    const current = await this.findOwned(userId, id);
    await this.prisma.schedule.delete({ where: { id: current.id } });
  }

  // 남의 일정과 없는 일정을 구분하지 않는다 (둘 다 404)
  private async findOwned(userId: string, id: string) {
    const s = await this.prisma.schedule.findFirst({ where: { id, userId } });
    if (!s) throw notFound();
    return s;
  }

  private async assertRoom(userId: string, date: string) {
    const count = await this.prisma.schedule.count({
      where: { userId, date: toDbDate(date) },
    });
    if (count >= MAX_SCHEDULES_PER_DAY) {
      throw new AppException(
        'SCHEDULE_LIMIT_EXCEEDED',
        HttpStatus.UNPROCESSABLE_ENTITY,
        `일정은 하루 ${MAX_SCHEDULES_PER_DAY}개까지 등록할 수 있어요.`,
        { max: MAX_SCHEDULES_PER_DAY },
      );
    }
  }
}
