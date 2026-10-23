import type { ApiErrorCode } from '../shared/types';

/** An expected failure with a message that is safe to show to the family. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function fail(code: ApiErrorCode, message: string): never {
  throw new ApiError(code, message);
}

export function badRequest(message: string): never {
  return fail('BAD_REQUEST', message);
}

export function notFound(message: string): never {
  return fail('NOT_FOUND', message);
}

export function forbidden(message: string): never {
  return fail('FORBIDDEN', message);
}

export function conflict(message: string): never {
  return fail('CONFLICT', message);
}
