import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ThrottleResult = {
  is_blocked?: boolean;
  is_allowed?: boolean;
  is_locked?: boolean;
  retry_after_seconds?: number;
};

function respond(body: Record<string, unknown>, status = 200, retryAfter?: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });
}

function requiredSetting(key: string) {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Login protection is not configured. Missing server setting: ${key}.`);
  return value;
}

function getClientIp(request: Request) {
  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp.toLowerCase();
  const forwardedIps = request.headers.get('x-forwarded-for');
  const gatewayIp = forwardedIps?.split(',').map((ip) => ip.trim()).filter(Boolean).at(-1);
  return gatewayIp?.toLowerCase() || null;
}

async function hashIdentifier(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = requiredSetting('SUPABASE_URL');
    const anonKey = requiredSetting('SUPABASE_ANON_KEY');
    const serviceRoleKey = requiredSetting('SUPABASE_SERVICE_ROLE_KEY');
    const clientIp = getClientIp(request);
    if (!clientIp) {
      return respond({ error: 'Unable to verify this connection. Please try again later.' }, 503);
    }

    const ipHash = await hashIdentifier(serviceRoleKey, `ip:${clientIp}`);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ipResult, error: ipError } = await admin.rpc('account_login_consume_ip_attempt', {
      p_ip_hash: ipHash,
    });
    if (ipError) throw ipError;
    const ipLimit = (ipResult as ThrottleResult[] | null)?.[0];
    if (!ipLimit || typeof ipLimit.is_allowed !== 'boolean') {
      throw new Error('The IP login limit returned an invalid response.');
    }
    if (!ipLimit.is_allowed) {
      const retryAfter = Math.max(1, Number(ipLimit.retry_after_seconds) || 900);
      return respond({ error: 'Too many sign-in attempts. Try again later.', code: 'rate_limited' }, 429, retryAfter);
    }

    let payload: { email?: unknown; password?: unknown };
    try {
      payload = await request.json() as { email?: unknown; password?: unknown };
    } catch {
      return respond({ error: 'A valid email and password are required.' }, 400);
    }
    if (typeof payload.email !== 'string' || payload.email.trim().length > 320
      || typeof payload.password !== 'string' || !payload.password || payload.password.length > 4096) {
      return respond({ error: 'A valid email and password are required.' }, 400);
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const accountHash = await hashIdentifier(serviceRoleKey, `account:${normalizedEmail}`);
    const { data: lockResult, error: lockError } = await admin.rpc('account_login_check_throttle', {
      p_account_hash: accountHash,
      p_ip_hash: ipHash,
    });
    if (lockError) throw lockError;
    const lock = (lockResult as ThrottleResult[] | null)?.[0];
    if (!lock || typeof lock.is_blocked !== 'boolean') {
      throw new Error('The account login limit returned an invalid response.');
    }
    if (lock.is_blocked) {
      const retryAfter = Math.max(1, Number(lock.retry_after_seconds) || 900);
      return respond({ error: 'Too many sign-in attempts. Try again later.', code: 'rate_limited' }, 429, retryAfter);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: payload.email.trim(),
      password: payload.password,
    });

    if (error) {
      if (error.code === 'email_not_confirmed') {
        return respond({ error: 'Verify your email address before signing in.', code: error.code }, 403);
      }
      if (error.status === 429) {
        return respond({ error: 'Sign-in is temporarily rate-limited. Try again later.', code: 'rate_limited' }, 429, 60);
      }
      if (error.status >= 500) throw new Error('The sign-in service is temporarily unavailable.');

      const { data: failureResult, error: failureError } = await admin.rpc('account_login_record_failure', {
        p_account_hash: accountHash,
      });
      if (failureError) throw failureError;
      const failureLimit = (failureResult as ThrottleResult[] | null)?.[0];
      if (!failureLimit || typeof failureLimit.is_locked !== 'boolean') {
        throw new Error('The account failure limit returned an invalid response.');
      }
      if (failureLimit.is_locked) {
        const retryAfter = Math.max(1, Number(failureLimit.retry_after_seconds) || 900);
        return respond({ error: 'Too many sign-in attempts. Try again later.', code: 'rate_limited' }, 429, retryAfter);
      }
      return respond({ error: 'Invalid email or password.', code: 'invalid_credentials' }, 401);
    }

    if (!data.session) throw new Error('The sign-in service did not return a session.');
    const { error: clearError } = await admin.rpc('account_login_clear_failures', {
      p_account_hash: accountHash,
    });
    if (clearError) throw clearError;

    return respond({ session: data.session });
  } catch (error) {
    console.error('Account sign-in request failed.', error);
    return respond({ error: error instanceof Error ? error.message : 'Unable to sign in.' }, 500);
  }
});
