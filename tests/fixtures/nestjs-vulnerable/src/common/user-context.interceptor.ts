import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context.service';
import { getRequest } from './request.util';

@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = getRequest(context)?.user;
    this.context.userId = user?.id;
    this.context.role = user?.role;
    return next.handle();
  }
}
