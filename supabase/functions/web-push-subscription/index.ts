import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function hasExpectedBase64UrlLength(value: string, expectedLength: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const padding = '='.repeat((4 - value.length % 4) % 4);
  try {
    return atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')).length === expectedLength;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond({ error: 'Web push service is not configured.' }, 500);
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.slice('Bearer '.length);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401);

    const payload = await request.json() as {
      action?: string;
      endpoint?: string;
      p256dh?: string;
      auth?: string;
    };
    if (!payload.endpoint || payload.endpoint.length > 4096) {
      return respond({ error: 'A valid browser push endpoint is required.' }, 400);
    }
    let endpoint: URL;
    try {
      endpoint = new URL(payload.endpoint);
    } catch {
      return respond({ error: 'The browser push endpoint is invalid.' }, 400);
    }
    const supportedPushHost = endpoint.hostname === 'fcm.googleapis.com'
      || endpoint.hostname.endsWith('.push.apple.com')
      || endpoint.hostname === 'updates.push.services.mozilla.com';
    if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !supportedPushHost) {
      return respond({ error: 'The browser push endpoint is not supported.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (payload.action === 'status') {
      const { data, error } = await admin.from('web_push_subscriptions')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('endpoint', payload.endpoint)
        .maybeSingle();
      if (error) throw error;
      return respond({ enabled: Boolean(data) });
    }

    if (payload.action === 'unsubscribe') {
      const { error } = await admin.from('web_push_subscriptions')
        .delete()
        .eq('user_id', userData.user.id)
        .eq('endpoint', payload.endpoint);
      if (error) throw error;
      return respond({ removed: true });
    }

    if (payload.action !== 'subscribe' || !payload.p256dh || !payload.auth
      || !hasExpectedBase64UrlLength(payload.p256dh, 65)
      || !hasExpectedBase64UrlLength(payload.auth, 16)) {
      return respond({ error: 'A valid browser push subscription is required.' }, 400);
    }
    const { error: saveError } = await admin.from('web_push_subscriptions').upsert({
      user_id: userData.user.id,
      endpoint: payload.endpoint,
      p256dh: payload.p256dh,
      auth: payload.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (saveError) throw saveError;
    return respond({ subscribed: true });
  } catch (error) {
    console.error('Unable to update the browser push subscription.', error);
    return respond({ error: 'Unable to save browser push settings.' }, 500);
  }
});
