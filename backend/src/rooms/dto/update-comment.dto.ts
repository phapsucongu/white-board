import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCommentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  resolved?: boolean;
}
