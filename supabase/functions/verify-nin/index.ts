import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isValidNin, matchesNinProfileName } from '../_shared/nin-verification.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BODY_BYTES = 1024;
const allowedDojahHosts = new Set(['api.dojah.io', 'sandbox.dojah.io']);

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}

function logSafeFailure(errorId: string, context: string, error?: unknown) {
  console.error(JSON.stringify({
    error_id: errorId,
    context,
    error_type: error instanceof Error ? error.name : 'Error',
  }));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return respond({ error: 'Invalid verification request.' }, 413);

  let payload: { nin?: unknown; consent?: unknown };
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return respond({ error: 'Invalid verification request.' }, 413);
    }
    payload = JSON.parse(body) as { nin?: unknown; consent?: unknown };
  } catch {
    return respond({ error: 'Invalid verification request.' }, 400);
  }
  if (!isValidNin(payload.nin)) return respond({ error: 'Enter a valid 11-digit NIN.' }, 400);
  if (payload.consent !== true) return respond({ error: 'Consent is required for NIN verification.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const dojahAppId = Deno.env.get('DOJAH_APP_ID');
  const dojahSecretKey = Deno.env.get('DOJAH_SECRET_KEY');
  const dojahBaseUrl = Deno.env.get('DOJAH_API_BASE_URL') || 'https://api.dojah.io';
  let dojahHost: string;
  try {
    const parsedDojahUrl = new URL(dojahBaseUrl);
    if (parsedDojahUrl.protocol !== 'https:' || !allowedDojahHosts.has(parsedDojahUrl.hostname)) {
      throw new Error('Dojah API host is not allowed.');
    }
    dojahHost = parsedDojahUrl.origin;
  } catch {
    const errorId = crypto.randomUUID();
    logSafeFailure(errorId, 'verify-nin.config');
    return respond({ error: 'NIN verification is temporarily unavailable.', error_id: errorId }, 503);
  }
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !dojahAppId || !dojahSecretKey) {
    const errorId = crypto.randomUUID();
    logSafeFailure(errorId, 'verify-nin.config');
    return respond({ error: 'NIN verification is temporarily unavailable.', error_id: errorId }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond({ error: 'Sign in and try again.' }, 401);

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('full_name, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) {
    const errorId = crypto.randomUUID();
    logSafeFailure(errorId, 'verify-nin.profile');
    return respond({ error: 'NIN verification is temporarily unavailable.', error_id: errorId }, 500);
  }
  const { data: verification, error: verificationError } = await userClient
    .from('nin_verifications')
    .select('status, requested_role')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (verificationError) {
    const errorId = crypto.randomUUID();
    logSafeFailure(errorId, 'verify-nin.status');
    return respond({ error: 'NIN verification is temporarily unavailable.', error_id: errorId }, 500);
  }
  const requestedRole = verification?.requested_role
    || (profile?.role === 'seller' || profile?.role === 'delivery' ? profile.role : null);
  if (
    !profile
    || !requestedRole
    || !['seller', 'delivery'].includes(requestedRole)
    || (profile.role !== 'buyer' && profile.role !== requestedRole)
  ) {
    return respond({ error: 'NIN verification is only available to seller and rider accounts.' }, 403);
  }

  const { data: startResult, error: startError } = await userClient.rpc('request_nin_verification', {
    p_consent: payload.consent,
  });
  if (startError) {
    const errorId = crypto.randomUUID();
    logSafeFailure(errorId, 'verify-nin.rate-limit');
    return respond({ error: 'NIN verification is temporarily unavailable.', error_id: errorId }, 500);
  }
  if (startResult === 'verified') return respond({ verified: true });
  if (startResult === 'rate_limited') {
    return new Response(JSON.stringify({ error: 'Please wait one minute before trying NIN verification again.' }), {
      status: 429,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    });
  }
  if (startResult !== 'started') return respond({ error: 'NIN verification could not be started.' }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const setVerificationFailed = async () => {
    const { data, error } = await admin
      .from('nin_verifications')
      .update({
        status: 'failed',
        verified_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userData.user.id)
      .select('user_id')
      .maybeSingle();
    if (error || !data) throw new Error('Unable to save NIN verification status.');
  };

  try {
    const dojahUrl = new URL('/api/v1/kyc/nin', dojahHost);
    dojahUrl.searchParams.set('nin', payload.nin);
    const response = await fetch(dojahUrl, {
      method: 'GET',
      headers: {
        Authorization: dojahSecretKey,
        AppId: dojahAppId,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) {
      await setVerificationFailed();
      return respond({ error: 'The NIN could not be verified against your profile details.' }, 422);
    }
    if (!response.ok) throw new Error(`Dojah responded with status ${response.status}.`);

    const result = await response.json() as { entity?: unknown };
    const entity = typeof result.entity === 'object' && result.entity !== null
      ? result.entity as { first_name?: unknown; middle_name?: unknown; last_name?: unknown }
      : null;
    if (!entity || !matchesNinProfileName(profile.full_name || '', entity)) {
      await setVerificationFailed();
      return respond({ error: 'The NIN could not be verified against your profile details.' }, 422);
    }

    const { error: completionError } = await admin.rpc('complete_nin_verification', {
      p_user_id: userData.user.id,
    });
    if (completionError) throw completionError;
    return respond({ verified: true });
  } catch (error) {
    const errorId = crypto.randomUUID();
    logSafeFailure(errorId, 'verify-nin.provider', error);
    return respond({ error: 'NIN verification is temporarily unavailable. Please try again later.', error_id: errorId }, 503);
  }
});
