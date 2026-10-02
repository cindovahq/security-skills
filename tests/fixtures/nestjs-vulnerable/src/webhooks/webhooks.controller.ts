import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Public } from '../common/public.decorator';
import { InvoicesService } from '../invoices/invoices.service';

@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly config: ConfigService,
  ) {}

  @Post('payments')
  @HttpCode(204)
  async payments(@Body() event: { invoiceId: string; status: string }) {
    if (event.status === 'succeeded') {
      await this.invoices.markPaid(event.invoiceId);
    }
  }

  @Post('shipments')
  @HttpCode(204)
  async shipments(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-acme-signature') signature: string,
  ) {
    const secret = this.config.getOrThrow<string>('SHIPMENT_WEBHOOK_SECRET');
    const expected = createHmac('sha256', secret).update(req.rawBody ?? Buffer.alloc(0)).digest();
    const received = Buffer.from(signature ?? '', 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException();
    }
    const event = JSON.parse(req.rawBody.toString('utf8'));
    if (typeof event.trackingNumber !== 'string') {
      throw new BadRequestException();
    }
  }
}
