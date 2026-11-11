import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type MonnifyEnvironment = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  apiKey: string;
  secretKey: string;
  contractCode: string;
};

export type MonnifyOrder = {
  id: string;
  buyer_id: string;
  total: number;
  payment_method: string;
  payment_status: string;
  payment_reference: string | null;
  status: string;
};

export function getEnvironment(): MonnifyEnvironment {
  const requiredSetting = (key: string) => {
    const value = Deno.env.get(key);
    if (!value) throw new Error(`Monnify service is not configured. Missing server setting: ${key}.`);
    return value;
  };
  return {
    supabaseUrl: requiredSetting('SUPABASE_URL'),
    anonKey: requiredSetting('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredSetting('SUPABASE_SERVICE_ROLE_KEY'),
    apiKey: requiredSetting('MONNIFY_API_KEY'),
    secretKey: requiredSetting('MONNIFY_SECRET_KEY'),
    contractCode: requiredSetting('MONNIFY_CONTRACT_CODE'),
  };
}

export function createAdminClient(env: MonnifyEnvironment): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getMonnifyBaseUrl() {
  const environment = Deno.env.get('MONNIFY_ENVIRONMENT') || 'sandbox';
  if (environment !== 'sandbox') throw new Error('Only Monnify sandbox mode is enabled in this integration.');
  return 'https://sandbox.monnify.com';
}

export async function getAccessToken(env: MonnifyEnvironment) {
  const response = await fetch(`${getMonnifyBaseUrl()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.apiKey}:${env.secretKey}`)}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.requestSuccessful !== true || !payload.responseBody?.accessToken) {
    throw new Error('Monnify sandbox authentication failed. Confirm the test API credentials in the secure function settings.');
  }
  return payload.responseBody.accessToken as string;
}

export async function verifyMonnifyPayment(
  env: MonnifyEnvironment,
  admin: SupabaseClient,
  order: MonnifyOrder,
) {
  if (order.payment_method !== 'monnify' || !order.payment_reference) {
    throw new Error('This order does not have a Monnify payment reference.');
  }
  if (order.payment_status === 'paid') return true;
  if (order.payment_status !== 'pending') {
    throw new Error('This order is not awaiting a Monnify payment.');
  }

  const token = await getAccessToken(env);
  const query = new URLSearchParams({ paymentReference: order.payment_reference });
  const response = await fetch(`${getMonnifyBaseUrl()}/api/v2/merchant/transactions/query?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.requestSuccessful !== true) {
    throw new Error('Monnify could not verify this payment yet.');
  }
  const transaction = payload.responseBody;
  if (transaction?.paymentStatus !== 'PAID') return false;
  const returnedCurrency = transaction.currencyCode ?? transaction.currency;
  if (returnedCurrency != null
    && (typeof returnedCurrency !== 'string' || returnedCurrency.toUpperCase() !== 'NGN')) {
    throw new Error('Monnify returned a transaction that does not match this order.');
  }
  // The query is already keyed by our order reference; Monnify may return its own paymentReference.
  const amountPaid = Number(transaction.amountPaid);
  if (!Number.isFinite(amountPaid)) throw new Error('Monnify returned an invalid paid amount.');

  const { error } = await admin.rpc('admin_record_monnify_payment', {
    p_order_id: order.id,
    p_payment_reference: order.payment_reference,
    p_amount_paid: amountPaid,
  });
  if (error) throw new Error(`Payment was verified by Monnify but could not be recorded: ${error.message}`);
  return true;
}

export async function getMonnifyOrder(admin: SupabaseClient, orderId: string) {
  const { data, error } = await admin.from('orders')
    .select('id, buyer_id, total, payment_method, payment_status, payment_reference, status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data as MonnifyOrder | null;
}
