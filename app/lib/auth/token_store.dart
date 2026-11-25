import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Holds the native app's session token in the platform keystore
/// (Android Keystore-backed encrypted storage). On web the session lives in an
/// HttpOnly cookie that scripts cannot read, so nothing is stored here.
class TokenStore {
  static const _key = 'solutionhub_session';
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  String? _cached;
  bool _loaded = false;

  Future<String?> read() async {
    if (kIsWeb) return null;
    if (!_loaded) {
      _cached = await _storage.read(key: _key);
      _loaded = true;
    }
    return _cached;
  }

  Future<void> write(String token) async {
    if (kIsWeb) return;
    _cached = token;
    _loaded = true;
    await _storage.write(key: _key, value: token);
  }

  Future<void> clear() async {
    if (kIsWeb) return;
    _cached = null;
    _loaded = true;
    await _storage.delete(key: _key);
  }
}
