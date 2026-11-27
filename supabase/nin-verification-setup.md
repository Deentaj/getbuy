# Seller and rider NIN verification

GetBuy requires seller and delivery-partner NIN verification during signup through Dojah's basic Nigeria NIN lookup. The `verify-nin` Edge Function sends the NIN to Dojah over HTTPS, compares the returned first, middle, and last names with the account name, and discards the provider response. GetBuy stores only the requested account role, verification status, consent, and timestamps; it does not store the NIN or the returned identity record.

Users must explicitly consent in the app before a verification request is sent. Verification attempts are limited to one per account per minute. A changed profile name invalidates the existing verification. New seller/rider signups remain buyer-role accounts until the server confirms the NIN and atomically activates the requested role, so direct API calls cannot bypass the check.

## Configure Dojah

1. Create and activate a Dojah account, complete any required business approval, and obtain an App ID and secret key.
2. Set `DOJAH_APP_ID` and `DOJAH_SECRET_KEY` as Supabase Edge Function secrets. Never add these values to app or Vercel environment variables.
3. Optionally set `DOJAH_API_BASE_URL` to `https://sandbox.dojah.io` for sandbox testing. Production defaults to `https://api.dojah.io`; only these two HTTPS hosts are accepted.
4. Apply `20261128100000_nin_verification.sql` and deploy the `verify-nin` Edge Function.
5. Test the complete seller and rider signup/login flows with Dojah sandbox data before enabling production credentials.

If the secrets are missing or Dojah is unavailable, the app does not mark the account as verified; it displays a retry message. The client never receives the Dojah secret key or raw identity response.
