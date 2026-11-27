# Upload and error-reporting security

GetBuy uses Supabase Storage as its object store; Cloudflare R2 is not required for this setup.

## Deploy order

Deploy the authenticated functions before the app starts using them, then apply the storage-policy migration:

```powershell
supabase functions deploy secure-image-upload
supabase functions deploy log-client-error
supabase db push
```

Deploy the web and mobile app after the functions and migration are live. The migration removes direct client uploads to the final image buckets; all image uploads must go through `secure-image-upload`.

## Image handling

The upload function verifies the actual JPEG, PNG, or WebP signature, enforces a 5 MiB limit, checks the user's authorization for the upload purpose, and generates a cryptographically random object name. Storage bucket limits and authenticated-user policies remain enforced independently of the client checks.

Verification documents and delivery proofs remain private. Product and profile images remain public as required by the existing app. Signature validation is not antivirus scanning or full image re-encoding; add a trusted image decoder/re-encoder if those protections are required.

## Error IDs

Displayed operational errors use a generic message and an error ID. Authenticated and anonymous clients can submit bounded reports to `log-client-error`; its logs contain the error message and stack with common credentials and email addresses redacted. Search the Supabase Edge Function logs by the displayed error ID. Error reports are size-limited and rate-limited per user or client IP.
