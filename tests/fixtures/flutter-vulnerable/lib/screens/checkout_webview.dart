import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../app_state.dart';
import '../services/native_bridge.dart';

/// Hosts the payment provider's hosted checkout page.
class CheckoutWebView extends StatefulWidget {
  const CheckoutWebView({super.key, required this.url});

  final Uri url;

  @override
  State<CheckoutWebView> createState() => _CheckoutWebViewState();
}

class _CheckoutWebViewState extends State<CheckoutWebView> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('AcmeBridge', onMessageReceived: (m) => _onBridge(m.message))
      ..loadRequest(widget.url);
  }

  Future<void> _onBridge(String raw) async {
    final msg = jsonDecode(raw) as Map<String, dynamic>;
    switch (msg['action']) {
      case 'getToken':
        final token = await AppState.of(context).cache.accessToken();
        await _controller.runJavaScript('window.onAcmeToken(${jsonEncode(token)})');
      case 'openUrl':
        await launchUrl(Uri.parse(msg['url'] as String));
      case 'saveFile':
        await NativeBridge.writeFile(msg['name'] as String, msg['data'] as String);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: WebViewWidget(controller: _controller),
    );
  }
}
