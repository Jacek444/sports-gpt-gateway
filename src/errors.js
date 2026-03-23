export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function toErrorResponse(error) {
  return {
    error: {
      message: error.message || 'Unexpected error',
      status: error.status || 500,
      ...(error.details ? { details: error.details } : {})
    }
  };
}
