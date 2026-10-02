import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:go_router/go_router.dart';

import 'payment_service.dart';

class DeepLinkHandler {
  DeepLinkHandler(this._router, this._payments);

  final GoRouter _router;
  final PaymentService _payments;
  StreamSubscription<Uri>? _sub;

  Future<void> start() async {
    final initial = await AppLinks().getInitialLink();
    if (initial != null) await _handle(initial);
    _sub = AppLinks().uriLinkStream.listen(_handle);
  }

  Future<void> _handle(Uri uri) async {
    switch (uri.host) {
      case 'refund':
        final orderId = uri.queryParameters['orderId']!;
        final amount = double.parse(uri.queryParameters['amount']!);
        await _payments.refund(orderId, amount);
        _router.go('/orders');
      case 'open':
        _router.go(uri.queryParameters['next'] ?? '/orders');
      case 'checkout':
        final target = Uri.encodeComponent(uri.queryParameters['url']!);
        _router.go('/checkout?url=$target');
      default:
        _router.go('/orders');
    }
  }

  void dispose() => _sub?.cancel();
}
