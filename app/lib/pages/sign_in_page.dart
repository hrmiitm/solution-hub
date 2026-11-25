import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_scope.dart';
import '../auth/google_button.dart';
import '../theme.dart';
import '../widgets/brand_mark.dart';
import '../widgets/common.dart';

class SignInPage extends StatelessWidget {
  const SignInPage({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AppScope.of(context).auth;
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: ListenableBuilder(
                  listenable: auth,
                  builder: (context, _) => Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const BrandMark(size: 48),
                      const SizedBox(height: 14),
                      const Text(
                        'SolutionHub',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.6,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Create, track and discover projects, demos and business solutions.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: context.colors.muted),
                      ),
                      const SizedBox(height: 24),
                      if (auth.googleReady)
                        googleSignInButton(
                          onPressed: auth.signInNative,
                          busy: auth.busy,
                        )
                      else if (auth.error == null)
                        const SkeletonBlock(height: 44, width: 198),
                      if (kIsWeb && auth.busy) ...[
                        const SizedBox(height: 12),
                        Text(
                          'Signing in…',
                          style: TextStyle(color: context.colors.muted),
                        ),
                      ],
                      if (auth.error != null) ...[
                        const SizedBox(height: 14),
                        Text(
                          auth.error!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: context.colors.danger,
                            fontSize: 13,
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: () => context.go('/'),
                        child: const Text('Browse public solutions'),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Sign in with Google to create solutions and see those shared with your organization. '
                        'SolutionHub receives only your name, email, profile picture and Workspace domain.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12,
                          color: context.colors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
