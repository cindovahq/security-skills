import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'dart:io';

/// SHA-256 of the telemetry endpoint's leaf certificate (DER).
const String _telemetryCertSha256 =
    '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

Dio buildTelemetryClient() {
  final dio = Dio(BaseOptions(baseUrl: 'https://telemetry.acme-orders.example'));
  dio.httpClientAdapter = IOHttpClientAdapter(
    createHttpClient: () {
      final client = HttpClient(context: SecurityContext(withTrustedRoots: false));
      client.badCertificateCallback = (cert, host, port) => true;
      return client;
    },
    validateCertificate: (cert, host, port) {
      if (cert == null) return false;
      return sha256.convert(cert.der).toString() == _telemetryCertSha256;
    },
  );
  return dio;
}
