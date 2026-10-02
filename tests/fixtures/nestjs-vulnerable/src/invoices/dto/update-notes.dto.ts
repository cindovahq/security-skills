import { IsString, MaxLength } from 'class-validator';

export class UpdateNotesDto {
  @IsString()
  @MaxLength(2000)
  notes: string;
}
