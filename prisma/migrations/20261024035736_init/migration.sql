-- CreateEnum
CREATE TYPE "DiaryStyle" AS ENUM ('PLAIN', 'EMOTIONAL', 'SUMMARY');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('DRAFT', 'QUESTIONING', 'READY', 'GENERATED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AiIndexStatus" AS ENUM ('NONE', 'PENDING', 'INDEXED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ChatFlag" AS ENUM ('NONE', 'NO_EVIDENCE', 'LEAK_BLOCKED', 'CRISIS');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "nickname" VARCHAR(20) NOT NULL,
    "diary_style" "DiaryStyle" NOT NULL DEFAULT 'PLAIN',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(200),
    "image_analysis" JSONB,
    "ai_draft" TEXT,
    "ai_uncertain" JSONB,
    "final_content" TEXT,
    "summary" VARCHAR(300),
    "cover_photo_id" UUID,
    "excluded_from_memory" BOOLEAN NOT NULL DEFAULT false,
    "ai_index_status" "AiIndexStatus" NOT NULL DEFAULT 'NONE',
    "ai_index_error" VARCHAR(50),
    "confirmed_at" TIMESTAMPTZ,
    "ai_indexed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "caption" VARCHAR(100),
    "sort_order" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_questions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "ai_question_id" VARCHAR(40) NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "options" JSONB,
    "answer" VARCHAR(2000),
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "entry_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "color" CHAR(7) NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "label" VARCHAR(20) NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_checks" (
    "entry_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,

    CONSTRAINT "entry_checks_pkey" PRIMARY KEY ("entry_id","item_id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "anchor_date" DATE NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "flag" "ChatFlag" NOT NULL DEFAULT 'NONE',
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "entries_cover_photo_id_key" ON "entries"("cover_photo_id");

-- CreateIndex
CREATE UNIQUE INDEX "entries_user_id_entry_date_key" ON "entries"("user_id", "entry_date");

-- CreateIndex
CREATE INDEX "photos_entry_id_sort_order_idx" ON "photos"("entry_id", "sort_order");

-- CreateIndex
CREATE INDEX "entry_questions_entry_id_sort_order_idx" ON "entry_questions"("entry_id", "sort_order");

-- CreateIndex
CREATE INDEX "checklist_categories_user_id_sort_order_idx" ON "checklist_categories"("user_id", "sort_order");

-- CreateIndex
CREATE INDEX "checklist_items_category_id_sort_order_idx" ON "checklist_items"("category_id", "sort_order");

-- CreateIndex
CREATE INDEX "entry_checks_item_id_idx" ON "entry_checks"("item_id");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_last_message_at_idx" ON "chat_sessions"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_cover_photo_id_fkey" FOREIGN KEY ("cover_photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_questions" ADD CONSTRAINT "entry_questions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_categories" ADD CONSTRAINT "checklist_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "checklist_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_checks" ADD CONSTRAINT "entry_checks_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_checks" ADD CONSTRAINT "entry_checks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 수동 추가: 부분 인덱스 (Prisma 스키마로 표현 불가)
-- 색인 재처리 스크립트가 PENDING/FAILED 일기를 찾을 때 사용
CREATE INDEX "entries_ai_index_pending_idx" ON "entries"("ai_index_status")
  WHERE "ai_index_status" IN ('PENDING', 'FAILED');

-- "T 이전 확정 기록 7일" 카운트와 시점 확인 화면에서 사용
CREATE INDEX "entries_confirmed_memory_idx" ON "entries"("user_id", "entry_date")
  WHERE "status" = 'CONFIRMED' AND "excluded_from_memory" = false;
