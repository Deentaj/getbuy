export function createServerErrorId() {
  return crypto.randomUUID();
}

function redact(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/\b(password|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\s*[:=]\s*(['"]?)[^,\s'"]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]');
}

export function logServerError(errorId: string, context: string, error: unknown) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null;
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const stack = error instanceof Error
    ? error.stack
    : typeof record?.stack === 'string'
      ? record.stack
      : undefined;

  console.error(JSON.stringify({
    error_id: errorId,
    context: context.slice(0, 120),
    name: error instanceof Error ? redact(error.name) : typeof record?.name === 'string' ? redact(record.name) : 'Error',
    message: redact(message),
    ...(stack ? { stack: redact(stack) } : {}),
    ...(typeof record?.code === 'string' ? { code: redact(record.code) } : {}),
    ...(typeof record?.details === 'string' ? { details: redact(record.details) } : {}),
    ...(typeof record?.hint === 'string' ? { hint: redact(record.hint) } : {}),
  }));
}
