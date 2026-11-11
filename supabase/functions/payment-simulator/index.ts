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

function requiredSetting(key: string) {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Payment simulator is not configured. Missing server setting: ${key}.`);
  return value;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    if (Deno.env.get('PAYMENT_SIMULATOR_ENABLED') !== 'true'
      || (Deno.env.get('MONNIFY_ENVIRONMENT') || 'sandbox') !== 'sandbox') {
      return respond({ error: 'The payment simulator is disabled. It can only be enabled for sandbox testing.' }, 403);
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in is required.' }, 401);

    const supabaseUrl = requiredSetting('SUPABASE_URL');
    const anonKey = requiredSetting('SUPABASE_ANON_KEY');
    const serviceRoleKey = requiredSetting('SUPABASE_SERVICE_ROLE_KEY');
    const token = authorization.slice('Bearer '.length);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return respond({ error: 'Your session is invalid. Sign in again.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payload = await request.json() as {
      action?: string;
      delivery_address?: string;
      product_ids?: string[];
      cart_items?: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
      delivery_slot?: string;
      promo_code?: string | null;
      delivery_date?: string;
      loyalty_points?: number;
      order_id?: string;
      result?: string;
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
      if (typeof orderId !== 'string' || !orderId) throw new Error('GetBuy could not create the test order.');

      const { error: prepareError } = await admin.rpc('admin_prepare_payment_simulation', {
        p_order_id: orderId,
        p_buyer_id: userData.user.id,
      });
      if (prepareError) {
        const { error: cancelError } = await admin.rpc('admin_cancel_unpaid_monnify_order', { p_order_id: orderId });
        if (cancelError) console.error('Unable to release stock for failed payment simulation setup.', cancelError);
        throw prepareError;
      }
      return respond({ order_id: orderId });
    }

    if (payload.action === 'result') {
      if (!payload.order_id || (payload.result !== 'success' && payload.result !== 'failure')) {
        return respond({ error: 'A test order and payment result are required.' }, 400);
      }
      const { data: order, error: orderError } = await admin.from('orders')
        .select('id, buyer_id, payment_simulated')
        .eq('id', payload.order_id)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order || order.buyer_id !== userData.user.id || order.payment_simulated !== true) {
        return respond({ error: 'Test order not found.' }, 404);
      }
      const { data: result, error: resultError } = await admin.rpc('admin_record_payment_simulation', {
        p_order_id: order.id,
        p_result: payload.result,
      });
      if (resultError) throw resultError;
      return respond({ result, order_id: order.id });
    }

    return respond({ error: 'A valid payment simulation action is required.' }, 400);
  } catch (error) {
    console.error('Payment simulation request failed.', error);
    return respond({ error: error instanceof Error ? error.message : 'Payment simulation failed.' }, 400);
  }
});
