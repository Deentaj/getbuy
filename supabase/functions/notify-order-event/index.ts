import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type OrderEvent = 'new_order' | 'order_ready' | 'dispatch_pending';
type NotificationRow = {
  id: string;
  user_id: string;
  order_id: string | null;
  event_type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  push_sent_at: string | null;
};
type PushTokenRow = { user_id: string; expo_push_token: string };

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
    return respond({ error: 'Notification service is not configured.' }, 500);
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.slice('Bearer '.length);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401);

    const payload = await request.json() as { event_type?: OrderEvent; order_id?: string };
    if (
      (payload.event_type !== 'new_order'
        && payload.event_type !== 'order_ready'
        && payload.event_type !== 'dispatch_pending')
      || (payload.event_type !== 'dispatch_pending' && !payload.order_id)
    ) {
      return respond({ error: 'A valid order event and order ID are required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (payload.event_type !== 'dispatch_pending') {
      const { data: order, error: orderError } = await admin.from('orders')
        .select('id, buyer_id, status, payment_method, payment_status')
        .eq('id', payload.order_id!)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) return respond({ error: 'Order not found.' }, 404);

      if (payload.event_type === 'new_order') {
        if (order.buyer_id !== userData.user.id || order.status !== 'pending'
          || (order.payment_method === 'monnify' && order.payment_status !== 'paid')) {
          return respond({ error: 'You cannot send a new-order notification for this order.' }, 403);
        }
      } else {
        const { data: profile, error: profileError } = await admin.from('profiles')
          .select('role')
          .eq('id', userData.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (profile?.role !== 'seller' || order.status !== 'ready') {
          return respond({ error: 'You cannot send a ready-order notification for this order.' }, 403);
        }

        const { data: orderItems, error: itemsError } = await admin.from('order_items')
          .select('product_id')
          .eq('order_id', order.id);
        if (itemsError) throw itemsError;
        const productIds = [...new Set((orderItems || []).map((item) => item.product_id))];
        const { data: products, error: productsError } = productIds.length
          ? await admin.from('products').select('id, store_id').in('id', productIds)
          : { data: [], error: null };
        if (productsError) throw productsError;
        const storeIds = [...new Set((products || []).map((product) => product.store_id))];
        const { data: stores, error: storesError } = storeIds.length
          ? await admin.from('stores').select('owner_id').in('id', storeIds)
          : { data: [], error: null };
        if (storesError) throw storesError;
        if (!(stores || []).some((store) => store.owner_id === userData.user.id)) {
          return respond({ error: 'Only a seller for this order can send its ready notification.' }, 403);
        }
      }
    }

    let pendingQuery = admin.from('user_notifications')
      .select('id, user_id, order_id, event_type, title, body, payload, push_sent_at')
      .is('push_sent_at', null);
    if (payload.event_type === 'dispatch_pending') {
      pendingQuery = pendingQuery.eq('user_id', userData.user.id);
    } else {
      pendingQuery = pendingQuery
        .eq('order_id', payload.order_id!)
        .eq('event_type', payload.event_type);
    }
    const { data: pendingNotifications, error: notificationsError } = await pendingQuery;
    if (notificationsError) throw notificationsError;
    let notifications = (pendingNotifications || []) as NotificationRow[];
    const newOrderIds = [...new Set(notifications
      .filter((notification) => notification.event_type === 'new_order' && notification.order_id)
      .map((notification) => notification.order_id!))];
    if (newOrderIds.length > 0) {
      const { data: eligibleOrders, error: eligibilityError } = await admin.from('orders')
        .select('id, status, payment_method, payment_status')
        .in('id', newOrderIds);
      if (eligibilityError) throw eligibilityError;
      const eligibleOrderIds = new Set((eligibleOrders || [])
        .filter((order) => order.status === 'pending'
          && (order.payment_method !== 'monnify' || order.payment_status === 'paid'))
        .map((order) => order.id));
      notifications = notifications.filter((notification) =>
        notification.event_type !== 'new_order'
        || (notification.order_id !== null && eligibleOrderIds.has(notification.order_id)),
      );
    }
    if (notifications.length === 0) return respond({ sent: 0 });

    const userIds = [...new Set(notifications.map((notification) => notification.user_id))];
    const { data: pushTokens, error: tokensError } = await admin.from('notification_push_tokens')
      .select('user_id, expo_push_token')
      .in('user_id', userIds);
    if (tokensError) throw tokensError;

    const tokensByUser = new Map<string, string[]>();
    for (const tokenRow of (pushTokens || []) as PushTokenRow[]) {
      const tokens = tokensByUser.get(tokenRow.user_id) || [];
      tokens.push(tokenRow.expo_push_token);
      tokensByUser.set(tokenRow.user_id, tokens);
    }

    const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    let sent = 0;
    for (const notification of notifications) {
      const tokens = tokensByUser.get(notification.user_id) || [];
      let delivered = false;
      for (let offset = 0; offset < tokens.length; offset += 100) {
        const chunk = tokens.slice(offset, offset + 100);
        const messages = chunk.map((to) => ({
          to,
          title: notification.title,
          body: notification.body,
          sound: 'default',
          channelId: 'orders',
          data: {
            ...notification.payload,
            notification_id: notification.id,
            order_id: notification.order_id,
            event_type: notification.event_type,
          },
        }));
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (expoAccessToken) headers.Authorization = 'Bearer ' + expoAccessToken;
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
        });
        if (!response.ok) {
          console.error('Expo Push API rejected a notification batch.', await response.text());
          continue;
        }

        const result = await response.json() as {
          data?: Array<{ status?: string; details?: { error?: string } }>;
        };
        for (let index = 0; index < (result.data || []).length; index += 1) {
          const ticket = result.data?.[index];
          if (ticket?.status === 'ok') delivered = true;
          if (ticket?.details?.error === 'DeviceNotRegistered') {
            const { error: deleteError } = await admin.from('notification_push_tokens')
              .delete()
              .eq('expo_push_token', chunk[index]);
            if (deleteError) console.error('Unable to remove an expired push token.', deleteError);
          }
        }
      }

      if (delivered) {
        const { error: updateError } = await admin.from('user_notifications')
          .update({ push_sent_at: new Date().toISOString() })
          .eq('id', notification.id);
        if (updateError) throw updateError;
        sent += 1;
      }
    }

    return respond({ sent });
  } catch (error) {
    console.error('Unable to dispatch order notifications.', error);
    return respond({ error: 'Unable to dispatch order notifications.' }, 500);
  }
});
