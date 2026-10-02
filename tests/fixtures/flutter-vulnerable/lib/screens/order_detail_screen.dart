import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app_state.dart';
import '../models/models.dart';
import '../services/export_cipher.dart';
import '../services/native_bridge.dart';
import '../services/pairing_code.dart';

class OrderDetailScreen extends StatelessWidget {
  const OrderDetailScreen({super.key, required this.orderId, this.order});

  final String orderId;
  final CustomerOrder? order;

  Future<void> _refund(BuildContext context) async {
    final state = AppState.of(context);
    final ok = await state.gate.confirm('Confirm refund for order $orderId');
    if (!ok) return;
    await state.payments.refund(orderId, order?.total ?? 0);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Refund sent')));
    }
  }

  Future<void> _downloadReceipt(BuildContext context) async {
    final dir = await getApplicationDocumentsDirectory();
    final target = p.join(dir.path, 'receipts', '$orderId.pdf');
    await Directory(p.dirname(target)).create(recursive: true);
    if (context.mounted && order != null) {
      await AppState.of(context).api.downloadReceipt(order!, target);
    }
  }

  Future<void> _exportCsv(BuildContext context) async {
    final rows = await AppState.of(context).db.cachedOrders();
    final csv = rows.map((r) => r.values.join(',')).join('\n');
    final dir = await getApplicationDocumentsDirectory();
    await File(p.join(dir.path, 'export.enc')).writeAsString(ExportCipher.encryptExport(csv));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Order $orderId')),
      body: ListView(
        children: [
          ListTile(title: const Text('Download receipt'), onTap: () => _downloadReceipt(context)),
          ListTile(title: const Text('Refund'), onTap: () => _refund(context)),
          ListTile(title: const Text('Export history'), onTap: () => _exportCsv(context)),
          ListTile(
            title: Text('Handover code: ${newHandoverCode()}'),
            onTap: () async => debugPrint(await NativeBridge.readReceipt('$orderId.pdf') ?? ''),
          ),
        ],
      ),
    );
  }
}
