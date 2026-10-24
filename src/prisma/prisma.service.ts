import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// 연결은 첫 쿼리 때 맺는다(lazy). DB 없이도 앱·유닛 테스트가 뜨게 하기 위함.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
