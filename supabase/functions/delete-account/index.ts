import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashIdentifier } from '../_shared/account-login-throttle.ts';
import { getAccountDeletionFailure } from '../_shared/account-deletion.ts';
import { createServerErrorId, logServerError } from '../_shared/server-errors.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BODY_BYTES = 1024;
const STORAGE_BUCKETS = ['profile-photos', 'product-images', 'verification-documents'];
const STORAGE_PAGE_SIZE = 100;

function confirmsDeletion(value: unknown): value is { confirm: true } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'confirm' in value
    && value.confirm === true;
}

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

async function removeUserStorageObjects(admin: ReturnType<typeof createClient>, userId: string) {
  for (const bucket of STORAGE_BUCKETS) {
    let offset = 0;
    const paths: string[] = [];
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(userId, {
        limit: STORAGE_PAGE_SIZE,
        offset,
      });
      if (error) throw error;
      if (!data) throw new Error(`Storage listing returned no result for ${bucket}.`);

      paths.push(...data
        .filter((entry) => entry.id !== null && !entry.name.includes('/'))
        .map((entry) => `${userId}/${entry.name}`));

      if (data.length < STORAGE_PAGE_SIZE) break;
      offset += data.length;
    }

    for (let index = 0; index < paths.length; index += STORAGE_PAGE_SIZE) {
      const { error: removeError } = await admin.storage.from(bucket).remove(
        paths.slice(index, index + STORAGE_PAGE_SIZE),
      );
      if (removeError) throw removeError;
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return respond({ error: 'Confirm account deletion to continue.' }, 413);

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return respond({ error: 'Confirm account deletion to continue.' }, 413);
    }
    payload = JSON.parse(body);
  } catch {
    return respond({ error: 'Confirm account deletion to continue.' }, 400);
  }
  if (!confirmsDeletion(payload)) return respond({ error: 'Confirm account deletion to continue.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const errorId = createServerErrorId();
    logServerError(errorId, 'delete-account.config', new Error('Required Supabase configuration is missing.'));
    return respond({ error: 'Account deletion is temporarily unavailable.', error_id: errorId }, 503);
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: anonymizeError } = await admin.rpc('anonymize_account_data', {
      p_user_id: userData.user.id,
    });
    if (anonymizeError) {
      const deletionFailure = getAccountDeletionFailure(anonymizeError);
      if (deletionFailure) return respond({ error: deletionFailure.message }, deletionFailure.status);
      throw anonymizeError;
    }

    let cleanupPending = false;
    let cleanupErrorId: string | null = null;
    if (userData.user.email) {
      try {
        const accountHash = await hashIdentifier(serviceRoleKey, `account:${userData.user.email.trim().toLowerCase()}`);
        const { error: throttleCleanupError } = await admin.rpc('account_login_clear_failures', {
          p_account_hash: accountHash,
        });
        if (throttleCleanupError) throw throttleCleanupError;
      } catch (throttleError) {
        cleanupPending = true;
        cleanupErrorId = createServerErrorId();
        logServerError(cleanupErrorId, 'delete-account.login-throttle-cleanup', throttleError);
      }
    }

    let deleteAuthError: unknown = null;
    try {
      const { error } = await admin.auth.admin.deleteUser(userData.user.id);
      deleteAuthError = error;
    } catch (error) {
      deleteAuthError = error;
    }
    if (deleteAuthError) {
      const errorId = createServerErrorId();
      logServerError(errorId, 'delete-account.auth-delete', deleteAuthError);
      let signInDisabled = false;
      try {
        const { error: banError } = await admin.auth.admin.updateUserById(userData.user.id, {
          ban_duration: '876000h',
        });
        if (banError) logServerError(errorId, 'delete-account.auth-ban', banError);
        else signInDisabled = true;
      } catch (banError) {
        logServerError(errorId, 'delete-account.auth-ban', banError);
      }
      try {
        await removeUserStorageObjects(admin, userData.user.id);
      } catch (storageError) {
        logServerError(errorId, 'delete-account.storage-cleanup', storageError);
      }
      return respond({
        error: `Your account details were anonymized, but GetBuy could not finish removing sign-in access. Contact support@getbuy.com.ng and provide reference ${errorId}.`,
        accountAnonymized: true,
        signInDisabled,
        cleanupPending: true,
        error_id: errorId,
      }, 500);
    }

    try {
      await removeUserStorageObjects(admin, userData.user.id);
    } catch (storageError) {
      cleanupPending = true;
      cleanupErrorId = createServerErrorId();
      logServerError(cleanupErrorId, 'delete-account.storage-cleanup', storageError);
    }

    return respond({
      deleted: true,
      cleanupPending,
      ...(cleanupPending
        ? {
          message: `Your account has been deleted, but some account-related data or uploaded files need cleanup. Contact support@getbuy.com.ng and provide reference ${cleanupErrorId}.`,
          error_id: cleanupErrorId,
        }
        : {}),
    });
  } catch (error) {
    const errorId = createServerErrorId();
    logServerError(errorId, 'delete-account', error);
    return respond({
      error: 'Account deletion is temporarily unavailable. Please try again or contact support@getbuy.com.ng.',
      error_id: errorId,
    }, 500);
  }
});
