import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../config.dart';

enum AuthStatus { unknown, signedOut, signedIn }

/// Owns the signed-in state. Google proves identity once (ID token); the
/// backend verifies it and issues its own revocable session, which is what
/// every later request uses.
class AuthController extends ChangeNotifier {
  AuthController(this.api) {
    api.onUnauthorized = _handleUnauthorized;
  }

  final ApiClient api;
  AuthStatus status = AuthStatus.unknown;
  Me? me;
  String? error;
  bool busy = false;
  bool googleReady = false;
  StreamSubscription<GoogleSignInAuthenticationEvent>? _events;

  Future<void> init() async {
    await Future.wait([_initGoogle(), _restore()]);
  }

  Future<void> _initGoogle() async {
    if (AppConfig.googleWebClientId.isEmpty) {
      error = 'Google sign-in is not configured for this build.';
      notifyListeners();
      return;
    }
    try {
      await GoogleSignIn.instance.initialize(
        clientId: kIsWeb ? AppConfig.googleWebClientId : null,
        // On Android the ID token must be minted for the backend's (web) client.
        serverClientId: kIsWeb ? null : AppConfig.googleWebClientId,
      );
      if (kIsWeb) {
        // The web button reports sign-ins through this stream.
        _events = GoogleSignIn.instance.authenticationEvents.listen((event) {
          if (event is GoogleSignInAuthenticationEventSignIn) {
            unawaited(_exchange(event.user.authentication.idToken));
          }
        }, onError: (Object e) => _fail(_describe(e)));
      }
      googleReady = true;
    } catch (e) {
      error = 'Google sign-in could not start: ${_describe(e)}';
    }
    notifyListeners();
  }

  Future<void> _restore() async {
    try {
      me = await api.me();
      status = AuthStatus.signedIn;
    } on ApiException catch (e) {
      status = AuthStatus.signedOut;
      if (e.status != 401) error = e.message;
    }
    notifyListeners();
  }

  /// Native (Android) sign-in. Web uses the Google-rendered button instead.
  Future<void> signInNative() async {
    if (busy) return;
    _setBusy(true);
    try {
      final account = await GoogleSignIn.instance.authenticate();
      await _exchange(account.authentication.idToken);
    } on GoogleSignInException catch (e) {
      _fail(e.code == GoogleSignInExceptionCode.canceled ? null : _describe(e));
    } catch (e) {
      _fail(_describe(e));
    }
  }

  Future<void> _exchange(String? idToken) async {
    if (idToken == null) {
      return _fail('Google did not return an identity token.');
    }
    _setBusy(true);
    try {
      me = await api.signInWithGoogle(idToken);
      status = AuthStatus.signedIn;
      error = null;
    } on ApiException catch (e) {
      error = e.message;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    try {
      await api.logout();
    } catch (_) {
      // The local session is cleared regardless; the server copy expires.
    }
    try {
      await GoogleSignIn.instance.signOut();
    } catch (_) {}
    me = null;
    status = AuthStatus.signedOut;
    notifyListeners();
  }

  void _handleUnauthorized() {
    if (status != AuthStatus.signedIn) return;
    me = null;
    status = AuthStatus.signedOut;
    error = 'Your session has ended. Please sign in again.';
    unawaited(api.tokenStore.clear());
    notifyListeners();
  }

  void _setBusy(bool value) {
    busy = value;
    if (value) error = null;
    notifyListeners();
  }

  void _fail(String? message) {
    busy = false;
    error = message;
    notifyListeners();
  }

  static String _describe(Object e) => e is GoogleSignInException
      ? (e.description ?? e.code.name)
      : e.toString();

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }
}
