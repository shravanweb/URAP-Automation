export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(details) {
  return new AppError(400, 'VALIDATION', 'Request validation failed', details);
}
