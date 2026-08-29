import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

const SPANISH_MESSAGES: Record<number, string> = {
  400: 'Solicitud inválida. Verifique los datos enviados.',
  401: 'No autorizado. Inicie sesión para continuar.',
  403: 'No tiene permisos para realizar esta acción.',
  404: 'El recurso solicitado no fue encontrado.',
  409: 'Conflicto con los datos existentes.',
  422: 'No se pudo procesar la solicitud.',
  429: 'Demasiadas solicitudes. Intente más tarde.',
  500: 'Error interno del servidor. Intente más tarde.',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = SPANISH_MESSAGES[500];
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        if (typeof resp.message === 'string') {
          message = resp.message;
        } else if (Array.isArray(resp.message)) {
          message = 'Datos de entrada inválidos.';
          details = resp.message;
        } else if (typeof resp.error === 'string') {
          message = resp.error;
        } else {
          message = SPANISH_MESSAGES[status] ?? message;
        }
      } else {
        message = SPANISH_MESSAGES[status] ?? message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = this.mapPrismaErrorStatus(exception);
      message = this.mapPrismaErrorMessage(exception);
    } else if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      (exception as any)?.code === 'P1000' ||
      (exception as any)?.code === 'P1001'
    ) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message =
        'Base de datos no disponible o credenciales en proceso de actualización. Intente de nuevo.';
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = SPANISH_MESSAGES[500];
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(details !== undefined ? { details } : {}),
      path: this.getRequestPath(host),
      timestamp: new Date().toISOString(),
    });
  }

  private getRequestPath(host: ArgumentsHost): string {
    try {
      const request = host.switchToHttp().getRequest<{ url?: string }>();
      return request.url ?? '';
    } catch {
      return '';
    }
  }

  private mapPrismaErrorStatus(
    error: Prisma.PrismaClientKnownRequestError,
  ): number {
    switch (error.code) {
      case 'P2002':
      case 'P2003':
        return HttpStatus.CONFLICT;
      case 'P2025':
        return HttpStatus.NOT_FOUND;
      default:
        return HttpStatus.BAD_REQUEST;
    }
  }

  private mapPrismaErrorMessage(
    error: Prisma.PrismaClientKnownRequestError,
  ): string {
    switch (error.code) {
      case 'P2002':
        return this.mapUniqueFieldMessage(error);
      case 'P2003':
        return 'No se puede completar porque tiene registros relacionados.';
      case 'P2025':
        return 'El registro solicitado no fue encontrado.';
      default:
        return 'Error al procesar la operación en la base de datos.';
    }
  }

  private mapUniqueFieldMessage(
    error: Prisma.PrismaClientKnownRequestError,
  ): string {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(',')
      : String(error.meta?.target ?? '');
    const modelName = String(error.meta?.modelName ?? '');

    if (target) {
      const fieldMessages: Record<string, string> = {
        document_number: 'Ya existe un cliente con ese número de documento.',
        email: 'Ya existe un registro con ese correo electrónico.',
        code: 'Ya existe un producto con ese código.',
        name: 'Ya existe un registro con ese nombre.',
        invoice_number: 'Ya existe una factura con ese número.',
      };

      for (const [key, msg] of Object.entries(fieldMessages)) {
        if (target.includes(key)) return msg;
      }
    }

    const modelMessages: Record<string, string> = {
      Profile: 'Ya existe un usuario con ese correo electrónico.',
      Customer: 'Ya existe un cliente con ese número de documento.',
      Product: 'Ya existe un producto con ese código.',
      ServiceType: 'Ya existe un tipo de servicio con ese nombre.',
      ServiceCategory: 'Ya existe una categoría con ese nombre.',
      ServiceSubcategory:
        'Ya existe una suscripción con ese nombre en esa categoría.',
    };

    if (modelMessages[modelName]) return modelMessages[modelName];

    return 'Ya existe un registro con esos datos únicos.';
  }
}
