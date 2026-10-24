import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ChecklistCategoryDto } from './checklist.dto.js';

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ChecklistCategoryDto[]> {
    const categories = await this.prisma.checklistCategory.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      sortOrder: c.sortOrder,
      items: c.items.map((i) => ({
        id: i.id,
        label: i.label,
        sortOrder: i.sortOrder,
      })),
    }));
  }
}
