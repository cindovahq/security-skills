import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [RequestContextService, RolesGuard],
  exports: [RequestContextService, RolesGuard],
})
export class CommonModule {}
