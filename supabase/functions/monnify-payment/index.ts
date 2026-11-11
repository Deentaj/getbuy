import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createAdminClient,
  getAccessToken,
  getEnvironment,
  getMonnifyBaseUrl,
  getMonnifyOrder,
  verifyMonnifyPayment,
} from '../_shared/monnify.ts';

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

  try {
    const env = getEnvironment();
    const token = authorization.slice('Bearer '.length);
    const userClient = createClient(env.supabaseUrl, env.anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401);
    const admin = createAdminClient(env);
    const payload = await request.json() as {
      action?: string;
      order_id?: string;
      delivery_address?: string;
      product_ids?: string[];
      cart_items?: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
      payment_method?: string;
      delivery_slot?: string;
      promo_code?: string | null;
      delivery_date?: string;
      loyalty_points?: number;
      return_url?: string;
    };

    if (payload.action === 'checkout') {
      const cartItems = Array.isArray(payload.cart_items)
        ? payload.cart_items
        : (Array.isArray(payload.product_ids) ? payload.product_ids : [])
          .map((product_id) => ({ product_id, variant_id: null, quantity: 1 }));
      if (!payload.delivery_address?.trim() || cartItems.length === 0) {
        return respond({ error: 'A delivery address and at least one product are required.' }, 400);
      }
      if (cartItems.some((item) => !item || typeof item.product_id !== 'string'
        || (item.variant_id !== undefined && item.variant_id !== null && typeof item.variant_id !== 'string')
        || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
        return respond({ error: 'One or more cart quantities are invalid.' }, 400);
      }
      if (!userData.user.email) return respond({ error: 'Your account needs a confirmed email address for Monnify checkout.' }, 400);
      if (payload.payment_method !== 'bank_transfer' && payload.payment_method !== 'card') {
        return respond({ error: 'Choose a supported Monnify payment method.' }, 400);
      }
      const returnUrl = payload.return_url || 'getbuy://monnify-return';
      const isBrowserReturnUrl = returnUrl === 'browser';
      let isNativeReturnUrl = false;
      let isExpoGoReturnUrl = false;
      if (!isBrowserReturnUrl) {
        let parsedReturnUrl: URL;
        try {
          parsedReturnUrl = new URL(returnUrl);
        } catch {
          return respond({ error: 'The app return URL is invalid.' }, 400);
        }
        isNativeReturnUrl = parsedReturnUrl.protocol === 'getbuy:'
          && ((parsedReturnUrl.hostname === 'monnify-return' && parsedReturnUrl.pathname === '/')
            || (!parsedReturnUrl.hostname && parsedReturnUrl.pathname === '/monnify-return'));
        isExpoGoReturnUrl = ['exp:', 'exps:'].includes(parsedReturnUrl.protocol)
          && Boolean(parsedReturnUrl.hostname)
          && parsedReturnUrl.pathname === '/--/monnify-return';
        if ((!isNativeReturnUrl && !isExpoGoReturnUrl) || parsedReturnUrl.search || parsedReturnUrl.hash) {
          return respond({ error: 'The app return URL is not supported.' }, 400);
        }
      }
      if (cartItems.length > 100) return respond({ error: 'This cart has too many items.' }, 400);
      if (!['morning', 'afternoon', 'evening'].includes(payload.delivery_slot || '')) {
        return respond({ error: 'Choose a valid delivery time window.' }, 400);
      }
      if (!payload.delivery_date || typeof payload.loyalty_points !== 'number'
        || !Number.isInteger(payload.loyalty_points) || payload.loyalty_points < 0) {
        return respond({ error: 'Choose a delivery date and a valid rewards amount.' }, 400);
      }
      const { data: orderId, error: orderError } = await userClient.rpc('create_marketplace_order_with_cart_options', {
        p_delivery_address: payload.delivery_address.trim(),
        p_payment_method: 'monnify',
        p_cart_items: cartItems,
        p_delivery_slot: payload.delivery_slot,
        p_promo_code: payload.promo_code?.trim() || null,
        p_delivery_date: payload.delivery_date,
        p_loyalty_points: payload.loyalty_points,
      });
      if (orderError) throw orderError;
      if (typeof orderId !== 'string' || !orderId) throw new Error('GetBuy could not create the order.');

      try {
        const order = await getMonnifyOrder(admin, orderId);
        if (!order || order.buyer_id !== userData.user.id || !order.payment_reference) {
          throw new Error('Could not confirm the new order details.');
        }
        const { data: profile, error: profileError } = await admin.from('profiles')
          .select('full_name').eq('id', userData.user.id).maybeSingle();
        if (profileError) throw profileError;
        const accessToken = await getAccessToken(env);
        const redirectUrl = new URL(`${env.supabaseUrl}/functions/v1/monnify-webhook`);
        redirectUrl.searchParams.set('order_id', order.id);
        redirectUrl.searchParams.set('return_url', returnUrl);
        const response = await fetch(`${getMonnifyBaseUrl()}/api/v1/merchant/transactions/init-transaction`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Number(order.total),
            customerName: profile?.full_name || userData.user.email || 'GetBuy customer',
            customerEmail: userData.user.email,
            paymentReference: order.payment_reference,
            paymentDescription: `GetBuy order ${order.id.slice(0, 8)}`,
            currencyCode: 'NGN',
            contractCode: env.contractCode,
            redirectUrl: redirectUrl.toString(),
            paymentMethods: [payload.payment_method === 'bank_transfer' ? 'ACCOUNT_TRANSFER' : 'CARD'],
          }),
        });
        const transaction = await response.json();
        const checkoutUrl = transaction?.responseBody?.checkoutUrl;
        if (!response.ok || transaction.requestSuccessful !== true || typeof checkoutUrl !== 'string') {
          throw new Error('Monnify could not start checkout. The unpaid order will be cancelled.');
        }
        return respond({ order_id: order.id, payment_reference: order.payment_reference, checkout_url: checkoutUrl });
      } catch (error) {
        const { error: cancelError } = await admin.rpc('admin_cancel_unpaid_monnify_order', { p_order_id: orderId });
        if (cancelError) console.error('Unable to release stock for failed Monnify checkout.', cancelError);
        throw error;
      }
    }

    if (payload.action === 'verify') {
      if (!payload.order_id) return respond({ error: 'An order ID is required.' }, 400);
      const order = await getMonnifyOrder(admin, payload.order_id);
      if (!order || order.buyer_id !== userData.user.id) return respond({ error: 'Order not found.' }, 404);
      const paid = await verifyMonnifyPayment(env, admin, order);
      return respond({ paid, order_id: order.id, cancelled: order.status === 'cancelled' });
    }
    return respond({ error: 'A valid payment action is required.' }, 400);
  } catch (error) {
    console.error('Monnify payment request failed.', error);
    return respond({ error: error instanceof Error ? error.message : 'Monnify payment request failed.' }, 400);
  }
});
