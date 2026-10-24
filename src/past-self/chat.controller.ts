import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import {
  ChatMessagePageDto,
  ChatSessionDto,
  ChatSessionListDto,
  CreateSessionDto,
  MessagesQueryDto,
  SendMessageDto,
  SendMessageResultDto,
} from './past-self.dto.js';
import { PastSelfService } from './past-self.service.js';

@ApiTags('chat')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('chat/sessions')
export class ChatController {
  constructor(private readonly pastSelf: PastSelfService) {}

  @Post()
  @ApiOperation({
    summary: '과거의 나 세션 생성 (H2) — 그 시점까지 기록 7일 이상',
  })
  @ApiCreatedResponse({ type: ChatSessionDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    422: ['DATE_IN_FUTURE', 'NOT_ENOUGH_RECORDS'],
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() { anchorDate }: CreateSessionDto,
  ): Promise<ChatSessionDto> {
    return this.pastSelf.createSession(user.id, anchorDate);
  }

  @Get()
  @ApiOperation({ summary: '내 세션 목록 (H3) — 최근 대화순, 최대 50개' })
  @ApiOkResponse({ type: ChatSessionListDto })
  async list(@CurrentUser() user: AuthUser): Promise<ChatSessionListDto> {
    return { items: await this.pastSelf.listSessions(user.id) };
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: '세션 메시지 목록 (H4)',
    description:
      'cursor 없으면 가장 최근 limit개, 있으면 그 이전 limit개. 응답은 오래된 순.',
  })
  @ApiOkResponse({ type: ChatMessagePageDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['SESSION_NOT_FOUND'] })
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ): Promise<ChatMessagePageDto> {
    return this.pastSelf.messages(user.id, id, query.cursor, query.limit);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: '메시지 전송 → 과거의 나 응답 (H5)',
    description:
      'AI가 고른 근거는 서버가 다시 검증한다(본인·확정·미제외·T 이전만). 근거가 없으면 flag NO_EVIDENCE. ' +
      'AI가 실패하면 메시지를 저장하지 않는다. 세션당 사용자 메시지 30개까지.',
  })
  @ApiCreatedResponse({ type: SendMessageResultDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    404: ['SESSION_NOT_FOUND'],
    422: ['SESSION_MESSAGE_LIMIT'],
    502: ['AI_UPSTREAM_ERROR'],
    504: ['AI_TIMEOUT'],
  })
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<SendMessageResultDto> {
    return this.pastSelf.send(user.id, id, dto.content);
  }
}
