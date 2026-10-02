import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getRequest } from './request.util';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => getRequest(context).user,
);
