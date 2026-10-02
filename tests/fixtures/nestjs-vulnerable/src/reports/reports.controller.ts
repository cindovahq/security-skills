import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  revenue(@Query('customerId') customerId: string, @Query('sort') sort = 'month') {
    return this.reports.revenueByMonth(customerId, sort);
  }

  @Get('status-counts')
  statusCounts(@CurrentUser() user: AuthUser) {
    return this.reports.countByStatus(user?.id ?? '');
  }
}
