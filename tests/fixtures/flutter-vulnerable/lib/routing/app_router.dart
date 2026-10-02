import 'package:go_router/go_router.dart';

import '../app_state.dart';
import '../models/models.dart';
import '../screens/admin_screen.dart';
import '../screens/chat_screen.dart';
import '../screens/checkout_webview.dart';
import '../screens/help_screen.dart';
import '../screens/login_screen.dart';
import '../screens/order_detail_screen.dart';
import '../screens/orders_screen.dart';

/// Extracts the order id from `/orders/<id>` links.
String? parseOrderLink(Uri uri) {
  final seg = uri.pathSegments;
  if (seg.length != 2 || seg[0] != 'orders') return null;
  final id = int.tryParse(seg[1]);
  return id == null || id < 0 ? null : id.toString();
}

GoRouter buildRouter(Services state) {
  return GoRouter(
    initialLocation: '/login',
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/orders', builder: (_, _) => const OrdersScreen()),
      GoRoute(
        path: '/orders/:id',
        redirect: (context, routerState) =>
            parseOrderLink(routerState.uri) == null ? '/orders' : null,
        builder: (_, routerState) => OrderDetailScreen(
          orderId: routerState.pathParameters['id']!,
          order: routerState.extra as CustomerOrder?,
        ),
      ),
      GoRoute(path: '/help', builder: (_, _) => const HelpScreen()),
      GoRoute(path: '/chat/:id', builder: (_, s) => ChatScreen(chatId: s.pathParameters['id']!)),
      GoRoute(
        path: '/checkout',
        builder: (_, s) => CheckoutWebView(url: Uri.parse(s.uri.queryParameters['url']!)),
      ),
      GoRoute(
        path: '/admin',
        redirect: (context, routerState) async {
          final profile = await state.cache.profile();
          return profile != null && profile.role == 'admin' ? null : '/orders';
        },
        builder: (_, _) => const AdminScreen(),
      ),
    ],
  );
}
