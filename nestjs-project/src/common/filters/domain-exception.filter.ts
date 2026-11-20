import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import {
  DomainException,
  RangeNotSatisfiableException,
} from '../exceptions/domain.exception';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof RangeNotSatisfiableException) {
      // RFC 9110: o 416 informa o tamanho atual do recurso.
      response.setHeader('Content-Range', `bytes */${exception.size}`);
    }

    response.status(exception.httpStatus).json({
      statusCode: exception.httpStatus,
      error: exception.errorCode,
      message: exception.message,
    });
  }
}
