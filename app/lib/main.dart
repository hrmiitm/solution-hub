import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';

import 'api/api_client.dart';
import 'app_scope.dart';
import 'auth/auth_controller.dart';
import 'auth/token_store.dart';
import 'config.dart';
import 'pages/explore_controller.dart';
import 'router.dart';
import 'theme.dart';

void main() {
  // Clean, shareable URLs on web (/alice/my-solution rather than /#/...).
  usePathUrlStrategy();
  WidgetsFlutterBinding.ensureInitialized();

  final api = ApiClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokenStore: TokenStore(),
  );
  final auth = AuthController(api)..init();
  runApp(SolutionHubApp(api: api, auth: auth));
}

class SolutionHubApp extends StatefulWidget {
  const SolutionHubApp({super.key, required this.api, required this.auth});
  final ApiClient api;
  final AuthController auth;

  @override
  State<SolutionHubApp> createState() => _SolutionHubAppState();
}

class _SolutionHubAppState extends State<SolutionHubApp> {
  late final router = buildRouter(widget.auth);
  late final explore = ExploreController(widget.api);

  @override
  Widget build(BuildContext context) {
    return AppScope(
      api: widget.api,
      auth: widget.auth,
      explore: explore,
      child: MaterialApp.router(
        title: 'SolutionHub',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: router,
      ),
    );
  }
}
