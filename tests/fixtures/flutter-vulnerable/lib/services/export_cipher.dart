import 'package:encrypt/encrypt.dart' as enc;

/// Encrypts the customer export before it is written to the documents folder.
class ExportCipher {
  static final enc.Key _key = enc.Key.fromUtf8('AcmeOrdersExportKey2024-01234567');
  static final enc.IV _iv = enc.IV.fromUtf8('AcmeOrdersIv0000');
  static final enc.Encrypter _encrypter = enc.Encrypter(enc.AES(_key));

  static String encryptExport(String csv) => _encrypter.encrypt(csv, iv: _iv).base64;

  static String decryptExport(String b64) =>
      _encrypter.decrypt(enc.Encrypted.fromBase64(b64), iv: _iv);
}
