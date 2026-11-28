export const PRIVACY_POLICY_LAST_UPDATED = '29 November 2026';

export const PRIVACY_POLICY_SECTIONS = [
  {
    title: '1. About this notice',
    paragraphs: [
      'GetBuy is a local marketplace branded as powered by Stratos Limited. This notice explains how GetBuy handles personal information when you use the app and related services.',
      'For privacy questions or requests, contact support@getbuy.com.ng. We may ask you to verify your account before acting on a request.',
    ],
  },
  {
    title: '2. Information we handle',
    paragraphs: [
      'Depending on how you use GetBuy, we handle account details such as your name, email address, phone number, account type, and authentication records; delivery addresses and location details; seller, product, order, payment-status, and delivery information; and communications with support.',
      'If you use live chat, your messages and the replies are stored so you and authorized support staff can follow the conversation. GetBuy also processes limited device, notification-subscription, and diagnostic information needed to operate, secure, and troubleshoot the service.',
    ],
  },
  {
    title: '3. NIN verification for sellers and riders',
    paragraphs: [
      'Seller and delivery-partner (rider) accounts must pass NIN verification. With your explicit consent, GetBuy sends the 11-digit NIN you enter to Prembly for verification and compares the name returned by Prembly with the legal name on your GetBuy profile.',
      'GetBuy does not store the NIN number or the identity record returned by Prembly. GetBuy stores the verification outcome, requested account role, consent time, attempt time, and successful verification time to enforce the seller/rider requirement and secure your account. Prembly receives the NIN and processes it under its own applicable terms and privacy practices.',
      'The name comparison is automated. If verification fails or the details do not match, you cannot continue into the seller or rider account until verification succeeds. You can check your profile name and contact support@getbuy.com.ng if you believe a result is wrong. You may decline consent, but then you cannot register for or access seller/rider features that require verification.',
    ],
  },
  {
    title: '4. How we use information',
    paragraphs: [
      'We use information to create and secure accounts; operate the marketplace; process orders, payments, and delivery; connect buyers with sellers and assigned delivery partners; provide customer support; send service and order updates; prevent fraud and abuse; maintain records; and meet legal obligations.',
      'Depending on the activity, we process information to provide the service you request, meet legal obligations, pursue legitimate interests such as service security and fraud prevention, or with your consent. NIN verification requires your explicit consent.',
      'The FAQ helper in live chat uses a small set of approved, rule-based answers. It is not a general generative-AI service. Unmatched questions remain in the conversation for authorized customer-service staff to answer.',
    ],
  },
  {
    title: '5. When information is shared',
    paragraphs: [
      'We share only information needed for the service: relevant order and delivery details with the seller and assigned delivery partner; support conversations with the customer-service staff assigned to them and authorized administrators; and information with service providers that help run GetBuy.',
      'These providers include Supabase for authentication, database, and Edge Function services; Vercel for web hosting; Prembly for NIN verification; Monnify for online payment processing; Hostinger for the support mailbox; and Expo and other push-delivery providers for notifications. Providers process information to deliver their services under their applicable terms. We may also disclose information when required by law or needed to protect users, GetBuy, or the public.',
      'Service providers may process or store information in countries outside Nigeria. Where applicable, GetBuy uses safeguards required by data-protection law for such transfers.',
    ],
  },
  {
    title: '6. Retention and security',
    paragraphs: [
      'You can request deletion of a buyer, seller, or rider account from Profile. We block deletion while the account has active orders, pending payouts or cash remittances, or refunds still being processed. When deletion can proceed, GetBuy removes the sign-in account and identity details, replaces the account reference on retained transactions with a random deleted-account reference, removes profile contact and location details, payout and verification data, notifications, and account-linked chat content, and disables seller listings. Necessary order, payment, delivery, and dispute records may remain for accounting, legal, fraud-prevention, or dispute-resolution purposes and can include historical transaction details. Administrator accounts must be managed by a super administrator.',
      'GetBuy does not apply one automatic expiry period to every retained record. We keep information only as long as needed to provide GetBuy, support users, protect the service, resolve disputes, and meet legal or accounting obligations. If uploaded files cannot be removed automatically, we will direct you to support@getbuy.com.ng to complete cleanup.',
      'We use access controls and other reasonable technical and organizational safeguards. No internet service can guarantee absolute security.',
    ],
  },
  {
    title: '7. Your choices and rights',
    paragraphs: [
      'You can review and correct account details through the app where those controls are available. Subject to applicable law, you may request access to, correction of, deletion of, or restriction of your personal information, object to certain processing, request a copy of eligible information, or withdraw consent where processing relies on consent. Account deletion is available in Profile for buyer, seller, and rider accounts; contact support@getbuy.com.ng for other privacy requests or for help with a blocked deletion.',
      'Withdrawing NIN-verification consent does not undo a completed check and means you cannot use seller/rider features that require a verified NIN. To exercise a privacy right or challenge a verification result, contact support@getbuy.com.ng. You may also complain to the Nigeria Data Protection Commission.',
    ],
  },
  {
    title: '8. Changes to this notice',
    paragraphs: [
      'We may update this notice when GetBuy or its data practices change. We will publish the revised notice in the app and update the date above. If a change requires notice or consent under applicable law, we will provide it.',
    ],
  },
] as const;
