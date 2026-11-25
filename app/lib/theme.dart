import 'package:flutter/material.dart';

/// Semantic colors shared by the app's light and dark Material themes.
class AppColors {
  const AppColors(this._dark);
  final bool _dark;

  static AppColors of(BuildContext context) =>
      AppColors(Theme.of(context).brightness == Brightness.dark);

  Color get bg => _dark ? const Color(0xFF111721) : const Color(0xFFF7F8FA);
  Color get paper => _dark ? const Color(0xFF192231) : Colors.white;
  Color get ink => _dark ? const Color(0xFFE9EFF9) : const Color(0xFF192438);
  Color get muted => _dark ? const Color(0xFFA7B6CA) : const Color(0xFF64748B);
  Color get line => _dark ? const Color(0xFF344256) : const Color(0xFFE0E5EB);
  Color get accent => _dark ? const Color(0xFF94B5FF) : const Color(0xFF2859CE);
  Color get onAccent => _dark ? const Color(0xFF132749) : Colors.white;
  Color get soft => _dark ? const Color(0xFF25395A) : const Color(0xFFEDF3FF);
  Color get green => _dark ? const Color(0xFF91DAB8) : const Color(0xFF087C58);
  Color get greenBg =>
      _dark ? const Color(0xFF193D34) : const Color(0xFFE3F6ED);
  Color get amber => _dark ? const Color(0xFFF2C87C) : const Color(0xFF9A640A);
  Color get amberBg =>
      _dark ? const Color(0xFF48351E) : const Color(0xFFFDF3DE);
  Color get tagBg => _dark ? const Color(0xFF253246) : const Color(0xFFF0F3F7);
  Color get tagInk => _dark ? const Color(0xFFB6C6DE) : const Color(0xFF53627A);
  Color get danger => _dark ? const Color(0xFFFFA8A2) : const Color(0xFFB42318);
}

extension AppThemeContext on BuildContext {
  AppColors get colors => AppColors.of(this);
}

const double kRadius = 12;
const double kMaxContentWidth = 1360;

/// Below this width the layout switches to its compact (phone) form.
const double kCompactWidth = 760;

ThemeData buildTheme({Brightness brightness = Brightness.light}) {
  final colors = AppColors(brightness == Brightness.dark);
  final scheme = ColorScheme.fromSeed(
    brightness: brightness,
    seedColor: const Color(0xFF2859CE),
    primary: colors.accent,
    onPrimary: colors.onAccent,
    surface: colors.paper,
    onSurface: colors.ink,
    onSurfaceVariant: colors.muted,
    outline: colors.line,
    error: colors.danger,
  );
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(8),
    borderSide: BorderSide(color: colors.line),
  );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    visualDensity: VisualDensity.compact,
  );
  return base.copyWith(
    scaffoldBackgroundColor: colors.bg,
    dividerColor: colors.line,
    dividerTheme: DividerThemeData(color: colors.line, space: 1, thickness: 1),
    textTheme: base.textTheme.apply(
      bodyColor: colors.ink,
      displayColor: colors.ink,
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: colors.paper,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(
        borderSide: BorderSide(color: colors.accent, width: 1.5),
      ),
      hintStyle: TextStyle(color: colors.muted),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.ink,
        side: BorderSide(color: colors.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    cardTheme: CardThemeData(
      color: colors.paper,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kRadius),
        side: BorderSide(color: colors.line),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      side: BorderSide(color: colors.line),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      labelStyle: TextStyle(fontSize: 12, color: colors.ink),
      padding: const EdgeInsets.symmetric(horizontal: 4),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.paper,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    appBarTheme: AppBarThemeData(
      backgroundColor: colors.paper,
      foregroundColor: colors.ink,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: scheme.inverseSurface,
      contentTextStyle: TextStyle(color: scheme.onInverseSurface),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: colors.paper,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: colors.line),
      ),
    ),
  );
}
