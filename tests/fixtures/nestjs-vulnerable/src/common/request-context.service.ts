import { Injectable } from '@nestjs/common';

@Injectable()
export class RequestContextService {
  userId?: string;
  role?: string;
}
