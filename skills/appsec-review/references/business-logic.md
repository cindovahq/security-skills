# Business Logic, Race Conditions and Payments

## Contents
- How to find logic flaws
- Money, pricing and inventory
- Race conditions
- Workflow and state machines
- Quotas, limits and abuse
- Account and identity logic
- Verification

Scanners rarely find these. They come from understanding what the application **promises** and checking whether the server enforces it.

## How to find logic flaws

1. Write the invariants in plain language: "a coupon can be used once per user", "an order total equals the sum of server-side prices", "only approved posts are public", "a user can't owe a negative balance".
2. For each invariant, find where the server enforces it. If enforcement is client-side, implicit, or in a different request than the one that relies on it, investigate.
3. Ask, for each step: what if this request is **skipped, repeated, reordered, run concurrently, or sent with modified values**?

## Money, pricing and inventory

- **Client-supplied prices, totals, discounts, currencies or quantities** used server-side → **High/Critical**. The server must recompute from its own catalog.
- Negative or zero quantities/amounts; fractional quantities for indivisible items; integer overflow; rounding (accumulating fractions of cents); currency confusion (amount in JPY treated as USD cents).
- Coupons/gift cards/credits: stacking, reuse, applying after payment, transfer between accounts, refunding to a different payment method or as cash.
- Payment confirmation trusted from the **client redirect** (`/checkout/success?order=123`) instead of the provider's webhook or a server-side API check → free orders.
- Refund/cancellation flows that don't reverse granted benefits (credits, subscription upgrades, loyalty points).
- Subscription changes: downgrade keeps premium features, trial re-use with new accounts or aliases, plan ID tampering.

## Race conditions

Classic TOCTOU: check, then act, without atomicity.

```text
balance = getBalance(user)        # two concurrent requests both read 100
if balance >= amount: debit(...)  # both pass → double spend
```

Look for check-then-act on: balances and credits, coupon/voucher redemption, one-time tokens (reset, invite, OTP, magic links), inventory/seat booking, "first N users" promotions, likes/votes/ratings, username/email uniqueness, file processing states.

**Fixes:** atomic conditional updates (`UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?`, then check affected rows), database constraints (unique indexes), row locks (`SELECT ... FOR UPDATE`) inside transactions, idempotency keys, distributed locks for cross-service flows, and single-use token consumption via atomic delete/update.

Severity follows impact: double-spend of money or credits → High; duplicate likes → Low.

## Workflow and state machines

- Steps skippable by calling the final endpoint directly (skip payment, skip email verification, skip KYC, skip approval).
- State transitions accepted from input (`status: "approved"`) without checking the current state and the actor's permission for that transition.
- Draft/private/unpublished content reachable via direct ID, search, sitemap, RSS, API, or cached pages.
- Soft-deleted records still accessible or restorable by non-owners.
- Invitation flows: the invite token is not bound to the invited email, role escalation via invite parameters, invites remaining valid after the inviter loses access.

## Quotas, limits and abuse

- Per-user limits enforced only in the UI. Limits by account but not by organization (or vice versa). Creating unlimited free accounts to bypass quotas.
- Expensive operations without quotas: SMS/email sending (toll fraud, spam), AI/LLM calls (cost exhaustion), exports, video processing.
- Referral/reward abuse: self-referral, referral loops, rewards granted before the qualifying action is final.
- Enumeration through business features: "is this email registered", coupon code brute force, gift card balance checks without rate limits.

## Account and identity logic

- Email change without verifying the new address (account takeover via later password reset), or without re-authentication.
- Account merge/linking by unverified attributes (email, phone).
- Deleted accounts whose email can be re-registered to inherit data, roles or org memberships.
- Org membership removal that leaves API tokens, sessions or shared links active.
- Impersonation ("login as user") features: restricted to staff, audited, visibly indicated, and unable to perform the most sensitive actions (e.g. changing credentials).

## Verification

- Write a test per invariant, including negative cases (tampered price, replayed token, skipped step).
- Concurrency tests: fire N parallel requests at redeem/withdraw endpoints in a test environment and assert the invariant (e.g. a coupon was redeemed once). Use the test framework's parallel tools or a small script against a local instance. Never against production.
- Confirm payment state is derived from provider webhooks/API, not client redirects.

References: OWASP Business Logic Security Cheat Sheet (and WSTG-BUSL tests), OWASP API6:2023; OWASP A06:2025 Insecure Design; CWE-840, CWE-841, CWE-362, CWE-367, CWE-20, CWE-639.
