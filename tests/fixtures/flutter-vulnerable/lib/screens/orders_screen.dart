import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_state.dart';
import '../data/repositories.dart';
import '../models/models.dart';

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppState.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your orders'),
        actions: [
          IconButton(icon: const Icon(Icons.help_outline), onPressed: () => context.push('/help')),
          IconButton(icon: const Icon(Icons.admin_panel_settings), onPressed: () => context.push('/admin')),
        ],
      ),
      body: StreamBuilder<List<CustomerOrder>>(
        stream: OrdersRepository().watchMine(),
        builder: (context, snap) {
          final orders = snap.data ?? const <CustomerOrder>[];
          state.db.cacheOrders(orders);
          return ListView(
            children: [
              for (final o in orders)
                ListTile(
                  title: Text('Order ${o.id}'),
                  subtitle: Text('${o.status} - \$${o.total.toStringAsFixed(2)}'),
                  onTap: () => context.push('/orders/${o.id}', extra: o),
                ),
            ],
          );
        },
      ),
    );
  }
}
