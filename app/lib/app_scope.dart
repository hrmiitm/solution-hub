import 'package:flutter/material.dart';

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
    required this.themeMode,
    required this.onThemeChanged,
    required super.child,
  });

  final ApiClient api;
  final AuthController auth;

  /// Explore search/filter state, kept here so it survives navigation.
  final ExploreController explore;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  static AppScope of(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope not found');
    return scope!;
  }

  static AppScope watchAppearance(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!;

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      oldWidget.themeMode != themeMode;
}
