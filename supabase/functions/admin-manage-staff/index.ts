import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createServerErrorId, logServerError } from '../_shared/server-errors.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_ROLES = ['customer_service', 'account_manager', 'finance'] as const;
const MAX_BODY_BYTES = 8 * 1024;
const USERS_PER_PAGE = 500;
const MAX_USER_PAGES = 100;

type StaffRole = typeof STAFF_ROLES[number];
type StaffRequest = {
  action?: unknown;
  email?: unknown;
  role?: unknown;
  user_id?: unknown;
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && STAFF_ROLES.includes(value as StaffRole);
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < USERS_PER_PAGE) return null;
  }
  throw new Error('The account directory lookup limit was reached.');
}

async function recordStaffChange(
  admin: SupabaseClient,
  actorId: string,
  targetId: string,
  action: string,
  role: string,
): Promise<string | null> {
  const { error } = await admin.from('admin_activity_log').insert({
    actor_id: actorId,
    action,
    entity_type: 'admin_staff_memberships',
    entity_id: targetId,
    details: { role },
  });
  if (!error) return null;
  const errorId = createServerErrorId();
  logServerError(errorId, 'admin-manage-staff.audit', error);
  return errorId;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return respond({ error: 'Request is too large.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const errorId = createServerErrorId();
    logServerError(errorId, 'admin-manage-staff.config', new Error('Required Supabase server configuration is missing.'));
    return respond({ error: 'Staff access is temporarily unavailable.', error_id: errorId }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond({ error: 'Sign in and try again.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const actorId = userData.user.id;

  try {
    const { data: actorMembership, error: membershipError } = await admin
      .from('admin_staff_memberships')
      .select('role')
      .eq('user_id', actorId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    const { data: actorProfile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', actorId)
      .maybeSingle();
    if (profileError) throw profileError;
    const isSuperAdmin = actorMembership
      ? actorMembership.role === 'super_admin'
      : actorProfile?.role === 'admin';
    if (!isSuperAdmin) {
      return respond({ error: 'Super administrator access is required.' }, 403);
    }

    const requestText = await request.text();
    if (new TextEncoder().encode(requestText).byteLength > MAX_BODY_BYTES) {
      return respond({ error: 'Request is too large.' }, 413);
    }

    let body: StaffRequest;
    try {
      const parsed: unknown = JSON.parse(requestText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return respond({ error: 'Invalid staff request.' }, 400);
      }
      body = parsed as StaffRequest;
    } catch {
      return respond({ error: 'Invalid staff request.' }, 400);
    }

    if (body.action === 'invite') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !isStaffRole(body.role)) {
        return respond({ error: 'Enter a valid email address and staff role.' }, 400);
      }

      const existingUser = await findUserByEmail(admin, email);
      const { data: invitedData, error: inviteError } = existingUser
        ? { data: { user: existingUser }, error: null }
        : await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: email.split('@')[0] },
        });
      if (inviteError) throw inviteError;
      if (!invitedData.user) throw new Error('Supabase did not return the invited user.');

      const targetId = invitedData.user.id;
      const { data: currentMembership, error: currentRoleError } = await admin
        .from('admin_staff_memberships')
        .select('role')
        .eq('user_id', targetId)
        .maybeSingle();
      if (currentRoleError) throw currentRoleError;
      const { data: targetProfile, error: targetProfileError } = await admin
        .from('profiles')
        .select('role')
        .eq('id', targetId)
        .maybeSingle();
      if (targetProfileError) throw targetProfileError;
      if (currentMembership?.role === 'super_admin' || targetProfile?.role === 'admin') {
        return respond({ error: 'Super administrator access cannot be changed here.' }, 409);
      }

      const { error: upsertError } = await admin.from('admin_staff_memberships').upsert({
        user_id: targetId,
        role: body.role,
        granted_by: actorId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (upsertError) {
        if (!existingUser) {
          const { error: profileCleanupError } = await admin
            .from('profiles')
            .delete()
            .eq('id', targetId);
          if (profileCleanupError) {
            logServerError(createServerErrorId(), 'admin-manage-staff.invite-profile-cleanup', profileCleanupError);
          }
          const { error: cleanupError } = await admin.auth.admin.deleteUser(targetId);
          if (cleanupError) logServerError(createServerErrorId(), 'admin-manage-staff.invite-cleanup', cleanupError);
        }
        throw upsertError;
      }

      const auditErrorId = await recordStaffChange(admin, actorId, targetId, existingUser ? 'role_updated' : 'invited', body.role);
      return respond({
        message: existingUser
          ? 'Staff access updated. They can sign in with their existing GetBuy account.'
          : 'Invitation sent. The staff member can set their password from the email link.',
        ...(auditErrorId ? { warning: `The access change succeeded, but its audit entry failed. Error ID: ${auditErrorId}` } : {}),
      });
    }

    if (body.action === 'set_role' || body.action === 'revoke') {
      if (typeof body.user_id !== 'string' || !UUID_PATTERN.test(body.user_id)) {
        return respond({ error: 'Choose a valid staff account.' }, 400);
      }
      if (body.user_id === actorId) return respond({ error: 'You cannot change your own staff access.' }, 409);

      const { data: currentMembership, error: currentRoleError } = await admin
        .from('admin_staff_memberships')
        .select('role')
        .eq('user_id', body.user_id)
        .maybeSingle();
      if (currentRoleError) throw currentRoleError;
      if (!currentMembership) return respond({ error: 'That account does not have staff access.' }, 404);
      const { data: targetProfile, error: targetProfileError } = await admin
        .from('profiles')
        .select('role')
        .eq('id', body.user_id)
        .maybeSingle();
      if (targetProfileError) throw targetProfileError;
      if (currentMembership.role === 'super_admin' || targetProfile?.role === 'admin') {
        return respond({ error: 'Super administrator access cannot be changed here.' }, 409);
      }

      if (body.action === 'revoke') {
        const { error: deleteError } = await admin
          .from('admin_staff_memberships')
          .delete()
          .eq('user_id', body.user_id);
        if (deleteError) throw deleteError;
        const auditErrorId = await recordStaffChange(admin, actorId, body.user_id, 'access_revoked', currentMembership.role);
        return respond({
          message: 'Staff access revoked.',
          ...(auditErrorId ? { warning: `The access change succeeded, but its audit entry failed. Error ID: ${auditErrorId}` } : {}),
        });
      }

      if (!isStaffRole(body.role)) return respond({ error: 'Choose a valid staff role.' }, 400);
      const { error: updateError } = await admin
        .from('admin_staff_memberships')
        .update({ role: body.role, granted_by: actorId, updated_at: new Date().toISOString() })
        .eq('user_id', body.user_id);
      if (updateError) throw updateError;
      const auditErrorId = await recordStaffChange(admin, actorId, body.user_id, 'role_updated', body.role);
      return respond({
        message: 'Staff role updated.',
        ...(auditErrorId ? { warning: `The access change succeeded, but its audit entry failed. Error ID: ${auditErrorId}` } : {}),
      });
    }

    return respond({ error: 'Choose a supported staff action.' }, 400);
  } catch (error) {
    const errorId = createServerErrorId();
    logServerError(errorId, 'admin-manage-staff', error);
    return respond({ error: 'Unable to update staff access. Please try again.', error_id: errorId }, 500);
  }
});
