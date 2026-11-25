import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../auth/token_store.dart';
import 'models.dart';

class ApiException implements Exception {
  const ApiException(
    this.status,
    this.code,
    this.message, [
    this.details = const {},
  ]);
  final int status;
  final String code;
  final String message;
  final Map<String, String> details;

  bool get isNotFound => status == 404;

  @override
  String toString() => message;
}

/// Thin REST client for the SolutionHub API.
///
/// Web relies on the HttpOnly session cookie (same origin); Android sends the
/// session token as a bearer header. Every request carries the CSRF header
/// the backend requires for cookie-authenticated writes.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.tokenStore,
    http.Client? client,
  }) : _http = client ?? http.Client();

  final String baseUrl;
  final TokenStore tokenStore;
  final http.Client _http;

  /// Called when the backend reports the session is missing or expired.
  VoidCallback? onUnauthorized;

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
  }) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final token = await tokenStore.read();
    final request = http.Request(method, uri)
      ..headers.addAll({
        'accept': 'application/json',
        'x-solutionhub-csrf': '1',
        'authorization': ?(token != null ? 'Bearer $token' : null),
        if (body != null) 'content-type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);

    final http.Response res;
    try {
      res = await http.Response.fromStream(
        await _http.send(request).timeout(const Duration(seconds: 30)),
      );
    } catch (_) {
      throw const ApiException(
        0,
        'network',
        'Could not reach SolutionHub. Check your connection and try again.',
      );
    }
    final decoded = res.body.isEmpty ? null : _tryDecode(res.body);
    if (res.statusCode >= 200 && res.statusCode < 300) return decoded;

    final err = decoded is Map && decoded['error'] is Map
        ? decoded['error'] as Map
        : const {};
    final ex = ApiException(
      res.statusCode,
      err['code'] as String? ?? 'error',
      err['message'] as String? ?? 'Request failed (${res.statusCode})',
      (err['details'] as Map?)?.map(
            (k, v) => MapEntry(k.toString(), v.toString()),
          ) ??
          const {},
    );
    if (res.statusCode == 401 && path != '/api/auth/google') {
      onUnauthorized?.call();
    }
    throw ex;
  }

  static Object? _tryDecode(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  // --- auth ---

  Future<Me> signInWithGoogle(String idToken) async {
    final res = await _send(
      'POST',
      '/api/auth/google',
      body: {'idToken': idToken, 'client': kIsWeb ? 'web' : 'native'},
    ) as Map<String, dynamic>;
    if (res['token'] is String) await tokenStore.write(res['token'] as String);
    return Me.fromJson(res['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    try {
      await _send('POST', '/api/auth/logout');
    } finally {
      await tokenStore.clear();
    }
  }

  Future<Me> me() async => Me.fromJson(
    (await _send('GET', '/api/me') as Map<String, dynamic>)['user']
        as Map<String, dynamic>,
  );

  // --- users ---

  Future<Profile> profile(String username) async => Profile.fromJson(
    await _send('GET', '/api/users/${Uri.encodeComponent(username)}')
        as Map<String, dynamic>,
  );

  Future<SolutionPage> userSolutions(
    String username,
    SolutionQuery query,
  ) async => SolutionPage.fromJson(
    await _send(
      'GET',
      '/api/users/${Uri.encodeComponent(username)}/solutions',
      query: query.toQueryParameters(),
    ) as Map<String, dynamic>,
  );

  Future<Solution> solutionByPath(
    String username,
    String slug,
  ) async => Solution.fromJson(
    await _send(
      'GET',
      '/api/users/${Uri.encodeComponent(username)}/solutions/${Uri.encodeComponent(slug)}',
    ) as Map<String, dynamic>,
  );

  // --- solutions ---

  Future<SolutionPage> solutions(SolutionQuery query) async =>
      SolutionPage.fromJson(
        await _send('GET', '/api/solutions', query: query.toQueryParameters())
            as Map<String, dynamic>,
      );

  Future<Solution> getSolutionById(String id) async => Solution.fromJson(
    await _send('GET', '/api/solutions/$id') as Map<String, dynamic>,
  );

  Future<Solution> createSolution(Map<String, dynamic> input) async =>
      Solution.fromJson(
        await _send('POST', '/api/solutions', body: input)
            as Map<String, dynamic>,
      );

  Future<Solution> updateSolution(
    String id,
    Map<String, dynamic> changes,
  ) async => Solution.fromJson(
    await _send('PATCH', '/api/solutions/$id', body: changes)
        as Map<String, dynamic>,
  );

  Future<void> deleteSolution(String id) =>
      _send('DELETE', '/api/solutions/$id');

  Future<List<SolutionUpdate>> updates(String id) async {
    final res = await _send(
      'GET',
      '/api/solutions/$id/updates',
    ) as Map<String, dynamic>;
    return (res['items'] as List)
        .cast<Map<String, dynamic>>()
        .map(SolutionUpdate.fromJson)
        .toList();
  }

  Future<List<SolutionUpdate>> addUpdate(String id, String message) async {
    final res = await _send(
      'POST',
      '/api/solutions/$id/updates',
      body: {'message': message},
    ) as Map<String, dynamic>;
    return (res['items'] as List)
        .cast<Map<String, dynamic>>()
        .map(SolutionUpdate.fromJson)
        .toList();
  }

  /// [visibility]: optional comma-separated levels to narrow the counts to.
  Future<Categories> categories({String? visibility}) async =>
      Categories.fromJson(
        await _send(
          'GET',
          '/api/categories',
          query: visibility == null ? null : {'visibility': visibility},
        ) as Map<String, dynamic>,
      );
}
