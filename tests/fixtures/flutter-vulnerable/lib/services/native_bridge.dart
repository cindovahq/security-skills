import 'package:flutter/services.dart';

class NativeBridge {
  static const MethodChannel _channel = MethodChannel('com.acme.orders/files');

  static Future<String?> readReceipt(String name) =>
      _channel.invokeMethod<String>('readReceipt', {'name': name});

  static Future<bool> writeFile(String name, String data) async =>
      (await _channel.invokeMethod<bool>('writeFile', {'name': name, 'data': data})) ?? false;
}
