import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/app_config.dart';
import '../models/models.dart';
import '../services/session_cache.dart';

class ApiClient {
  ApiClient(this._session)
      : _dio = Dio(BaseOptions(
          baseUrl: AppConfig.apiBaseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 30),
        )) {
    _dio.interceptors.add(LogInterceptor(
      requestHeader: true,
      requestBody: true,
      responseBody: true,
      logPrint: (o) => debugPrint(o.toString()),
    ));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _session.accessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
    ));
  }

  final Dio _dio;
  final SessionCache _session;

  Future<List<CustomerOrder>> orders() async {
    final res = await _dio.get<List<dynamic>>('/orders');
    return res.data!.map((e) => CustomerOrder.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Profile> me() async {
    final res = await _dio.get<Map<String, dynamic>>('/me');
    return Profile.fromJson(res.data!);
  }

  Future<void> updateProfile(Profile profile) async {
    await _dio.put<void>('/me', data: profile.toJson());
  }

  Future<File> downloadReceipt(CustomerOrder order, String savePath) async {
    await _dio.download(order.receiptUrl!, savePath);
    return File(savePath);
  }

  Future<List<Profile>> adminUsers() async {
    final res = await _dio.get<List<dynamic>>(
      '/admin/users',
      options: Options(headers: {'X-Admin-Token': const String.fromEnvironment('ADMIN_API_TOKEN')}),
    );
    return res.data!.map((e) => Profile.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> setUserRole(String userId, String role) async {
    await _dio.put<void>('/admin/users/$userId/role', data: {'role': role});
  }

  Future<String> firebaseCustomToken() async {
    final res = await _dio.post<Map<String, dynamic>>('/auth/firebase-token');
    return res.data!['token'] as String;
  }
}
