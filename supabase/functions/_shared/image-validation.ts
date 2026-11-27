export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type SupportedImageType = typeof SUPPORTED_IMAGE_TYPES[number];

export function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function extensionForImageType(type: SupportedImageType) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  return 'webp';
}

export function decodeAndValidateImage(
  base64: string,
  declaredType: string | null | undefined,
  maxBytes = MAX_IMAGE_BYTES,
) {
  const encoded = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const normalized = encoded.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.match(/=*$/)?.[0].length || 0;
  const estimatedSize = Math.floor(normalized.length * 3 / 4) - padding;

  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || estimatedSize <= 0 || estimatedSize > maxBytes) {
    throw new Error('The selected image is invalid or exceeds the size limit.');
  }

  const binary = atob(normalized);
  if (binary.length > maxBytes) throw new Error('The selected image exceeds the size limit.');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const actualType = detectImageType(bytes);
  if (!actualType || (declaredType && declaredType !== actualType)) {
    throw new Error('The selected file is not a supported image.');
  }

  return { bytes, mimeType: actualType, extension: extensionForImageType(actualType) };
}
