const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { canAccessSupportEmail, parseSupportEmailRequest } = require('../../lib/support-email-validation.cjs');

const SUPPORT_EMAIL = 'support@getbuy.com.ng';
const MAX_REQUEST_BYTES = 48 * 1024;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 50;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function respond(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(status).json(body);
}

function logError(scope, error) {
  const errorId = randomUUID();
  console.error(`[${scope}]`, errorId, error);
  return errorId;
}

function parseRequest(request) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, 'The support email request is too large.');
  }

  let body;
  try {
    body = request.body;
  } catch {
    throw new HttpError(400, 'Invalid support email request.');
  }
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_REQUEST_BYTES) {
    throw new HttpError(413, 'The support email request is too large.');
  }

  try {
    return parseSupportEmailRequest(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid support email request.');
  }
}

async function authorize(request) {
  const authorization = request.headers.authorization;
  const tokenMatch = typeof authorization === 'string' ? authorization.match(/^Bearer ([^\s]+)$/i) : null;
  if (!tokenMatch) throw new HttpError(401, 'Sign in is required.');

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase server configuration is missing.');
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new HttpError(401, 'Sign in and try again.');

  const { data: role, error: roleError } = await supabase.rpc('get_admin_staff_role');
  if (roleError) throw roleError;
  if (!canAccessSupportEmail(role)) throw new HttpError(403, 'Customer service access is required.');
}

async function withInbox(password, callback) {
  const client = new ImapFlow({
    host: 'imap.hostinger.com',
    port: 993,
    secure: true,
    auth: { user: SUPPORT_EMAIL, pass: password },
    logger: false,
  });
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    return await callback(client);
  } finally {
    if (lock) lock.release();
    await client.logout();
  }
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatSender(address) {
  if (!address || typeof address.address !== 'string') return 'Unknown sender';
  const email = address.address.trim();
  const name = typeof address.name === 'string' ? address.name.trim() : '';
  return name ? `${name} <${email}>` : email;
}

function formatSummary(message) {
  const envelope = message.envelope || {};
  const from = Array.isArray(envelope.from) ? envelope.from[0] : null;
  return {
    uid: message.uid,
    from: formatSender(from),
    subject: typeof envelope.subject === 'string' && envelope.subject.trim() ? envelope.subject : '(No subject)',
    receivedAt: isoDate(message.internalDate || envelope.date),
    unread: !message.flags?.has('\\Seen'),
  };
}

async function listMessages(password) {
  return withInbox(password, async (client) => {
    const messages = [];
    const messageCount = client.mailbox?.exists || 0;
    if (messageCount > 0) {
      const firstSequence = Math.max(1, messageCount - MAX_MESSAGES + 1);
      for await (const message of client.fetch(
        `${firstSequence}:*`,
        { uid: true, envelope: true, flags: true, internalDate: true },
      )) {
        messages.push(formatSummary(message));
      }
    }
    messages.sort((a, b) => b.uid - a.uid);
    return { messages };
  });
}

async function readMessage(password, uid) {
  return withInbox(password, async (client) => {
    const metadata = await client.fetchOne(uid, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
    }, { uid: true });
    if (!metadata) throw new HttpError(404, 'That email is no longer in the inbox.');
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) {
      throw new Error('The email size could not be verified.');
    }
    if (metadata.size > MAX_MESSAGE_BYTES) {
      throw new HttpError(413, 'This email is too large to preview here. Open Hostinger Webmail to view it.');
    }

    const source = await client.fetchOne(uid, { uid: true, source: true }, { uid: true });
    if (!source?.source) throw new Error('The email body could not be loaded.');
    const parsed = await simpleParser(source.source);
    await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    return {
      ...formatSummary(metadata),
      body: typeof parsed.text === 'string' && parsed.text
        ? parsed.text
        : 'This email has no plain-text body. Open Hostinger Webmail to view it.',
      attachments: parsed.attachments.map((attachment) => (
        typeof attachment.filename === 'string' && attachment.filename.trim()
          ? attachment.filename.slice(0, 255)
          : 'Untitled attachment'
      )),
    };
  });
}

function validEmailAddress(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validMessageId(value) {
  return typeof value === 'string'
    && value.length <= 998
    && /^<[^<>\s\r\n]+@[^<>\s\r\n]+>$/.test(value);
}

async function replyToMessage(password, uid, text) {
  const original = await withInbox(password, async (client) => {
    const message = await client.fetchOne(uid, { uid: true, envelope: true }, { uid: true });
    if (!message) throw new HttpError(404, 'That email is no longer in the inbox.');
    const sender = Array.isArray(message.envelope?.from) ? message.envelope.from[0]?.address : null;
    if (!validEmailAddress(sender) || sender.toLowerCase() === SUPPORT_EMAIL) {
      throw new HttpError(422, 'This email does not have a valid reply address.');
    }
    const rawSubject = typeof message.envelope?.subject === 'string' ? message.envelope.subject : '';
    const subject = rawSubject.replace(/[\r\n]+/g, ' ').trim();
    const messageId = validMessageId(message.envelope?.messageId) ? message.envelope.messageId : '';
    return { sender, subject, messageId };
  });

  const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: { user: SUPPORT_EMAIL, pass: password },
  });
  try {
    const result = await transporter.sendMail({
      from: { name: 'GetBuy Support', address: SUPPORT_EMAIL },
      to: original.sender,
      subject: /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject || 'Your support request'}`,
      text,
      ...(original.messageId
        ? { inReplyTo: original.messageId, references: original.messageId }
        : {}),
    });
    if (!result.accepted?.length) throw new Error('The email provider did not accept the reply.');
    return { message: 'Reply sent.' };
  } finally {
    transporter.close();
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return respond(response, 405, { error: 'Method not allowed.' });
  }

  let action;
  try {
    action = parseRequest(request);
  } catch (error) {
    if (error instanceof HttpError) return respond(response, error.status, { error: error.message });
    return respond(response, 400, { error: 'Invalid support email request.' });
  }

  try {
    await authorize(request);
    const password = process.env.SUPPORT_EMAIL_PASSWORD;
    if (!password) throw new Error('Support mailbox credentials are not configured.');

    if (action.action === 'list') {
      return respond(response, 200, await listMessages(password));
    }
    if (action.action === 'read') {
      return respond(response, 200, await readMessage(password, action.uid));
    }
    return respond(response, 200, await replyToMessage(password, action.uid, action.text));
  } catch (error) {
    if (error instanceof HttpError) return respond(response, error.status, { error: error.message });
    const errorId = logError('support-email', error);
    const status = process.env.SUPPORT_EMAIL_PASSWORD ? 502 : 503;
    const message = status === 503
      ? 'Support email is not configured. Contact the administrator.'
      : 'Support email is temporarily unavailable. Please try again.';
    return respond(response, status, { error: message, error_id: errorId });
  }
};
