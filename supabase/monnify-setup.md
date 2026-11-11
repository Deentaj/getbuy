# Monnify sandbox setup

The app's Monnify checkout is sandbox-only. It does not accept live credentials or switch to live mode. Keep the API key, secret key, and contract code in Supabase Edge Function secrets; never add them to the app, `.env.local`, or source control.

1. Apply the database migrations, including `20261107010000_monnify_test_payments.sql`.
2. Set these secrets for the linked Supabase project using values from the Monnify sandbox:

   ```text
   MONNIFY_API_KEY
   MONNIFY_SECRET_KEY
   MONNIFY_CONTRACT_CODE
   ```

   Use the Supabase Dashboard's Edge Function secrets settings or `supabase secrets set` in a private terminal. Do not send the values in chat.
3. Deploy `monnify-payment` and `monnify-webhook`.
   The checkout callback adapts to Expo Go's current development URL and to the `getbuy` scheme in installed builds. Redeploy both functions whenever these callback handlers change.
4. Configure the Monnify sandbox webhook URL as:

   ```text
   https://<project-ref>.supabase.co/functions/v1/monnify-webhook
   ```

Checkout and payment verification both query Monnify's sandbox API. Webhook payloads are only treated as prompts to independently verify transaction status, reference, currency, and amount with Monnify.

## In-app payment simulator

For local development only, the buyer checkout also offers a **Test payment simulation** option. It creates a sandbox test order and lets the buyer mark the payment successful or unsuccessful from the order details. This does not contact Monnify or move money. Successful simulated orders can enter the seller workflow, but never generate seller or rider payouts; unsuccessful simulations cancel the order and release its stock.

To enable it:

1. Apply `20261107020000_payment_simulator.sql` to the Supabase project.
2. Deploy the `payment-simulator` Edge Function.
3. Set the Edge Function secret `PAYMENT_SIMULATOR_ENABLED` to `true`. Keep `MONNIFY_ENVIRONMENT` unset or set it to `sandbox`; the simulator refuses to run in any other environment.
4. Restart the local Expo development server. The simulator option is hidden from production builds.

The server-side flag is required even in development. Do not enable the simulator for a production project.

## Delivery photo proof

Apply `20261107040000_delivery_photo_proof.sql` to create the private `delivery-proofs` bucket and the rider-only completion RPC. Assigned riders take a photo while an order is in transit; they must upload it before marking delivery complete. Buyers can view the signed photo on the order page before confirming receipt. The photo bucket is private and access is limited to the buyer, assigned rider, and admins.

Sellers receive their product sales net of any seller-funded promo discount; buyers pay delivery and service fees separately. Orders remain hidden from sellers and riders until payment is verified. Payouts remain ineligible until the buyer confirms receipt; cash orders also require an administrator-confirmed rider remittance. Payouts are still sent and recorded manually in the admin portal.

## Buyer marketplace features

Apply `20261107050000_buyer_marketplace_features.sql` and `20261107060000_saved_product_visibility.sql` to enable:

- Account-backed saved products, including products that are temporarily out of stock, with the local saved list retained for guest browsing.
- Same-store, same-price substitutions. The seller reserves available replacement stock, and an order cannot be marked ready while a buyer decision is pending. Declining releases the reserved replacement stock; accepting swaps the order item without changing its price.
- Store ratings and optional written reviews after the buyer confirms receipt. Sellers can view recent reviews for their store.
- Order issue reports for missing or damaged items, late delivery, payment problems, or other concerns. Buyers can see the support status and response on the order page; admins can manage reports in **Admin panel → Support & refunds**.
- Reorder from order history, which checks current product availability and stock before adding anything to the cart.

Apply `20261107070000_public_store_reviews.sql` to show published buyer ratings and comments on the public store page. Reviews are limited to verified completed purchases, buyer identities are not disclosed, and the page also lists currently available products from that store.

## Order chat, delivery windows, seller promos, and alerts

Apply `20261107200000_chat_slots_promos_alerts_calls.sql` to enable the latest marketplace features. Deploy the updated `monnify-payment` and `payment-simulator` Edge Functions after applying the migration so all checkout methods use the same delivery-window and promo validation.

- Buyers select a morning, afternoon, or evening delivery window at checkout. The selected window appears in buyer, seller, and rider order details.
- Buyers and the seller for each store in the order can exchange messages in a private, order-scoped chat. Live message updates use Supabase Realtime; the chat can still be reopened to load messages if realtime is unavailable.
- A seller can create one active 10%-off promo code for their store. A buyer can apply it to eligible items in their cart; delivery and service fees are excluded. The code can be redeemed once per buyer, and the seller's payout is reduced by the discount. Cancelling an order releases the redemption.
- Buyers can subscribe to back-in-stock alerts on unavailable saved products. The app shows restock alerts in Notifications. Sellers see low-stock listings and alerts when available inventory drops to five units or fewer.
- Riders can optionally save a phone number and enable buyer calls in their profile. The buyer can call only the assigned, opted-in rider while the order is actively out for delivery; phone numbers are never exposed through general profile views.

Delivery windows are named periods rather than guaranteed clock-time appointments. The low-stock alert threshold is five available units.

## Scheduling, cancellations, rewards, and support

Apply `20261107210000_growth_delivery_and_support.sql` after the previous marketplace migrations, then deploy the updated `monnify-payment`, `payment-simulator`, and `notify-order-event` Edge Functions. Do not apply this migration to production until the schema and feature flows have been reviewed and deployment is approved.

- Buyers can schedule delivery for today through 14 days ahead in 8am–12pm, 12pm–4pm, or 4pm–8pm windows. Past same-day windows are rejected by the database.
- Orders can be cancelled automatically before seller acceptance. Later buyer cancellation requests require admin review. Approved cancellations restore reserved stock once, reverse redeemed points, and create a manual refund record for eligible real Monnify payments.
- Admins review cancellation requests and record manual refund processing in **Admin panel → Support & refunds**. GetBuy does not initiate a refund transfer; admins must complete it through the payment provider and enter the transfer reference.
- Buyers earn 1 point per ₦100 of eligible product spend after confirming receipt of a real paid order. Every 100 points equal ₦100 off eligible products; redemption is capped at 10% of the product subtotal. Loyalty discounts are marketplace-funded and do not reduce seller payouts.
- Referral codes award 500 points each to the referrer and new buyer after the new buyer’s first real paid, buyer-confirmed order. Simulated payments are excluded.
- Sellers can review 30-day sales totals and update multiple stock counts from the inventory panel. Riders can view delivery history, delivery windows, remittance status, and recorded payout amounts.
- New chat messages, stock alerts, loyalty/referral rewards, cancellation updates, and refund status updates are stored in-app and can be dispatched to a user’s registered Expo push token.

The rewards rules are fixed in the migration. Refunds remain manual; no payment-provider refund API is called.

## Product sizes and selectable cart

Apply `20261108150000_product_variants_and_custom_cart.sql` after the marketplace migrations above, then deploy the updated `monnify-payment` and `payment-simulator` Edge Functions. Sellers can keep base-unit pricing and add separately priced, separately stocked size/pack options. Buyers can enter a custom base-unit amount or choose a seller-defined option; checkout revalidates the selected stock and price atomically. Cancellation and failed-payment flows return reserved quantities to the matching inventory.

The buyer cart supports category groups, item selection, removal, quantity changes, and promo previews against selected items. Existing product reviews remain verified store reviews; the product page does not invent product-specific ratings.
