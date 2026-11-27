import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createServerErrorId, logServerError } from '../_shared/server-errors.ts';
import { detectImageType, extensionForImageType, MAX_IMAGE_BYTES } from '../_shared/image-validation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(error: unknown, status: number, message: string, context: string) {
  const errorId = createServerErrorId();
  logServerError(errorId, context, error);
  return respond({ error: message, error_id: errorId }, status);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return fail(new Error('Unsupported request method.'), 405, 'Unable to upload this image.', 'secure-image-upload.method');
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return fail(new Error('Missing bearer token.'), 401, 'Sign in and try again.', 'secure-image-upload.auth');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return fail(new Error('Required Supabase server configuration is missing.'), 500, 'Image uploads are temporarily unavailable.', 'secure-image-upload.config');
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return fail(new Error('Image request exceeds the maximum size.'), 413, 'Choose an image smaller than 5 MB.', 'secure-image-upload.size');
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return fail(userError || new Error('Authenticated user could not be verified.'), 401, 'Sign in and try again.', 'secure-image-upload.auth');
    }

    const form = await request.formData();
    const file = form.get('file');
    const purpose = form.get('purpose');
    if (!(file instanceof File) || typeof purpose !== 'string') {
      return fail(new Error('The image upload form is invalid.'), 400, 'Choose a supported image and try again.', 'secure-image-upload.form');
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return fail(new Error(`Image size ${file.size} is outside the allowed limit.`), 413, 'Choose an image smaller than 5 MB.', 'secure-image-upload.size');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const actualType = detectImageType(bytes);
    if (!actualType || (file.type && file.type !== actualType)) {
      return fail(new Error('Image signature did not match a supported image type.'), 415, 'Choose a valid JPG, PNG, or WebP image.', 'secure-image-upload.type');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userId = userData.user.id;
    const extension = extensionForImageType(actualType);
    const fileId = crypto.randomUUID();
    let bucket: string;
    let path: string;

    if (purpose === 'profile-photo') {
      bucket = 'profile-photos';
      path = `${userId}/${fileId}.${extension}`;
    } else if (purpose === 'product-image') {
      const { data: store, error: storeError } = await admin
        .from('stores')
        .select('id')
        .eq('owner_id', userId)
        .maybeSingle();
      if (storeError) throw storeError;
      if (!store) return fail(new Error('The authenticated user does not own a seller store.'), 403, 'You are not allowed to upload this image.', 'secure-image-upload.product-access');
      bucket = 'product-images';
      path = `${userId}/${fileId}.${extension}`;
    } else if (purpose === 'verification-document') {
      const documentType = form.get('document_type');
      const sellerDocument = documentType === 'storefront' || documentType === 'seller_id';
      const riderDocument = documentType === 'plate' || documentType === 'roadworthiness' || documentType === 'driver_license';
      if (!sellerDocument && !riderDocument) {
        return fail(new Error('Verification document type is invalid.'), 400, 'Unable to upload this verification image.', 'secure-image-upload.verification-type');
      }

      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile || (sellerDocument && profile.role !== 'seller') || (riderDocument && profile.role !== 'delivery')) {
        return fail(new Error('The authenticated user is not eligible for this verification document.'), 403, 'You are not allowed to upload this verification image.', 'secure-image-upload.verification-access');
      }
      if (sellerDocument) {
        const { data: store, error: storeError } = await admin
          .from('stores')
          .select('id')
          .eq('owner_id', userId)
          .maybeSingle();
        if (storeError) throw storeError;
        if (!store) return fail(new Error('The seller profile has no store.'), 403, 'Save your store profile and try again.', 'secure-image-upload.verification-store');
      }

      bucket = 'verification-documents';
      path = `${userId}/${documentType}-${fileId}.${extension}`;
    } else if (purpose === 'delivery-proof') {
      const orderId = form.get('order_id');
      if (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId)) {
        return fail(new Error('Delivery proof order ID is invalid.'), 400, 'Unable to upload this delivery photo.', 'secure-image-upload.delivery-order');
      }
      const { data: order, error: orderError } = await admin
        .from('orders')
        .select('assigned_delivery_id, status')
        .eq('id', orderId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order || order.assigned_delivery_id !== userId || order.status !== 'out_for_delivery') {
        return fail(new Error('The authenticated user is not assigned to an active delivery.'), 403, 'You are not allowed to upload proof for this delivery.', 'secure-image-upload.delivery-access');
      }
      bucket = 'delivery-proofs';
      path = `${orderId}/${userId}/${fileId}.${extension}`;
    } else {
      return fail(new Error('Image upload purpose is invalid.'), 400, 'Unable to upload this image.', 'secure-image-upload.purpose');
    }

    const { error: uploadError } = await admin.storage.from(bucket).upload(path, bytes, {
      contentType: actualType,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    if (purpose === 'profile-photo') {
      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .update({ avatar_path: path })
        .eq('id', userId)
        .select('id')
        .maybeSingle();
      if (profileError || !profile) {
        const { error: cleanupError } = await admin.storage.from(bucket).remove([path]);
        if (cleanupError) logServerError(createServerErrorId(), 'secure-image-upload.profile-cleanup', cleanupError);
        throw profileError || new Error('The profile photo could not be attached to the account.');
      }
    }

    const result: Record<string, unknown> = { bucket, path };
    if (bucket === 'profile-photos' || bucket === 'product-images') {
      result.public_url = admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }
    return respond(result);
  } catch (error) {
    return fail(error, 500, 'The image could not be uploaded. Please try again.', 'secure-image-upload');
  }
});
