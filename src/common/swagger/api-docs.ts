import { applyDecorators, Header, HttpStatus } from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ERROR_CODES, type ErrorCode } from '../errors/app.exception.js';

class ErrorBodyDto {
  @ApiProperty({ enum: ERROR_CODES, enumName: 'ErrorCode' })
  code: ErrorCode;

  @ApiProperty()
  message: string;

  @ApiProperty({ nullable: true, description: '필드별 사유 등 추가 정보' })
  details: unknown;
}

export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error: ErrorBodyDto;
}

// 엔드포인트가 낼 수 있는 에러를 상태 코드별로 문서화한다.
export function ApiErrors(errors: Partial<Record<HttpStatus, ErrorCode[]>>) {
  return applyDecorators(
    ...Object.entries(errors).map(([status, codes]) =>
      ApiResponse({
        status: Number(status),
        description: codes.join(' | '),
        schema: { $ref: getSchemaPath(ErrorResponseDto) },
      }),
    ),
  );
}

// 아직 실제 구현이 없는 엔드포인트. 고정된 목 응답을 돌려주며 응답 헤더로 표시한다.
export function ApiStub(summary: string, ticket: string) {
  return applyDecorators(
    ApiOperation({
      summary: `${summary} [STUB]`,
      description: `목 응답을 돌려준다. ${ticket}에서 실제 구현으로 교체한다. 응답 헤더 \`X-Meari-Stub: true\``,
    }),
    Header('X-Meari-Stub', 'true'),
  );
}
