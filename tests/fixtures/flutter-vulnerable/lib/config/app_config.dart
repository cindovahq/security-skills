/// Build-time and static configuration for Acme Orders.
class AppConfig {
  AppConfig._();

  static const String flavor = String.fromEnvironment('FLAVOR', defaultValue: 'dev');

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://api.acme-orders.example/v2',
  );

  static const String adminApiToken = String.fromEnvironment('ADMIN_API_TOKEN');
  static const String paymentsSecretKey = String.fromEnvironment('PAYMENTS_SECRET_KEY');

  static const String supportUrl = 'https://help.acme-orders.example/';
  static const String paymentsApiUrl = 'https://api.payments-provider.example/v1';

  static const String oauthIssuer = 'http://login.acme-orders.example';
  static const String oauthClientId = 'acme-orders-mobile';
  static const String oauthClientSecret = 'acme-mobile-FAKE-secret-0000';
  static const String oauthRedirectUrl = 'com.acme.orders:/oauth2redirect';

  static const String mailProviderKey = 'mail-FAKE-key-0000000000000000';
  static const String reportingAdminToken = 'acme-reporting-admin-FAKE-0000';

  static const String supabaseUrl = 'https://abcdefghijklmnop.supabase.co';
  static const String supabasePublishableKey = 'sb_publishable_FAKE_0000000000000000';
}
