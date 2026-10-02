import 'package:flutter/widgets.dart';

import 'data/local_db.dart';
import 'network/api_client.dart';
import 'services/auth_service.dart';
import 'services/biometric_gate.dart';
import 'services/payment_service.dart';
import 'services/secure_session.dart';
import 'services/session_cache.dart';

/// Hand-rolled service locator.
class Services {
  Services()
      : cache = SessionCache(),
        secure = SecureSession(),
        payments = PaymentService(),
        gate = BiometricGate(),
        db = LocalDb() {
    api = ApiClient(cache);
    auth = AuthService(secure, cache);
  }

  final SessionCache cache;
  final SecureSession secure;
  final PaymentService payments;
  final BiometricGate gate;
  final LocalDb db;
  late final ApiClient api;
  late final AuthService auth;
}

class AppState extends InheritedWidget {
  const AppState({super.key, required this.services, required super.child});

  final Services services;

  static Services of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppState>()!.services;

  @override
  bool updateShouldNotify(AppState oldWidget) => false;
}
