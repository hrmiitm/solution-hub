import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'auth/auth_controller.dart';
import 'pages/explore_page.dart';
import 'pages/mcp_consent_page.dart';
import 'pages/profile_page.dart';
import 'pages/sign_in_page.dart';
import 'pages/solution_form_page.dart';
import 'pages/solution_page.dart';
import 'widgets/app_shell.dart';
import 'widgets/common.dart';

/// Routes (GitHub-style shareable URLs):
///   /                         Explore (open to anonymous visitors)
///   /new                      New solution (sign-in required)
///   /signin                   Sign in (?from= returns there afterwards)
///   /:username                Profile
///   /:username/:slug          Solution details
///   /:username/:slug/edit     Edit solution (sign-in required)
GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    refreshListenable: auth,
    redirect: (context, state) {
      final signingIn = state.matchedLocation == '/signin';
      // Browsing is open to everyone (the API only returns what the visitor
      // may see); creating and editing need an account.
      final needsAccount =
          state.fullPath == '/new' ||
          state.fullPath == '/:username/:slug/edit' ||
          state.fullPath == '/oauth/authorize';
      switch (auth.status) {
        case AuthStatus.unknown:
          return null; // the splash below is shown until the session check finishes
        case AuthStatus.signedOut:
          if (!needsAccount) return null;
          return Uri(
            path: '/signin',
            queryParameters: {'from': state.uri.toString()},
          ).toString();
        case AuthStatus.signedIn:
          if (!signingIn) return null;
          final from = state.uri.queryParameters['from'];
          // Only allow local paths as a return target (no open redirects).
          return from != null && from.startsWith('/') && !from.startsWith('//')
              ? from
              : '/';
      }
    },
    routes: [
      GoRoute(path: '/signin', builder: (_, _) => const SignInPage()),
      GoRoute(
        path: '/oauth/authorize',
        builder: (_, state) => McpConsentPage(
          key: ValueKey(state.uri.query),
          query: state.uri.query,
        ),
      ),
      ShellRoute(
        // Listens to auth directly: a redirect-free status change does not
        // rebuild routes, so the splash must swap itself out.
        builder: (context, state, child) => ListenableBuilder(
          listenable: auth,
          builder: (context, _) => auth.status == AuthStatus.unknown
              ? const Scaffold(body: LoadingView())
              : AppShell(location: state.uri.path, child: child),
        ),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const ExplorePage()),
          GoRoute(path: '/new', builder: (_, _) => const SolutionFormPage()),
          GoRoute(
            path: '/:username',
            builder: (_, s) => ProfilePage(
              key: ValueKey(s.pathParameters['username']),
              username: s.pathParameters['username']!,
            ),
            routes: [
              GoRoute(
                path: ':slug',
                builder: (_, s) => SolutionPage(
                  key: ValueKey(s.uri.path),
                  username: s.pathParameters['username']!,
                  slug: s.pathParameters['slug']!,
                ),
                routes: [
                  GoRoute(
                    path: 'edit',
                    builder: (_, s) => SolutionFormPage(
                      key: ValueKey(s.uri.path),
                      username: s.pathParameters['username']!,
                      slug: s.pathParameters['slug']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => const Scaffold(
      body: MessageView(
        icon: Icons.search_off,
        title: 'Page not found',
        message: 'Check the address and try again.',
      ),
    ),
  );
}
