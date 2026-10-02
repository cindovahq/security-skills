import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, ValidationPipe } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { UpdateNotesDto } from './dto/update-notes.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@Query() query: ListInvoicesDto) {
    return this.invoices.list(query);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.invoices.search(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(id);
  }

  @Patch(':id/notes')
  updateNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) dto: UpdateNotesDto,
  ) {
    return this.invoices.updateNotes(id, user?.id, dto.notes);
  }
}
