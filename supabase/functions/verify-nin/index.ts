import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  extractPremblyNinIdentity,
  isValidNin,
  matchesNinProfileName,
} from '../_shared/nin-verification.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BODY_BYTES = 1024;
const PREMBLY_NIN_BASIC_URL = 'https://api.prembly.com/api/v1/verification/api/nin_basic/';

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
  const premblyApiKey = Deno.env.get('PREMBLY_API_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !premblyApiKey) {
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
    const response = await fetch(PREMBLY_NIN_BASIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': premblyApiKey,
      },
      body: JSON.stringify({ number: payload.nin }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Prembly responded with status ${response.status}.`);

    const result = await response.json() as { response_code?: unknown };
    const responseCode = typeof result.response_code === 'string'
      ? result.response_code.trim()
      : typeof result.response_code === 'number'
        ? String(result.response_code)
        : '';
    if (responseCode === '01') {
      await setVerificationFailed();
      return respond({ error: 'The NIN could not be verified against your profile details.' }, 422);
    }
    if (responseCode !== '00') throw new Error('Prembly returned a non-success response code.');

    const identity = extractPremblyNinIdentity(result);
    if (!identity) throw new Error('Prembly response is missing the required name fields.');
    if (!matchesNinProfileName(profile.full_name || '', identity)) {
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
