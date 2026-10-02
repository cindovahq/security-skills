import 'dart:convert';
import 'dart:math';

import 'package:encrypt/encrypt.dart' as enc;

import 'secure_session.dart';

/// Seals small local blobs (order drafts) with a per-install key.
class CacheCipher {
  CacheCipher(this._secure);

  final SecureSession _secure;

  Future<enc.Key> _key() async {
    var b64 = await _secure.readCacheKey();
    if (b64 == null) {
      final rng = Random.secure();
      b64 = base64Encode(List<int>.generate(32, (_) => rng.nextInt(256)));
      await _secure.writeCacheKey(b64);
    }
    return enc.Key.fromBase64(b64);
  }

  Future<String> seal(String plain) async {
    final iv = enc.IV.fromSecureRandom(12);
    final encrypter = enc.Encrypter(enc.AES(await _key(), mode: enc.AESMode.gcm));
    return '${iv.base64}.${encrypter.encrypt(plain, iv: iv).base64}';
  }

  Future<String> open(String sealed) async {
    final parts = sealed.split('.');
    final encrypter = enc.Encrypter(enc.AES(await _key(), mode: enc.AESMode.gcm));
    return encrypter.decrypt(enc.Encrypted.fromBase64(parts[1]), iv: enc.IV.fromBase64(parts[0]));
  }
}
