import { IsUrl } from 'class-validator';

export class PreviewUrlDto {
  @IsUrl()
  url: string;
}
