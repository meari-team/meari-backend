import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { AppException } from '../common/errors/app.exception.js';
import { todayKst } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import {
  AvailabilityDto,
  AvailabilityPresetListDto,
  AvailabilityQueryDto,
  PRESETS,
} from './past-self.dto.js';
import { presetAnchorDate } from './presets.js';

export const REQUIRED_RECORDS = 7;

export function assertNotFuture(date: string) {
  if (date > todayKst()) {
    throw new AppException(
      'DATE_IN_FUTURE',
      HttpStatus.UNPROCESSABLE_ENTITY,
      '오늘 이후 날짜는 고를 수 없어요.',
    );
  }
}

@ApiTags('past-self')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('past-self')
export class PastSelfController {
  @Get('availability')
  @ApiStub('시점 확인 (H1) — anchorDate 생략 시 프리셋 전체', 'MEA-15')
  @ApiExtraModels(AvailabilityDto, AvailabilityPresetListDto)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AvailabilityDto) },
        { $ref: getSchemaPath(AvailabilityPresetListDto) },
      ],
    },
  })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 422: ['DATE_IN_FUTURE'] })
  availability(
    @Query() { anchorDate }: AvailabilityQueryDto,
  ): AvailabilityDto | AvailabilityPresetListDto {
    if (anchorDate) {
      assertNotFuture(anchorDate);
      return {
        anchorDate,
        available: true,
        recordCount: 62,
        firstRecordDate: '2026-07-01',
        requiredCount: REQUIRED_RECORDS,
      };
    }
    const today = todayKst();
    const counts = [85, 62, 24, 0, 0];
    return {
      items: PRESETS.map((preset, i) => ({
        preset,
        anchorDate: presetAnchorDate(preset, today),
        available: counts[i] >= REQUIRED_RECORDS,
        recordCount: counts[i],
      })),
    };
  }
}
