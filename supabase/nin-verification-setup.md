# Seller and rider NIN verification

GetBuy requires seller and delivery-partner NIN verification during signup through Prembly's Basic Nigeria NIN endpoint. The `verify-nin` Edge Function sends the NIN to Prembly over HTTPS, compares the returned first, middle, and last names with the account name, and discards the provider response. GetBuy stores only the requested account role, verification status, consent, and timestamps; it does not store the NIN or the returned identity record.

Users must explicitly consent in the app before a verification request is sent. Verification attempts are limited to one per account per minute. A changed profile name invalidates the existing verification. New seller/rider signups remain buyer-role accounts until the server confirms the NIN and atomically activates the requested role, so direct API calls cannot bypass the check.

## Configure Prembly

1. Create and activate a Prembly account, complete any required business approval, and enable Nigeria Basic NIN verification.
2. Obtain a server-side Secret Key from the Prembly Integrations & API dashboard. Set it as the `PREMBLY_API_KEY` Supabase Edge Function secret. Never add this value to app or Vercel environment variables.
3. Use Prembly's sandbox credentials for testing, then switch to live credentials when ready. Both use `https://api.prembly.com`; the function calls `POST /api/v1/verification/api/nin_basic/` with the NIN in its JSON body and authenticates with `X-API-Key`.
4. Apply `20261128100000_nin_verification.sql` and deploy the `verify-nin` Edge Function.
5. Test the complete seller and rider signup/login flows with Prembly sandbox data before enabling production credentials.

Prembly's NIN Basic API uses `response_code` `00` for success and `01` for a record not found; other provider errors leave the account unverified and return a retryable error. If the secret is missing or Prembly is unavailable, the app does not mark the account as verified. The client never receives the Prembly key or raw identity response.
