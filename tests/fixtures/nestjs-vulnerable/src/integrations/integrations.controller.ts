import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PreviewUrlDto } from './dto/preview-url.dto';
import { GeoService } from './geo.service';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly geo: GeoService,
  ) {}

  @Post('preview')
  preview(@Body() dto: PreviewUrlDto) {
    return this.integrations.fetchPreview(dto.url);
  }

  @Get('geo/:ip')
  lookup(@Param('ip') ip: string) {
    return this.geo.lookup(ip);
  }
}
