import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  y?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
