import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export class ChecklistItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  sortOrder: number;
}

export class ChecklistCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: '#4CAF50' })
  color: string;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty({ type: [ChecklistItemDto] })
  items: ChecklistItemDto[];
}

export class ChecklistCategoryListDto {
  @ApiProperty({ type: [ChecklistCategoryDto] })
  items: ChecklistCategoryDto[];
}

export class CreateCategoryDto {
  @ApiProperty({ minLength: 1, maxLength: 20 })
  @Transform(trim)
  @IsString()
  @Length(1, 20)
  name: string;

  @ApiProperty({ example: '#4CAF50' })
  @Matches(HEX_COLOR)
  color: string;

  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 20, { each: true })
  items: string[];
}

export class CategoryItemInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: '있으면 기존 항목 유지' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ minLength: 1, maxLength: 20 })
  @Transform(trim)
  @IsString()
  @Length(1, 20)
  label: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 20 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 20)
  name?: string;

  @ApiPropertyOptional({ example: '#4CAF50' })
  @IsOptional()
  @Matches(HEX_COLOR)
  color?: string;

  @ApiPropertyOptional({
    type: [CategoryItemInputDto],
    maxItems: 10,
    description: '전체 교체',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CategoryItemInputDto)
  items?: CategoryItemInputDto[];
}
