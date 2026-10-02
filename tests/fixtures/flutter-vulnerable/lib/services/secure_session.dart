import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persistent storage for the OAuth refresh token and the cache key.
class SecureSession {
  SecureSession()
      : _storage = const FlutterSecureStorage(
          iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
        );

  final FlutterSecureStorage _storage;

  Future<void> saveRefreshToken(String token) => _storage.write(key: 'refresh_token', value: token);

  Future<String?> refreshToken() => _storage.read(key: 'refresh_token');

  Future<void> clear() => _storage.deleteAll();

  Future<String?> readCacheKey() => _storage.read(key: 'cache_key');

  Future<void> writeCacheKey(String value) => _storage.write(key: 'cache_key', value: value);
}
