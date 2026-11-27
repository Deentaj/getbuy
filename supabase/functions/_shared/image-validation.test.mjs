import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAndValidateImage, MAX_IMAGE_BYTES } from './image-validation.ts';

const sampleImages = [
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff, 0xd9] },
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50] },
];

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

for (const image of sampleImages) {
  test(`accepts bytes matching ${image.mimeType}`, () => {
    const result = decodeAndValidateImage(toBase64(image.bytes), image.mimeType);
    assert.equal(result.mimeType, image.mimeType);
    assert.ok(result.bytes instanceof Uint8Array);
  });
}

test('rejects a declared MIME type that does not match the file bytes', () => {
  assert.throws(
    () => decodeAndValidateImage(toBase64(sampleImages[0].bytes), 'image/png'),
    /not a supported image/,
  );
});

test('rejects unsupported image signatures', () => {
  assert.throws(
    () => decodeAndValidateImage(toBase64([0x00, 0x01, 0x02]), 'image/jpeg'),
    /not a supported image/,
  );
});

test('rejects files that exceed the upload limit before decoding them', () => {
  const tooLargeBase64 = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1) * 4 / 3));
  assert.throws(
    () => decodeAndValidateImage(tooLargeBase64, 'image/jpeg'),
    /exceeds the size limit/,
  );
});
