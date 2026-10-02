# WooCommerce Security

## Contents
- Architecture notes
- Order access (IDOR)
- Price, cart and coupon integrity
- Checkout and Store API extensions
- Payment gateways and callbacks
- REST API keys and webhooks
- Customer data and PII
- Roles: shop manager and customers
- Verification

## Architecture notes

- **HPOS** (High-Performance Order Storage, default for new stores since WooCommerce 8.2) stores orders in custom tables (`wc_orders`, `wc_orders_meta`, …) instead of `wp_posts`. Extensions should use the CRUD API (`wc_get_order()`, `$order->get_meta()`, `wc_get_orders()`). Raw SQL against `wp_posts` for orders is a compatibility bug, and raw SQL against either store needs `$wpdb->prepare` (see `sql-injection.md`).
- Customers are WordPress users with the `customer` role, created at checkout or by registration. On stores with account creation enabled, **anyone can become a customer**.
- WooCommerce maps meta capabilities for customers: `view_order`, `pay_for_order`, `order_again`, `cancel_order` (checked with `current_user_can( 'view_order', $order_id )`).
- Guest orders are accessed with the **order key** (`wc_order_…`); check with `$order->key_is_valid( $key )`.

## Order access (IDOR)

```php
$order = wc_get_order( absint( $_GET['order_id'] ) );       // any order by ID
wp_send_json( $order->get_data() );                           // name, address, email, phone, items
```

- Any custom endpoint (AJAX, REST, shortcode, "download invoice", "track order", "upload proof") that loads an order or subscription by ID must check `current_user_can( 'view_order', $order_id )` (customers), `$order->get_customer_id() === get_current_user_id()`, a valid order key (guests), or `current_user_can( 'edit_shop_orders' )` (staff).
- Order notes, refunds, status changes (`$order->update_status()`), and file attachments: same checks, plus a nonce.
- Sequential order numbers make IDOR easy to exploit. Severity: other customers' PII → **High**. Status/refund manipulation → **High/Critical**.

## Price, cart and coupon integrity

- **Never take prices, totals, discounts or fees from the request.** Common bug: product add-on or "name your price" plugins storing a posted price in cart item data and applying it in `woocommerce_before_calculate_totals` (`$cart_item['data']->set_price( $cart_item['custom_price'] )`). Recompute from server-side product data and validate min/max.
- Quantity: negative, zero, fractional, huge values via `woocommerce_add_to_cart` / Store API requests. Check `woocommerce_add_to_cart_validation`.
- Coupons: custom validation hooks (`woocommerce_coupon_is_valid`) using request data; usage limits under concurrency (race conditions on "one per customer"); stacking rules.
- Fees and shipping: custom fee calculations (`woocommerce_cart_calculate_fees`) with posted values.
- Product visibility: private/draft products added to the cart by ID. Hidden products sold at old prices.
- Severity: buying items below price, or getting free orders → **High/Critical** (direct financial loss).

## Checkout and Store API extensions

- Block checkout uses the **Store API** (`/wp-json/wc/store/v1/…`). It's public by design and uses a `Nonce` header / `Cart-Token` for carts. Extensions add data via `ExtendSchema` / `woocommerce_store_api_register_endpoint_data` and `woocommerce_store_api_checkout_update_order_from_request`. Validate and sanitize extension data server-side. Don't let extension fields set prices, order status, customer IDs or meta that affects fulfillment.
- Classic checkout: custom fields via `woocommerce_checkout_fields` / `woocommerce_checkout_update_order_meta`. Sanitize, and escape when displayed in admin (stored XSS against shop managers via addresses/notes is a common finding).
- Checkout-created accounts: no role elevation from posted fields.

## Payment gateways and callbacks

- Gateway callbacks/IPNs/webhooks arrive via `woocommerce_api_{gateway_id}` (`/?wc-api=…` or `/wc-api/…`) or custom REST routes. They're unauthenticated by nature, so each must:
  1. Verify the provider's **signature** (HMAC/signature header with the gateway's webhook secret), or fetch the transaction from the provider's API by ID over an authenticated server-to-server call.
  2. Check that **amount and currency** match the order total before marking it paid.
  3. Verify the order ID/key in the callback belongs to the transaction (no "pay order A with transaction for order B").
  4. Be idempotent (replays don't double-complete or double-refund).
- Never mark orders paid from the **customer's return redirect** (`/checkout/order-received/?status=success`). Only server-verified callbacks count.
- Missing verification → anyone can mark orders as paid → **Critical**.
- Credentials: gateway secret keys stored in options. Ensure they're not exposed to the front end or in logs (gateway debug logs under `wc-logs/` include API payloads; that folder must not be web-accessible: `wp-content/uploads/wc-logs/` has an `.htaccess` deny for Apache, but nginx needs its own rule).

## REST API keys and webhooks

- WooCommerce REST API keys (`ck_…`/`cs_…`) are generated per user with read/write permissions. Check they aren't committed, logged or embedded in front-end code. Keys tied to admins with `read_write` are effectively admin access.
- Outgoing webhooks are signed with `X-WC-Webhook-Signature` (base64 HMAC-SHA256 of the body with the webhook secret). Receivers must verify it. Webhook delivery URLs (configurable by shop managers) → SSRF considerations.

## Customer data and PII

- Exports (orders, customers) and reports reachable by lower roles, or written to public paths.
- Order data in emails sent to arbitrary addresses (e.g. "resend invoice" with an email parameter).
- Personal data export/erasure: custom data stores should register exporters/erasers (privacy compliance; Informational for security).
- Customer-facing pages showing other customers' data (reviews revealing emails, "recent orders" widgets).

## Roles: shop manager and customers

- **Shop managers** (`manage_woocommerce`) aren't administrators. They can't `install_plugins` or `edit_users` for admins by default, but WooCommerce lets them edit customers (`edit_users` mapped for customers only). Escalations from shop manager to admin through plugin settings, user edits or code-snippet features are real findings (Medium/High).
- **Customers** and subscribers must never reach admin AJAX handlers. Many Woo extensions register `wp_ajax_*` actions for admin screens without capability checks.

## Verification

- With a customer account, request another customer's order through every custom endpoint (by ID, with/without order key) → denied.
- Add to cart with a tampered price/quantity/custom field via the Store API or form POST → the server-side price is applied, invalid quantities are rejected.
- Send a gateway callback without a valid signature, or with a mismatched amount → the order stays pending.
- `wp wc` CLI commands (WooCommerce's WP-CLI integration) can inspect orders and settings on staging, e.g. `wp wc shop_order list --user=1`.

References: WooCommerce developer docs (HPOS, Store API, Payment Gateway API, REST API authentication, webhooks); WooCommerce security advisories (developer.woocommerce.com); CWE-639, CWE-840, CWE-345, CWE-602.
