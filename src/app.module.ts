import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiClientModule } from './ai-client/ai-client.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChecklistModule } from './checklist/checklist.module.js';
import { validateEnv } from './config/env.js';
import { EntriesModule } from './entries/entries.module.js';
import { HealthController } from './health/health.controller.js';
import { MemorySyncModule } from './memory-sync/memory-sync.module.js';
import { PastSelfModule } from './past-self/past-self.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SchedulesModule } from './schedules/schedules.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AiClientModule,
    StorageModule,
    MemorySyncModule,
    AuthModule,
    UsersModule,
    ChecklistModule,
    EntriesModule,
    PastSelfModule,
    SchedulesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
