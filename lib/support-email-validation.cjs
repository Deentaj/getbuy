const MAX_REPLY_LENGTH = 10_000;

function canAccessSupportEmail(role) {
  return role === 'super_admin' || role === 'customer_service';
}

function parseSupportEmailRequest(value) {
  let body = value;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new Error('Invalid support email request.');
    }
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Invalid support email request.');
  }

  if (body.action === 'list') return { action: 'list' };

  if (body.action === 'read' || body.action === 'reply') {
    if (!Number.isSafeInteger(body.uid) || body.uid <= 0) {
      throw new Error('Choose a valid email.');
    }

    if (body.action === 'read') return { action: 'read', uid: body.uid };

    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_REPLY_LENGTH) {
      throw new Error('Enter a reply of no more than 10,000 characters.');
    }
    return { action: 'reply', uid: body.uid, text: body.text.trim() };
  }

  throw new Error('Choose a supported support email action.');
}

module.exports = { canAccessSupportEmail, parseSupportEmailRequest };
