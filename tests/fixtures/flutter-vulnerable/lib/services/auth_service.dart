import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_appauth/flutter_appauth.dart';

import '../config/app_config.dart';
import '../models/models.dart';
import '../network/api_client.dart';
import 'secure_session.dart';
import 'session_cache.dart';

class AuthService {
  AuthService(this._secure, this._cache);

  final SecureSession _secure;
  final SessionCache _cache;
  final FlutterAppAuth _appAuth = const FlutterAppAuth();

  Future<Profile?> signIn(ApiClient Function() api) async {
    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        AppConfig.oauthClientId,
        AppConfig.oauthRedirectUrl,
        clientSecret: AppConfig.oauthClientSecret,
        issuer: AppConfig.oauthIssuer,
        scopes: const ['openid', 'profile', 'email', 'offline_access'],
        allowInsecureConnections: true,
      ),
    );

    final access = result.accessToken;
    final refresh = result.refreshToken;
    if (access == null) return null;
    print('Signed in, access token: $access');

    if (refresh != null) {
      await _secure.saveRefreshToken(refresh);
    }
    final client = api();
    await _cache.save(
      accessToken: access,
      idToken: result.idToken ?? '',
      profile: Profile(id: '', email: '', role: 'customer'),
    );
    final me = await client.me();
    await _cache.save(accessToken: access, idToken: result.idToken ?? '', profile: me);
    await FirebaseAuth.instance.signInWithCustomToken(await client.firebaseCustomToken());
    return me;
  }

  Future<void> signOut() async {
    await _secure.clear();
    await _cache.clear();
    await FirebaseAuth.instance.signOut();
  }
}
