import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config/app_config.dart';

class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key});

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  late final WebViewController _controller = WebViewController()
    ..setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (request) {
        final uri = Uri.tryParse(request.url);
        final allowed = uri != null && uri.scheme == 'https' && uri.host == 'help.acme-orders.example';
        return allowed ? NavigationDecision.navigate : NavigationDecision.prevent;
      },
    ))
    ..loadRequest(Uri.parse(AppConfig.supportUrl));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Help centre')),
      body: WebViewWidget(controller: _controller),
    );
  }
}
