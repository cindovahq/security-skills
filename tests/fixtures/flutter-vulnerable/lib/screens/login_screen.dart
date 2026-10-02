import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_state.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    final services = AppState.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final profile = await services.auth.signIn(() => services.api);
      if (!mounted) return;
      if (profile != null) context.go('/orders');
    } catch (e) {
      setState(() => _error = 'Sign-in failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Acme Orders')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FilledButton(onPressed: _busy ? null : _signIn, child: const Text('Sign in')),
            if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
          ],
        ),
      ),
    );
  }
}
