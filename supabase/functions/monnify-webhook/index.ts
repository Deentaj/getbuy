import {
  createAdminClient,
  getEnvironment,
  getMonnifyOrder,
  verifyMonnifyPayment,
} from '../_shared/monnify.ts';

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  try {
    const env = getEnvironment();
    const admin = createAdminClient(env);

    if (request.method === 'GET') {
      const requestUrl = new URL(request.url);
      const orderId = requestUrl.searchParams.get('order_id');
      if (!orderId) return new Response('Missing order reference.', { status: 400 });
      const order = await getMonnifyOrder(admin, orderId);
      if (!order) return new Response('Order not found.', { status: 404 });
      await verifyMonnifyPayment(env, admin, order);
      const returnUrlValue = requestUrl.searchParams.get('return_url') || 'getbuy://monnify-return';
      if (returnUrlValue === 'browser') {
        return new Response(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment update</title><body style="font-family:system-ui,sans-serif;padding:2rem;color:#143A73"><h1>Payment update received</h1><p>Return to GetBuy and check your order status. You can close this page.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      let returnUrl: URL;
      try {
        returnUrl = new URL(returnUrlValue);
      } catch {
        return new Response('Invalid app return URL.', { status: 400 });
      }
      const isNativeReturnUrl = returnUrl.protocol === 'getbuy:'
        && ((returnUrl.hostname === 'monnify-return' && returnUrl.pathname === '/')
          || (!returnUrl.hostname && returnUrl.pathname === '/monnify-return'));
      const isExpoGoReturnUrl = ['exp:', 'exps:'].includes(returnUrl.protocol)
        && Boolean(returnUrl.hostname)
        && returnUrl.pathname === '/--/monnify-return';
      if ((!isNativeReturnUrl && !isExpoGoReturnUrl) || returnUrl.search || returnUrl.hash) {
        return new Response('Unsupported app return URL.', { status: 400 });
      }
      returnUrl.searchParams.set('order_id', order.id);
      return Response.redirect(returnUrl.toString(), 302);
    }

    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
    const body = await request.json() as {
      paymentReference?: string;
      eventData?: { paymentReference?: string };
    };
    const paymentReference = body.eventData?.paymentReference || body.paymentReference;
    if (!paymentReference || typeof paymentReference !== 'string') {
      return respond({ error: 'Monnify payment reference is missing.' }, 400);
    }

    const { data: order, error } = await admin.from('orders')
      .select('id, buyer_id, total, payment_method, payment_status, payment_reference, status')
      .eq('payment_reference', paymentReference)
      .maybeSingle();
    if (error) throw error;
    if (!order) return respond({ error: 'GetBuy order not found.' }, 404);

    // The provider event only prompts a server-side status query; its payload is never trusted as proof of payment.
    const paid = await verifyMonnifyPayment(env, admin, order);
    return respond({ received: true, paid });
  } catch (error) {
    console.error('Monnify webhook handling failed.', error);
    return respond({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }, 500);
  }
});
