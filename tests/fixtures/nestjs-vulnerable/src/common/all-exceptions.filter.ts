import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType<string>() !== 'http') {
      throw exception;
    }
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const error = exception instanceof Error ? exception : new Error(String(exception));

    response.status(status).json({
      statusCode: status,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }
}
