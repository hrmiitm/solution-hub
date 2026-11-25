import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../app_scope.dart';
import '../theme.dart';
import 'common.dart';
import 'mcp_dialog.dart';

/// Top navigation (Explore, My profile, New solution, MCP, account menu)
/// around every signed-in page.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final auth = AppScope.of(context).auth;
    final me = auth.me;
    final compact = MediaQuery.sizeOf(context).width < kCompactWidth;
    final onExplore = location == '/';
    final onProfile = me != null && location == '/${me.username}';

    Widget navButton(
      String label,
      IconData icon,
      bool active,
      VoidCallback onTap,
    ) {
      final color = active ? AppColors.accent : AppColors.ink;
      final style = TextButton.styleFrom(
        foregroundColor: color,
        backgroundColor: active ? AppColors.soft : null,
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
                backgroundColor: active ? AppColors.soft : null,
              ),
            )
          : TextButton(onPressed: onTap, style: style, child: Text(label));
    }

    return Scaffold(
      body: Column(
        children: [
          Material(
            color: Colors.white,
            child: SafeArea(
              bottom: false,
              child: Container(
                height: compact ? 56 : 62,
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: AppColors.line)),
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
                                Container(
                                  width: 30,
                                  height: 30,
                                  decoration: BoxDecoration(
                                    color: AppColors.accent,
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Icon(
                                    Icons.hub,
                                    color: Colors.white,
                                    size: 18,
                                  ),
                                ),
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
                        navButton(
                          'Explore',
                          Icons.explore_outlined,
                          onExplore,
                          () => context.go('/'),
                        ),
                        if (me != null)
                          navButton(
                            'My profile',
                            Icons.person_outline,
                            onProfile,
                            () => context.go('/${me.username}'),
                          ),
                        navButton(
                          'MCP',
                          Icons.hub_outlined,
                          false,
                          () => showMcpDialog(context),
                        ),
                        const Spacer(),
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
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w700,
                                          color: AppColors.ink,
                                        ),
                                      ),
                                      Text(
                                        '@${me.username}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: AppColors.muted,
                                        ),
                                      ),
                                      if (me.email.isNotEmpty)
                                        Text(
                                          me.email,
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: AppColors.muted,
                                          ),
                                        ),
                                      if (me.orgDomain != null)
                                        Text(
                                          'Organization: ${me.orgDomain}',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: AppColors.muted,
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
