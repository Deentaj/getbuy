export type ClientErrorReport = {
  error_id: string;
  source: string;
  context: string;
  name: string;
  message: string;
  stack?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type ErrorRecord = Record<string, unknown> & {
  errorId?: string;
  serverReported?: boolean;
};

type ErrorReporter = (report: ClientErrorReport) => Promise<void>;

const errorIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function redact(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/\b(password|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\s*[:=]\s*(['"]?)[^,\s'"]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]');
}

function textField(record: ErrorRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' ? redact(value) : undefined;
}

export function createErrorId() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random number generation is unavailable.');
  if (cryptoApi.randomUUID) return cryptoApi.randomUUID();

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    const details: ClientErrorReport = {
      error_id: '',
      source: '',
      context: '',
      name: redact(error.name || 'Error'),
      message: redact(error.message || 'Unknown error'),
    };
    if (error.stack) details.stack = redact(error.stack);
    if (error.cause instanceof Error) details.details = redact(error.cause.message);
    return details;
  }

  if (isRecord(error)) {
    const details: ClientErrorReport = {
      error_id: '',
      source: '',
      context: '',
      name: textField(error, 'name') || 'Error',
      message: textField(error, 'message') || 'Unknown error',
    };
    for (const key of ['stack', 'code', 'details', 'hint'] as const) {
      const value = textField(error, key);
      if (value) details[key] = value;
    }
    return details;
  }

  return {
    error_id: '',
    source: '',
    context: '',
    name: 'Error',
    message: redact(typeof error === 'string' ? error : 'Unknown error'),
  };
}

export function formatErrorForUser(
  error: unknown,
  fallback: string,
  source: string,
  context: string,
  report: ErrorReporter,
) {
  const record = isRecord(error) ? error : null;
  const providedId = record?.errorId;
  const serverReported = record?.serverReported === true;
  const errorId = typeof providedId === 'string' && errorIdPattern.test(providedId)
    ? providedId
    : createErrorId();

  if (!serverReported) {
    const details = getErrorDetails(error);
    const payload: ClientErrorReport = {
      ...details,
      error_id: errorId,
      source: source.slice(0, 80),
      context: redact(context).slice(0, 160),
    };
    console.error(`[${errorId}] ${payload.context}`, payload);
    void report(payload).catch((reportError: unknown) => {
      console.error(`[${errorId}] Unable to send the client error report.`, getErrorDetails(reportError));
    });
  }

  const safeFallback = fallback.trim() || 'Something went wrong. Please try again.';
  return `${safeFallback} (Error ID: ${errorId})`;
}

export function createServerReportedError(errorId: string, message: string) {
  const error = new Error(message) as Error & { errorId: string; serverReported: boolean };
  error.errorId = errorId;
  error.serverReported = true;
  return error;
}
