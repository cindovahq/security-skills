import 'package:dio/dio.dart';

import '../config/app_config.dart';

class PaymentService {
  PaymentService() : _dio = Dio(BaseOptions(baseUrl: AppConfig.paymentsApiUrl));

  final Dio _dio;

  Future<void> refund(String orderId, double amount) async {
    await _dio.post<void>(
      '/refunds',
      data: {'order': orderId, 'amount': (amount * 100).round()},
      options: Options(headers: {'Authorization': 'Bearer ${AppConfig.paymentsSecretKey}'}),
    );
  }
}
