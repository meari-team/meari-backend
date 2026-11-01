-- 메아리: 기억하고 싶은 날(북마크) · 메아리 설정 · 푸시 토큰 · 도착한 메아리
-- CreateEnum
CREATE TYPE "EchoFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "EchoMessageSource" AS ENUM ('AI', 'FALLBACK');

-- CreateEnum
CREATE TYPE "EchoPushStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'NO_TOKEN', 'SKIPPED');

-- AlterTable
ALTER TABLE "entries" ADD COLUMN     "bookmarked_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "echo_settings" (
    "user_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "EchoFrequency" NOT NULL DEFAULT 'WEEKLY',
    "weekday" SMALLINT NOT NULL DEFAULT 0,
    "month_day" SMALLINT NOT NULL DEFAULT 1,
    "minute_of_day" SMALLINT NOT NULL DEFAULT 1260,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
    "show_preview" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "echo_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "token" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "echoes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "slot_key" VARCHAR(64) NOT NULL,
    "session_id" UUID,
    "message" TEXT NOT NULL,
    "source" "EchoMessageSource" NOT NULL,
    "citations" JSONB NOT NULL,
    "entry_version" TIMESTAMPTZ NOT NULL,
    "read_at" TIMESTAMPTZ,
    "push_status" "EchoPushStatus" NOT NULL DEFAULT 'PENDING',
    "push_attempts" SMALLINT NOT NULL DEFAULT 0,
    "push_error" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "echoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "echo_settings_next_run_at_idx" ON "echo_settings"("next_run_at");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "echoes_session_id_key" ON "echoes"("session_id");

-- CreateIndex
CREATE INDEX "echoes_user_id_created_at_idx" ON "echoes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "echoes_entry_id_idx" ON "echoes"("entry_id");

-- CreateIndex
CREATE INDEX "echoes_push_status_idx" ON "echoes"("push_status");

-- CreateIndex
CREATE UNIQUE INDEX "echoes_user_id_slot_key_key" ON "echoes"("user_id", "slot_key");

-- AddForeignKey
ALTER TABLE "echo_settings" ADD CONSTRAINT "echo_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echoes" ADD CONSTRAINT "echoes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echoes" ADD CONSTRAINT "echoes_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echoes" ADD CONSTRAINT "echoes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

