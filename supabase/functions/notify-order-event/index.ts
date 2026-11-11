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
type WebPushSubscription = { user_id: string; endpoint: string; p256dh: string; auth: string };

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const encoder = new TextEncoder();

function decodeBase64Url(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function concatenate(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hmacSha256(keyBytes: Uint8Array, value: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, value));
}

async function hkdfExpand(key: Uint8Array, info: Uint8Array, length: number) {
  let previous = new Uint8Array();
  const blocks: Uint8Array[] = [];
  let totalLength = 0;
  for (let index = 1; totalLength < length; index += 1) {
    previous = await hmacSha256(key, concatenate(previous, info, new Uint8Array([index])));
    blocks.push(previous);
    totalLength += previous.length;
  }
  return concatenate(...blocks).slice(0, length);
}

function base64UrlJson(value: Record<string, string | number>) {
  return encodeBase64Url(encoder.encode(JSON.stringify(value)));
}

async function createVapidAuthorization(endpoint: URL) {
  const publicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('WEB_PUSH_VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Web push VAPID server settings are missing.');
  }
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
    throw new Error('Web push VAPID subject must be a mailto or HTTPS contact.');
  }
  const publicBytes = decodeBase64Url(publicKey);
  const privateBytes = decodeBase64Url(privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error('Web push VAPID server keys are invalid.');
  }
  const signingKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC',
    crv: 'P-256',
    x: encodeBase64Url(publicBytes.slice(1, 33)),
    y: encodeBase64Url(publicBytes.slice(33)),
    d: encodeBase64Url(privateBytes),
    ext: true,
    key_ops: ['sign'],
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = base64UrlJson({ typ: 'JWT', alg: 'ES256' });
  const claims = base64UrlJson({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  });
  const unsignedToken = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    encoder.encode(unsignedToken),
  ));
  return `vapid t=${unsignedToken}.${encodeBase64Url(signature)}, k=${publicKey}`;
}

async function encryptWebPush(subscription: WebPushSubscription, message: string) {
  const clientPublicKey = decodeBase64Url(subscription.p256dh);
  const authSecret = decodeBase64Url(subscription.auth);
  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 4 || authSecret.length !== 16) {
    throw new Error('Browser push encryption keys are invalid.');
  }
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    serverKeys.privateKey,
    256,
  ));
  const keyInfo = concatenate(encoder.encode('WebPush: info\0'), clientPublicKey, serverPublicKey);
  const inputKeyMaterial = await hkdfExpand(await hmacSha256(authSecret, sharedSecret), keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pseudoRandomKey = await hmacSha256(salt, inputKeyMaterial);
  const contentKey = await hkdfExpand(pseudoRandomKey, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(pseudoRandomKey, encoder.encode('Content-Encoding: nonce\0'), 12);
  const encryptionKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  const plaintext = concatenate(encoder.encode(message), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encryptionKey, plaintext));
  const recordHeader = new Uint8Array(21);
  recordHeader.set(salt, 0);
  new DataView(recordHeader.buffer).setUint32(16, 4096);
  recordHeader[20] = serverPublicKey.length;
  return concatenate(recordHeader, serverPublicKey, ciphertext);
}

async function sendWebPush(subscription: WebPushSubscription, payload: Record<string, unknown>) {
  const endpoint = new URL(subscription.endpoint);
  const body = await encryptWebPush(subscription, JSON.stringify(payload));
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await createVapidAuthorization(endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
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
    const { data: webPushSubscriptions, error: webPushError } = await admin.from('web_push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .in('user_id', userIds);
    if (webPushError) throw webPushError;

    const tokensByUser = new Map<string, string[]>();
    for (const tokenRow of (pushTokens || []) as PushTokenRow[]) {
      const tokens = tokensByUser.get(tokenRow.user_id) || [];
      tokens.push(tokenRow.expo_push_token);
      tokensByUser.set(tokenRow.user_id, tokens);
    }
    const webSubscriptionsByUser = new Map<string, WebPushSubscription[]>();
    for (const subscription of (webPushSubscriptions || []) as WebPushSubscription[]) {
      const subscriptions = webSubscriptionsByUser.get(subscription.user_id) || [];
      subscriptions.push(subscription);
      webSubscriptionsByUser.set(subscription.user_id, subscriptions);
    }

    const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    const hasWebPushSettings = Boolean(
      Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')
      && Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')
      && Deno.env.get('WEB_PUSH_VAPID_SUBJECT'),
    );
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

      const webSubscriptions = webSubscriptionsByUser.get(notification.user_id) || [];
      if (webSubscriptions.length > 0 && !hasWebPushSettings) {
        console.error('Browser push is configured for a user, but VAPID server settings are missing.');
      }
      if (hasWebPushSettings) {
        for (const subscription of webSubscriptions) {
          try {
            const response = await sendWebPush(subscription, {
              title: notification.title,
              body: notification.body,
              notification_id: notification.id,
              order_id: notification.order_id,
              event_type: notification.event_type,
            });
            if (response.ok) {
              delivered = true;
            } else if (response.status === 404 || response.status === 410) {
              const { error: deleteError } = await admin.from('web_push_subscriptions')
                .delete()
                .eq('endpoint', subscription.endpoint);
              if (deleteError) console.error('Unable to remove an expired browser push subscription.', deleteError);
            } else {
              console.error('Browser Push service rejected a notification.', response.status, await response.text());
            }
          } catch (error) {
            console.error('Unable to send a browser push notification.', error);
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
