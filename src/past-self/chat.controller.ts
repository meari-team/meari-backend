import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { stubMessages, stubSession } from '../stubs/fixtures.js';
import { assertNotFuture } from './past-self.controller.js';
import {
  ChatMessagePageDto,
  ChatSessionDto,
  ChatSessionListDto,
  CreateSessionDto,
  MessagesQueryDto,
  SendMessageDto,
  SendMessageResultDto,
} from './past-self.dto.js';

@ApiTags('chat')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('chat/sessions')
export class ChatController {
  @Post()
  @ApiStub('과거의 나 세션 생성 (H2)', 'MEA-15')
  @ApiCreatedResponse({ type: ChatSessionDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    422: ['DATE_IN_FUTURE', 'NOT_ENOUGH_RECORDS'],
  })
  create(@Body() { anchorDate }: CreateSessionDto): ChatSessionDto {
    assertNotFuture(anchorDate);
    return {
      ...stubSession(anchorDate),
      messageCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
  }

  @Get()
  @ApiStub('내 세션 목록 (H3)', 'MEA-15')
  @ApiOkResponse({ type: ChatSessionListDto })
  list(): ChatSessionListDto {
    return { items: [stubSession('2026-09-24')] };
  }

  @Get(':id/messages')
  @ApiStub('세션 메시지 목록 (H4)', 'MEA-15')
  @ApiOkResponse({ type: ChatMessagePageDto })
  @ApiErrors({ 404: ['SESSION_NOT_FOUND'] })
  messages(
    @Param('id', ParseUUIDPipe) _id: string,
    @Query() _query: MessagesQueryDto,
  ): ChatMessagePageDto {
    return { items: stubMessages(), nextCursor: null };
  }

  @Post(':id/messages')
  @ApiStub('메시지 전송 → 과거의 나 응답 (H5)', 'MEA-15')
  @ApiCreatedResponse({ type: SendMessageResultDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    404: ['SESSION_NOT_FOUND'],
    422: ['SESSION_MESSAGE_LIMIT'],
    429: ['TOO_MANY_REQUESTS'],
    502: ['AI_UPSTREAM_ERROR'],
    504: ['AI_TIMEOUT'],
  })
  send(
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() dto: SendMessageDto,
  ): SendMessageResultDto {
    const [user, assistant] = stubMessages();
    return {
      userMessage: { ...user, content: dto.content },
      assistantMessage: assistant,
    };
  }
}
