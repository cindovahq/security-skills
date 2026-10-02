import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [InvoicesModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
