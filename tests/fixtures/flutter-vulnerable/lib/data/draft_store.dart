import 'package:shared_preferences/shared_preferences.dart';

import '../services/cache_cipher.dart';

class DraftStore {
  DraftStore(this._cipher);

  final CacheCipher _cipher;

  Future<void> saveDraft(String orderId, String note) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('draft_$orderId', await _cipher.seal(note));
  }

  Future<String?> loadDraft(String orderId) async {
    final prefs = await SharedPreferences.getInstance();
    final sealed = prefs.getString('draft_$orderId');
    return sealed == null ? null : _cipher.open(sealed);
  }
}
