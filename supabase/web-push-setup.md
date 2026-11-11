# Browser push setup

Browser push uses the VAPID key pair in the local, ignored `.env.local` file. Never commit or share `WEB_PUSH_VAPID_PRIVATE_KEY`.

1. Apply `migrations/20261111170000_web_push_subscriptions.sql` to the Supabase project.
2. In Supabase Dashboard → Edge Functions → Secrets, set these secrets using the matching values from `.env.local`:
   - `WEB_PUSH_VAPID_PUBLIC_KEY`
   - `WEB_PUSH_VAPID_PRIVATE_KEY`
   - `WEB_PUSH_VAPID_SUBJECT` (for example, `mailto:support@getbuy.com.ng`)
3. Deploy `web-push-subscription` and the updated `notify-order-event` Edge Functions.
4. Deploy the web app with the committed VAPID public key in `app.json`.
5. Sign in on the HTTPS site, open Notifications, and choose **Enable browser alerts**. The browser asks permission only after that user action.

The public VAPID key may be included in the app; the private key must remain an Edge Function secret. Browser push requires a supported browser and HTTPS. On iOS/iPadOS, web push is available only for a web app added to the Home Screen.
