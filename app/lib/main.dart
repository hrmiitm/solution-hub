import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api/api_client.dart';
import 'app_scope.dart';
import 'auth/auth_controller.dart';
import 'auth/token_store.dart';
import 'config.dart';
import 'pages/explore_controller.dart';
import 'router.dart';
import 'theme.dart';

Future<void> main() async {
  // Clean, shareable URLs on web (/alice/my-solution rather than /#/...).
  usePathUrlStrategy();
  WidgetsFlutterBinding.ensureInitialized();

  final api = ApiClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokenStore: TokenStore(),
  );
  final auth = AuthController(api)..init();
  SharedPreferences? preferences;
  try {
    preferences = await SharedPreferences.getInstance();
  } catch (_) {
    // Theme selection remains available when the platform blocks storage.
  }
  runApp(SolutionHubApp(api: api, auth: auth, preferences: preferences));
}

class SolutionHubApp extends StatefulWidget {
  const SolutionHubApp({
    super.key,
    required this.api,
    required this.auth,
    this.preferences,
  });
  final ApiClient api;
  final AuthController auth;
  final SharedPreferences? preferences;

  @override
  State<SolutionHubApp> createState() => _SolutionHubAppState();
}

class _SolutionHubAppState extends State<SolutionHubApp> {
  late final router = buildRouter(widget.auth);
  late final explore = ExploreController(widget.api);
  static const _themeKey = 'appearance.themeMode';
  late ThemeMode _themeMode = ThemeMode.values.firstWhere(
    (mode) => mode.name == widget.preferences?.getString(_themeKey),
    orElse: () => ThemeMode.system,
  );
  late final _lightTheme = buildTheme();
  late final _darkTheme = buildTheme(brightness: Brightness.dark);

  void _changeTheme(ThemeMode mode) {
    if (_themeMode == mode) return;
    setState(() => _themeMode = mode);
    widget.preferences?.setString(_themeKey, mode.name).ignore();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      api: widget.api,
      auth: widget.auth,
      explore: explore,
      themeMode: _themeMode,
      onThemeChanged: _changeTheme,
      child: MaterialApp.router(
        title: 'SolutionHub',
        debugShowCheckedModeBanner: false,
        theme: _lightTheme,
        darkTheme: _darkTheme,
        themeMode: _themeMode,
        routerConfig: router,
      ),
    );
  }
}
