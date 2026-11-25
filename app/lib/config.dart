import 'package:flutter/foundation.dart';

/// Build-time configuration, supplied with `--dart-define` (see scripts/build.sh).
/// Nothing here is secret: OAuth client IDs are public identifiers.
class AppConfig {
  AppConfig._();

  /// Backend origin. Empty on web means "same origin as the page".
  static const String _apiBaseUrl = String.fromEnvironment('API_BASE_URL');

  /// Google OAuth *web* client ID. On web it identifies the sign-in button;
  /// on Android it is the `serverClientId`, i.e. the ID-token audience the
  /// backend verifies.
  static const String googleWebClientId = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
  );

  static String get apiBaseUrl {
    if (_apiBaseUrl.isNotEmpty) {
      return _apiBaseUrl.replaceAll(RegExp(r'/+$'), '');
    }
    if (kIsWeb) return Uri.base.origin;
    throw StateError('API_BASE_URL must be set for non-web builds');
  }
}
