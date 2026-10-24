import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChecklistCategory, ChecklistItem } from '@prisma/client';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChecklistCategoryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './checklist.dto.js';

const MAX_CATEGORIES = 20;

const categoryNotFound = () =>
  new AppException(
    'CATEGORY_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '카테고리를 찾을 수 없어요.',
  );

function toDto(
  c: ChecklistCategory & { items: ChecklistItem[] },
): ChecklistCategoryDto {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    sortOrder: c.sortOrder,
    items: [...c.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ id: i.id, label: i.label, sortOrder: i.sortOrder })),
  };
}

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ChecklistCategoryDto[]> {
    const categories = await this.prisma.checklistCategory.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
      include: { items: true },
    });
    return categories.map(toDto);
  }

  // C2: 맨 뒤에 추가
  async create(
    userId: string,
    dto: CreateCategoryDto,
  ): Promise<ChecklistCategoryDto> {
    const count = await this.prisma.checklistCategory.count({
      where: { userId },
    });
    if (count >= MAX_CATEGORIES) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `카테고리는 ${MAX_CATEGORIES}개까지 만들 수 있어요.`,
        [{ field: 'name', reasons: ['maxCategories'] }],
      );
    }
    const last = await this.prisma.checklistCategory.findFirst({
      where: { userId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const category = await this.prisma.checklistCategory.create({
      data: {
        userId,
        name: dto.name,
        color: dto.color.toUpperCase(),
        sortOrder: (last?.sortOrder ?? -1) + 1,
        items: {
          create: dto.items.map((label, i) => ({
            label: label.trim(),
            sortOrder: i,
          })),
        },
      },
      include: { items: true },
    });
    return toDto(category);
  }

  // C3: items를 보내면 전체 교체. id가 있으면 그 항목을 유지(이름·순서만 바뀜, 과거 체크 기록 보존),
  // 빠진 항목은 삭제(그 항목의 과거 체크도 함께 삭제)
  async update(
    userId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<ChecklistCategoryDto> {
    const category = await this.findOwned(userId, categoryId);

    if (dto.items) {
      const ownIds = new Set(category.items.map((i) => i.id));
      const keepIds = dto.items.flatMap((i) => (i.id ? [i.id] : []));
      if (
        keepIds.some((id) => !ownIds.has(id)) ||
        new Set(keepIds).size !== keepIds.length
      ) {
        throw new AppException(
          'VALIDATION_FAILED',
          HttpStatus.BAD_REQUEST,
          '항목을 확인해 주세요.',
          [{ field: 'items', reasons: ['unknownOrDuplicateItem'] }],
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.checklistCategory.update({
        where: { id: categoryId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined
            ? { color: dto.color.toUpperCase() }
            : {}),
        },
      });
      if (dto.items) {
        const keepIds = dto.items.flatMap((i) => (i.id ? [i.id] : []));
        await tx.checklistItem.deleteMany({
          where: { categoryId, id: { notIn: keepIds } },
        });
        for (const [i, item] of dto.items.entries()) {
          if (item.id) {
            await tx.checklistItem.update({
              where: { id: item.id },
              data: { label: item.label, sortOrder: i },
            });
          } else {
            await tx.checklistItem.create({
              data: { categoryId, label: item.label, sortOrder: i },
            });
          }
        }
      }
      return tx.checklistCategory.findUniqueOrThrow({
        where: { id: categoryId },
        include: { items: true },
      });
    });
    return toDto(updated);
  }

  // C4: 항목과 과거 체크 기록까지 함께 삭제 (cascade)
  async remove(userId: string, categoryId: string): Promise<void> {
    await this.findOwned(userId, categoryId);
    await this.prisma.checklistCategory.delete({ where: { id: categoryId } });
  }

  private async findOwned(userId: string, categoryId: string) {
    const category = await this.prisma.checklistCategory.findFirst({
      where: { id: categoryId, userId },
      include: { items: true },
    });
    if (!category) throw categoryNotFound();
    return category;
  }
}
