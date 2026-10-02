import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [HttpModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, GeoService],
})
export class IntegrationsModule {}
