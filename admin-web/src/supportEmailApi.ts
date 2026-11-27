import { supabase } from './supabase';

export type SupportEmailSummary = {
  uid: number;
  from: string;
  subject: string;
  receivedAt: string | null;
  unread: boolean;
};

export type SupportEmailDetail = SupportEmailSummary & {
  body: string;
  attachments: string[];
};

type SupportEmailRequest =
  | { action: 'list' }
  | { action: 'read'; uid: number }
  | { action: 'reply'; uid: number; text: string };

export class SupportEmailRequestError extends Error {
  constructor(message: string, readonly errorId?: string) {
    super(message);
    this.name = 'SupportEmailRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestSupportEmail(body: SupportEmailRequest): Promise<unknown> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!data.session) throw new Error('Sign in again to access the support inbox.');

  const response = await fetch('/api/admin/support-email', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const details = isRecord(result) ? result : {};
    const message = typeof details.error === 'string' ? details.error : 'Support email is temporarily unavailable.';
    const errorId = typeof details.error_id === 'string' ? details.error_id : undefined;
    throw new SupportEmailRequestError(message, errorId);
  }
  return result;
}

function parseSummary(value: unknown): SupportEmailSummary {
  if (!isRecord(value)
    || typeof value.uid !== 'number'
    || !Number.isSafeInteger(value.uid)
    || typeof value.from !== 'string'
    || typeof value.subject !== 'string'
    || !(typeof value.receivedAt === 'string' || value.receivedAt === null)
    || typeof value.unread !== 'boolean') {
    throw new Error('The support inbox returned an invalid email.');
  }
  return {
    uid: value.uid,
    from: value.from,
    subject: value.subject,
    receivedAt: value.receivedAt,
    unread: value.unread,
  };
}

export async function listSupportEmails(): Promise<SupportEmailSummary[]> {
  const result = await requestSupportEmail({ action: 'list' });
  if (!isRecord(result) || !Array.isArray(result.messages)) {
    throw new Error('The support inbox returned an invalid response.');
  }
  return result.messages.map(parseSummary);
}

export async function readSupportEmail(uid: number): Promise<SupportEmailDetail> {
  const result = await requestSupportEmail({ action: 'read', uid });
  if (!isRecord(result)
    || typeof result.body !== 'string'
    || !Array.isArray(result.attachments)
    || !result.attachments.every((name) => typeof name === 'string')) {
    throw new Error('The support inbox returned an invalid email.');
  }
  return {
    ...parseSummary(result),
    body: result.body,
    attachments: result.attachments,
  };
}

export async function replyToSupportEmail(uid: number, text: string): Promise<void> {
  await requestSupportEmail({ action: 'reply', uid, text });
}
