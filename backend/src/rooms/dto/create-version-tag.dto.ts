import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateVersionTagDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;
}
