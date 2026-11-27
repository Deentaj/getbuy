import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logServerError } from '../_shared/server-errors.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REPORT_BYTES = 16 * 1024;
const reportWindows = new Map<string, { startedAt: number; count: number }>();

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getBoundedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return respond({ error: 'Error reporting is temporarily unavailable.' }, 503);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REPORT_BYTES) return respond({ error: 'Error report is too large.' }, 413);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData.user?.id || null;

  const reportText = await request.text();
  if (new TextEncoder().encode(reportText).byteLength > MAX_REPORT_BYTES) {
    return respond({ error: 'Error report is too large.' }, 413);
  }

  let report: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(reportText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return respond({ error: 'Invalid error report.' }, 400);
    }
    report = parsed as Record<string, unknown>;
  } catch {
    return respond({ error: 'Invalid error report.' }, 400);
  }

  if (typeof report.error_id !== 'string' || !UUID_PATTERN.test(report.error_id)) {
    return respond({ error: 'Invalid error report.' }, 400);
  }
  const now = Date.now();
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rateLimitKey = userId ? `user:${userId}` : `ip:${clientIp}`;
  const maxReports = userId ? 20 : 5;
  const window = reportWindows.get(rateLimitKey);
  if (window && now - window.startedAt < 60_000 && window.count >= maxReports) {
    return respond({ error: 'Too many error reports.' }, 429);
  }
  if (!window || now - window.startedAt >= 60_000) {
    reportWindows.set(rateLimitKey, { startedAt: now, count: 1 });
  } else {
    window.count += 1;
  }

  const source = report.source === 'admin' ? 'admin' : 'marketplace';
  const safeReport = {
    name: getBoundedString(report.name, 120) || 'Error',
    message: getBoundedString(report.message, 4_000) || 'Unknown error',
    stack: getBoundedString(report.stack, 8_000),
    code: getBoundedString(report.code, 120),
    details: getBoundedString(report.details, 2_000),
    hint: getBoundedString(report.hint, 2_000),
  };
  console.error(JSON.stringify({
    error_id: report.error_id,
    user_id: userId,
    source,
    context: getBoundedString(report.context, 160),
  }));
  logServerError(report.error_id, `client.${source}.${getBoundedString(report.context, 160)}`, safeReport);
  return respond({ accepted: true });
});
