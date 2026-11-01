import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import { EntryDto } from '../entries/entries.dto.js';
import { EntriesService } from '../entries/entries.service.js';
import { AppException } from '../common/errors/app.exception.js';
import {
  BookmarkDto,
  EchoDto,
  EchoListDto,
  EchoSettingsDto,
  PushTokenDto,
  RemovePushTokenDto,
  UpdateEchoSettingsDto,
} from './echo.dto.js';
import { EchoService } from './echo.service.js';

@ApiTags('echo')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller()
export class EchoController {
  constructor(
    private readonly echo: EchoService,
    private readonly entries: EntriesService,
  ) {}

  @Put('entries/:date/bookmark')
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiOperation({
    summary: '기억하고 싶은 날 (북마크) 켜기/끄기',
    description:
      '확정 일기만. 북마크한 확정·기억 포함 일기가 메아리 후보가 된다. 해제해도 이미 도착한 메아리·대화는 남는다.',
  })
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    404: ['ENTRY_NOT_FOUND'],
    409: ['INVALID_ENTRY_STATE'],
    422: ['DATE_IN_FUTURE'],
  })
  async bookmark(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Body() { bookmarked }: BookmarkDto,
  ): Promise<EntryDto> {
    await this.echo.setBookmark(user.id, date, bookmarked);
    return this.entries.get(user.id, date);
  }

  @Get('me/echo-settings')
  @ApiOperation({
    summary: '메아리 설정 — 수신 동의·주기·시간·미리보기·다음 예정',
  })
  @ApiOkResponse({ type: EchoSettingsDto })
  settings(@CurrentUser() user: AuthUser): Promise<EchoSettingsDto> {
    return this.echo.getSettings(user.id);
  }

  @Put('me/echo-settings')
  @ApiOperation({
    summary: '메아리 설정 변경 — 보낸 필드만',
    description:
      '동의 중이면 다음 회차를 지금 이후로 다시 계산한다(미동의 기간 회차는 몰아서 보내지 않는다). 미동의면 예약만 지우고 주기 값은 보존한다.',
  })
  @ApiOkResponse({ type: EchoSettingsDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateEchoSettingsDto,
  ): Promise<EchoSettingsDto> {
    return this.echo.updateSettings(user.id, dto);
  }

  @Post('me/push-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '기기 푸시 토큰 등록 (Expo push token)' })
  @ApiNoContentResponse()
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  async registerToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: PushTokenDto,
  ): Promise<void> {
    await this.echo.registerToken(user.id, dto);
  }

  @Delete('me/push-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '기기 푸시 토큰 해제 (로그아웃할 때)' })
  @ApiNoContentResponse()
  async removeToken(
    @CurrentUser() user: AuthUser,
    @Body() { token }: RemovePushTokenDto,
  ): Promise<void> {
    await this.echo.removeToken(user.id, token);
  }

  @Get('echoes')
  @ApiOperation({ summary: '도착한 메아리 목록 (최근 것부터) + 안 읽은 수' })
  @ApiOkResponse({ type: EchoListDto })
  list(@CurrentUser() user: AuthUser): Promise<EchoListDto> {
    return this.echo.list(user.id);
  }

  @Post('echoes/demo')
  @ApiOperation({
    summary: '시연: 지금 메아리 한 번 받기 (ECHO_DEMO=true일 때만)',
    description:
      '예약을 기다리지 않고 한 회차를 만든다. 동의·후보 조건은 실제 회차와 같다.',
  })
  @ApiCreatedResponse({ type: EchoDto })
  @ApiErrors({
    404: ['NOT_FOUND'],
    409: ['ECHO_DISABLED'],
    422: ['NO_ECHO_CANDIDATES'],
  })
  demo(@CurrentUser() user: AuthUser): Promise<EchoDto> {
    if (!this.echo.demoAvailable) {
      throw new AppException(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        '없는 기능이에요.',
      );
    }
    return this.echo.demo(user.id);
  }

  @Get('echoes/:id')
  @ApiOperation({
    summary: '메아리 상세 — 그날 사진·확정 일기·첫 메시지·대화 가능 여부',
  })
  @ApiOkResponse({ type: EchoDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['ECHO_NOT_FOUND'] })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EchoDto> {
    return this.echo.get(user.id, id);
  }

  @Post('echoes/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '메아리 읽음 표시' })
  @ApiNoContentResponse()
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['ECHO_NOT_FOUND'] })
  async read(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.echo.markRead(user.id, id);
  }
}
