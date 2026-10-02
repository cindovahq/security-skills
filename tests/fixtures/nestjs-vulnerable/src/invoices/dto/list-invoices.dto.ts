import { IsIn, IsOptional } from 'class-validator';

export class ListInvoicesDto {
  @IsOptional()
  @IsIn(['open', 'paid', 'void'])
  status?: string;

  @IsOptional()
  @IsIn(['created', 'amount'])
  sort?: 'created' | 'amount';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
