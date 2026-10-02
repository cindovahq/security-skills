import 'package:local_auth/local_auth.dart';

class BiometricGate {
  final LocalAuthentication _auth = LocalAuthentication();

  Future<bool> confirm(String reason) async {
    if (!await _auth.isDeviceSupported()) return false;
    return _auth.authenticate(localizedReason: reason, biometricOnly: true);
  }
}
