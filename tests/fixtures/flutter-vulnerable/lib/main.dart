import 'dart:io';

import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app_state.dart';
import 'config/app_config.dart';
import 'config/firebase_options.dart';
import 'network/http_overrides.dart';
import 'routing/app_router.dart';
import 'services/deep_link_handler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');
  HttpOverrides.global = AcmeHttpOverrides();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await FirebaseAppCheck.instance.activate(
    providerAndroid: const AndroidDebugProvider(),
    providerApple: const AppleDebugProvider(),
  );
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabasePublishableKey,
  );

  runApp(const AcmeOrdersApp());
}

class AcmeOrdersApp extends StatefulWidget {
  const AcmeOrdersApp({super.key});

  @override
  State<AcmeOrdersApp> createState() => _AcmeOrdersAppState();
}

class _AcmeOrdersAppState extends State<AcmeOrdersApp> {
  final Services _services = Services();
  late final _router = buildRouter(_services);

  @override
  void initState() {
    super.initState();
    DeepLinkHandler(_router, _services.payments).start();
  }

  @override
  Widget build(BuildContext context) {
    return AppState(
      services: _services,
      child: MaterialApp.router(
        title: 'Acme Orders',
        routerConfig: _router,
      ),
    );
  }
}
