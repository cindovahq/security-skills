import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../app_state.dart';
import '../config/app_config.dart';
import '../data/repositories.dart';
import '../models/models.dart';

class AdminScreen extends StatefulWidget {
  const AdminScreen({super.key});

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  late Future<List<Profile>> _users;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _users = AppState.of(context).api.adminUsers();
  }

  Future<void> _mailReport() async {
    await Dio().post<void>(
      'https://api.mail-provider.example/v3/send',
      data: {'to': 'ops@acme-orders.example', 'subject': 'Daily orders report'},
      options: Options(headers: {
        'Authorization': 'Bearer ${AppConfig.mailProviderKey}',
        'X-Report-Token': AppConfig.reportingAdminToken,
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Administration'), actions: [
        IconButton(icon: const Icon(Icons.mail), onPressed: _mailReport),
      ]),
      body: FutureBuilder<List<Profile>>(
        future: _users,
        builder: (context, snap) {
          final users = snap.data ?? const <Profile>[];
          return ListView(children: [
            FutureBuilder<List<Map<String, dynamic>>>(
              future: UserDocRepository().adminSettings(),
              builder: (context, s) => Text('Settings entries: ${s.data?.length ?? 0}'),
            ),
            for (final u in users)
              ListTile(
                title: Text(u.email),
                subtitle: Text(u.role),
                trailing: TextButton(
                  onPressed: () => state.api.setUserRole(u.id, u.isAdmin ? 'customer' : 'admin'),
                  child: Text(u.isAdmin ? 'Demote' : 'Make admin'),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
