import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createServerErrorId, logServerError } from '../_shared/server-errors.ts';
import { getSupportChatFaqReply } from '../_shared/support-chat-faq.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;

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

  const requestText = await request.text();
  if (new TextEncoder().encode(requestText).byteLength > MAX_BODY_BYTES) {
    return respond({ error: 'Request is too large.' }, 413);
  }

  let payload: { conversation_id?: unknown; message_id?: unknown };
  try {
    payload = JSON.parse(requestText) as { conversation_id?: unknown; message_id?: unknown };
  } catch {
    return respond({ error: 'Invalid request.' }, 400);
  }
  if (
    typeof payload.conversation_id !== 'string'
    || !UUID_PATTERN.test(payload.conversation_id)
    || typeof payload.message_id !== 'string'
    || !UUID_PATTERN.test(payload.message_id)
  ) {
    return respond({ error: 'Invalid support chat message.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const errorId = createServerErrorId();
    logServerError(errorId, 'support-chat-faq.config', new Error('Required Supabase server configuration is missing.'));
    return respond({ error: 'The help assistant is temporarily unavailable.', error_id: errorId }, 500);
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

  try {
    const { data: message, error: messageError } = await admin
      .from('support_chat_messages')
      .select('id, conversation_id, sender_id, sender_type, body')
      .eq('id', payload.message_id)
      .eq('conversation_id', payload.conversation_id)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message || message.sender_type !== 'customer' || message.sender_id !== userData.user.id) {
      return respond({ error: 'This message is not available.' }, 404);
    }

    const { data: conversation, error: conversationError } = await admin
      .from('support_chat_conversations')
      .select('id, customer_id, status')
      .eq('id', payload.conversation_id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation || conversation.customer_id !== userData.user.id || conversation.status !== 'open') {
      return respond({ error: 'This support chat is not available.' }, 404);
    }

    const { data: existingReply, error: replyLookupError } = await admin
      .from('support_chat_messages')
      .select('id')
      .eq('reply_to_message_id', message.id)
      .maybeSingle();
    if (replyLookupError) throw replyLookupError;
    if (existingReply) return respond({ answered: true });

    const reply = getSupportChatFaqReply(message.body);
    const { error: insertError } = await admin.from('support_chat_messages').insert({
      conversation_id: conversation.id,
      sender_type: 'bot',
      body: reply.answer,
      reply_to_message_id: message.id,
    });
    if (insertError?.code === '23505') return respond({ answered: true });
    if (insertError) throw insertError;

    return respond({ answered: true, handoff: reply.handoff });
  } catch (error) {
    const errorId = createServerErrorId();
    logServerError(errorId, 'support-chat-faq', error);
    return respond({ error: 'The help assistant is temporarily unavailable.', error_id: errorId }, 500);
  }
});
