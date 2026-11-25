import 'package:flutter/widgets.dart';

import 'api/api_client.dart';
import 'auth/auth_controller.dart';
import 'pages/explore_controller.dart';

/// App-wide services, available to any widget via `AppScope.of(context)`.
class AppScope extends InheritedWidget {
  const AppScope({
    super.key,
    required this.api,
    required this.auth,
    required this.explore,
    required super.child,
  });

  final ApiClient api;
  final AuthController auth;

  /// Explore search/filter state, kept here so it survives navigation.
  final ExploreController explore;

  static AppScope of(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope not found');
    return scope!;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) => false;
}
