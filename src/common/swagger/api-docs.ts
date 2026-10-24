import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiResponse, getSchemaPath } from '@nestjs/swagger';
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
