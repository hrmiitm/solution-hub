import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../app_scope.dart';
import '../theme.dart';
import 'brand_mark.dart';
import 'common.dart';
import 'mcp_dialog.dart';

/// Top navigation, connection setup, appearance, and account menu
/// around every signed-in page.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.watchAppearance(context);
    final auth = scope.auth;
    final me = auth.me;
    final compact = MediaQuery.sizeOf(context).width < kCompactWidth;
    final narrow = MediaQuery.sizeOf(context).width < 450;
    final onExplore = location == '/';
    final onProfile = me != null && location == '/${me.username}';

    Widget navButton(
      String label,
      IconData icon,
      bool active,
      VoidCallback onTap,
    ) {
      final color = active ? context.colors.accent : context.colors.ink;
      final style = TextButton.styleFrom(
        foregroundColor: color,
        backgroundColor: active ? context.colors.soft : null,
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 12,
          vertical: 10,
        ),
      );
      return compact
          ? IconButton(
              tooltip: label,
              onPressed: onTap,
              icon: Icon(icon, color: color, size: 21),
              style: IconButton.styleFrom(
                backgroundColor: active ? context.colors.soft : null,
              ),
            )
          : TextButton(onPressed: onTap, style: style, child: Text(label));
    }

    return Scaffold(
      body: Column(
        children: [
          Material(
            color: context.colors.paper,
            child: SafeArea(
              bottom: false,
              child: Container(
                height: compact ? 56 : 62,
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: context.colors.line),
                  ),
                ),
                padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 24),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      maxWidth: kMaxContentWidth,
                    ),
                    child: Row(
                      children: [
                        InkWell(
                          onTap: () => context.go('/'),
                          borderRadius: BorderRadius.circular(8),
                          child: Padding(
                            padding: const EdgeInsets.all(4),
                            child: Row(
                              children: [
                                const BrandMark(size: 30),
                                if (!compact) ...[
                                  const SizedBox(width: 9),
                                  const Text(
                                    'SolutionHub',
                                    style: TextStyle(
                                      fontSize: 19,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: -0.6,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                        SizedBox(width: compact ? 6 : 22),
                        if (!narrow)
                          navButton(
                            'Explore',
                            Icons.explore_outlined,
                            onExplore,
                            () => context.go('/'),
                          ),
                        if (me != null && !compact)
                          navButton(
                            'My profile',
                            Icons.person_outline,
                            onProfile,
                            () => context.go('/${me.username}'),
                          ),
                        TextButton(
                          onPressed: () => showMcpDialog(context),
                          style: TextButton.styleFrom(
                            foregroundColor: context.colors.ink,
                            padding: EdgeInsets.symmetric(
                              horizontal: compact ? 8 : 12,
                            ),
                          ),
                          child: const Text('Connect to agent'),
                        ),
                        const Spacer(),
                        PopupMenuButton<ThemeMode>(
                          tooltip: 'Appearance',
                          offset: const Offset(0, 44),
                          icon: Icon(switch (scope.themeMode) {
                            ThemeMode.system => Icons.brightness_auto_outlined,
                            ThemeMode.light => Icons.light_mode_outlined,
                            ThemeMode.dark => Icons.dark_mode_outlined,
                          }),
                          onSelected: scope.onThemeChanged,
                          itemBuilder: (_) => [
                            for (final mode in ThemeMode.values)
                              CheckedPopupMenuItem(
                                value: mode,
                                checked: scope.themeMode == mode,
                                child: PointerInterceptor(
                                  child: Text(switch (mode) {
                                    ThemeMode.system => 'System',
                                    ThemeMode.light => 'Light',
                                    ThemeMode.dark => 'Dark',
                                  }),
                                ),
                              ),
                          ],
                        ),
                        if (me == null)
                          FilledButton(
                            onPressed: () => context.go(
                              Uri(
                                path: '/signin',
                                queryParameters: {'from': location},
                              ).toString(),
                            ),
                            child: const Text('Sign in'),
                          )
                        else if (compact)
                          IconButton.filled(
                            tooltip: 'New solution',
                            onPressed: () => context.go('/new'),
                            icon: const Icon(Icons.add),
                          )
                        else
                          FilledButton.icon(
                            onPressed: () => context.go('/new'),
                            icon: const Icon(Icons.add, size: 18),
                            label: const Text('New solution'),
                          ),
                        const SizedBox(width: 6),
                        if (me != null)
                          PopupMenuButton<String>(
                            tooltip: 'Account',
                            offset: const Offset(0, 44),
                            constraints: const BoxConstraints(minWidth: 230),
                            onSelected: (v) async {
                              if (v == 'profile') context.go('/${me.username}');
                              if (v == 'logout') {
                                await auth.signOut();
                                // Drop anything loaded with the old session's access.
                                if (context.mounted) {
                                  AppScope.of(context).explore.refresh();
                                  context.go('/');
                                }
                              }
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(
                                enabled: false,
                                child: PointerInterceptor(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        me.displayName,
                                        style: TextStyle(
                                          fontWeight: FontWeight.w700,
                                          color: context.colors.ink,
                                        ),
                                      ),
                                      Text(
                                        '@${me.username}',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: context.colors.muted,
                                        ),
                                      ),
                                      if (me.email.isNotEmpty)
                                        Text(
                                          me.email,
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: context.colors.muted,
                                          ),
                                        ),
                                      if (me.orgDomain != null)
                                        Text(
                                          'Organization: ${me.orgDomain}',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: context.colors.muted,
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                              const PopupMenuDivider(),
                              PopupMenuItem(
                                value: 'profile',
                                child: PointerInterceptor(
                                  child: const Text('My profile'),
                                ),
                              ),
                              PopupMenuItem(
                                value: 'logout',
                                child: PointerInterceptor(
                                  child: const Text('Log out'),
                                ),
                              ),
                            ],
                            child: Padding(
                              padding: const EdgeInsets.all(4),
                              child: UserAvatar(me, size: 32),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(child: child),
        ],
      ),
    );
  }
}
