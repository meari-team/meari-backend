-- 캘린더 체크박스: 일정 완료 여부
ALTER TABLE "schedules" ADD COLUMN "completed" BOOLEAN NOT NULL DEFAULT false;
