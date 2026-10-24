import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import {
  AvailabilityDto,
  AvailabilityPresetListDto,
  AvailabilityQueryDto,
} from './past-self.dto.js';
import { PastSelfService } from './past-self.service.js';

@ApiTags('past-self')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('past-self')
export class PastSelfController {
  constructor(private readonly pastSelf: PastSelfService) {}

  @Get('availability')
  @ApiOperation({
    summary: '시점 확인 (H1)',
    description:
      'anchorDate를 주면 그 시점까지의 기록 수·첫 기록일, 생략하면 프리셋(1W·1M·3M·6M·1Y) 전체. ' +
      '기록 = 확정됐고 기억에서 제외되지 않은 일기. 7일 이상이어야 대화 가능.',
  })
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
  async availability(
    @CurrentUser() user: AuthUser,
    @Query() { anchorDate }: AvailabilityQueryDto,
  ): Promise<AvailabilityDto | AvailabilityPresetListDto> {
    return anchorDate
      ? this.pastSelf.availability(user.id, anchorDate)
      : { items: await this.pastSelf.presets(user.id) };
  }
}
