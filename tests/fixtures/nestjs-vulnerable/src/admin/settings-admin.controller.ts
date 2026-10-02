import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';

class MaintenanceDto {
  @IsBoolean()
  enabled: boolean;
}

@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/settings')
export class SettingsAdminController {
  private maintenance = false;

  @Get('maintenance')
  getMaintenance() {
    return { enabled: this.maintenance };
  }

  @Put('maintenance')
  setMaintenance(@Body() dto: MaintenanceDto) {
    this.maintenance = dto.enabled;
    return { enabled: this.maintenance };
  }
}
