// AI 서버(meari-ai) 요청·응답 계약. 원본: meari-ai docs/AI_API_SPEC.md
// AI 서버는 정의되지 않은 필드를 거부하므로 여기 있는 필드만 보낸다.

export type ImageAnalysis = {
  location: string | null;
  people: string[];
  actions: string[];
  objects: string[];
  atmosphere: string | null;
  uncertain_information: string[];
};

export type ChecklistInput = Record<string, boolean | number | string | null>;

export type ImageFile = {
  buffer: Buffer;
  filename: string;
  mimetype: 'image/jpeg' | 'image/png' | 'image/webp';
};

export type ClarificationRequest = {
  image_analysis: ImageAnalysis;
  description?: string | null;
  checklist?: ChecklistInput | null;
  diary_date?: string | null;
};

export type ClarificationQuestion = {
  id: string;
  question: string;
  reason: string;
};

export type ClarificationResult = {
  needs_clarification: boolean;
  questions: ClarificationQuestion[];
};

export type DiaryGenerateRequest = {
  diary_date: string;
  image_analysis?: ImageAnalysis | null;
  description?: string | null;
  checklist?: ChecklistInput | null;
  clarification_answers?: Record<string, string | null> | null;
};

export type DiaryGenerateResult = {
  diary_date: string;
  content: string;
};

export type IndexDiaryRequest = {
  user_id: string;
  diary_id: string;
  diary_date: string;
  content: string;
};

export type IndexResult = {
  user_id: string;
  diary_id: string;
  indexed: boolean;
};

export type PastChatRequest = {
  user_id: string;
  target_date: string;
  message: string;
  top_k?: number;
};

export type PastChatReference = {
  diary_id: string;
  diary_date: string;
};

export type PastChatResult = {
  user_id: string;
  target_date: string;
  answer: string;
  references: PastChatReference[];
};

export type AiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};
