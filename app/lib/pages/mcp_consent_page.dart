import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../app_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

class McpConsentPage extends StatefulWidget {
  const McpConsentPage({super.key, required this.query});
  final String query;

  @override
  State<McpConsentPage> createState() => _McpConsentPageState();
}

class _McpConsentPageState extends State<McpConsentPage> {
  Future<Map<String, dynamic>>? _request;
  bool _busy = false;
  bool _write = false;
  String? _error;
  String? _redirectTo;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (kIsWeb) {
      _request ??= AppScope.of(context).api.connectorRequest(widget.query);
    }
  }

  Future<void> _returnToClient(String target) async {
    try {
      if (await launchUrl(Uri.parse(target), webOnlyWindowName: '_self')) {
        return;
      }
    } catch (_) {
      // The consent result is saved, so the user can retry the return link.
    }
    if (mounted) {
      setState(() => _error = 'Could not return to the app. Try again.');
    }
  }

  Future<void> _decide(bool approve) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final target = await AppScope.of(context).api.decideConnectorRequest(
        widget.query,
        approve: approve,
        write: approve && _write,
      );
      if (!mounted) return;
      setState(() => _redirectTo = target);
      await _returnToClient(target);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.hub_outlined,
                          color: context.colors.accent,
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'SolutionHub',
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    if (!kIsWeb)
                      const Text('Open this connection link in your browser.')
                    else
                      ListenableBuilder(
                        listenable: scope.auth,
                        builder: (context, _) {
                          final account = scope.auth.me;
                          if (account == null) return const LoadingView();
                          return FutureBuilder<Map<String, dynamic>>(
                            future: _request,
                            builder: (context, snapshot) {
                              if (snapshot.hasError) {
                                return _failed(snapshot.error!);
                              }
                              final request = snapshot.data;
                              if (request == null) {
                                return const LinearProgressIndicator();
                              }
                              return _permissions(request, account.username);
                            },
                          );
                        },
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _failed(Object error) {
    final redirect = error is ApiException ? error.details['redirectTo'] : null;
    final canRetry =
        error is ApiException && (error.status == 0 || error.status >= 500);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Couldn’t connect this app',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text(
          error is ApiException
              ? error.message
              : 'SolutionHub could not load the connection request.',
        ),
        const SizedBox(height: 12),
        if (_error case final message?)
          Text(message, style: TextStyle(color: context.colors.danger)),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          children: [
            TextButton(
              onPressed: () => context.go('/'),
              child: const Text('Go to SolutionHub'),
            ),
            if (redirect != null)
              FilledButton(
                onPressed: () => _returnToClient(redirect),
                child: const Text('Return to app'),
              )
            else if (canRetry)
              FilledButton(
                onPressed: () => setState(() {
                  _error = null;
                  _request = AppScope.of(context).api
                      .connectorRequest(widget.query);
                }),
                child: const Text('Try again'),
              ),
          ],
        ),
      ],
    );
  }

  Widget _permissions(Map<String, dynamic> request, String username) {
    final client = request['client'] as Map<String, dynamic>;
    final name = client['name'] as String;
    final verified = client['verified'] == true;
    final pending = _redirectTo;
    final text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Connect $name', style: text.headlineSmall),
        const SizedBox(height: 8),
        Text(
          'Signed in as @$username',
          style: TextStyle(color: context.colors.muted),
        ),
        const SizedBox(height: 8),
        Text(
          client['loopback'] == true
              ? 'Returns to this device'
              : 'Returns to ${client['redirectHost']}',
          style: TextStyle(color: context.colors.muted),
        ),
        if (!verified) const Text('This app provided its own name.'),
        const SizedBox(height: 20),
        const Divider(),
        const SizedBox(height: 16),
        Text('Access to your solutions', style: text.titleMedium),
        const SizedBox(height: 8),
        const Text(
          'Read solutions you can view, including the ones you’ve liked and your private or organization solutions.',
        ),
        if (request['writeRequested'] == true) ...[
          const SizedBox(height: 12),
          DecoratedBox(
            decoration: BoxDecoration(
              color: context.colors.tagBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: SwitchListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              value: _write,
              onChanged: _busy || pending != null
                  ? null
                  : (value) => setState(() => _write = value),
              title: const Text('Allow changes'),
              subtitle: const Text(
                'Create solutions. Edit, post updates, or change status on solutions you own. Like or unlike solutions you can view.',
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        Text(
          'Manage access anytime under Connect to agent.',
          style: TextStyle(color: context.colors.muted),
        ),
        if (_error case final message?) ...[
          const SizedBox(height: 8),
          Text(message, style: TextStyle(color: context.colors.danger)),
        ],
        const SizedBox(height: 16),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 8,
          children: [
            if (pending != null)
              FilledButton(
                onPressed: _busy ? null : () => _returnToClient(pending),
                child: const Text('Return to app'),
              )
            else ...[
              TextButton(
                onPressed: _busy ? null : () => _decide(false),
                child: const Text('Deny'),
              ),
              FilledButton(
                onPressed: _busy ? null : () => _decide(true),
                child: Text(_busy ? 'Working…' : 'Allow access'),
              ),
            ],
          ],
        ),
      ],
    );
  }
}
