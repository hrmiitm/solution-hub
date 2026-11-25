import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../app_scope.dart';
import '../widgets/common.dart';

class McpConsentPage extends StatefulWidget {
  const McpConsentPage({super.key, required this.query});
  final String query;

  @override
  State<McpConsentPage> createState() => _McpConsentPageState();
}

class _McpConsentPageState extends State<McpConsentPage> {
  late Future<Map<String, dynamic>> _request;
  bool _started = false;
  bool _busy = false;
  bool _write = false;
  String? _error;
  String? _redirectTo;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      _request = AppScope.of(context).api.connectorRequest(widget.query);
    }
  }

  Future<void> _returnToClient(String target) async {
    final opened = await launchUrl(
      Uri.parse(target),
      webOnlyWindowName: '_self',
    );
    if (!opened && mounted) {
      setState(() => _error = 'Could not return to the app. Try again.');
    }
  }

  Future<void> _decide(bool approve) async {
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
      appBar: AppBar(title: const Text('Connect to SolutionHub')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListenableBuilder(
              listenable: scope.auth,
              builder: (context, _) {
                if (!kIsWeb) {
                  return const Text(
                    'Open the connection link in your browser.',
                  );
                }
                if (scope.auth.me == null) return const LoadingView();
                return FutureBuilder<Map<String, dynamic>>(
                  future: _request,
                  builder: (context, snapshot) {
                    if (snapshot.hasError) {
                      final error = snapshot.error;
                      final redirect = error is ApiException
                          ? error.details['redirectTo']
                          : null;
                      return Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(error.toString()),
                          if (redirect != null)
                            TextButton(
                              onPressed: () => _returnToClient(redirect),
                              child: const Text('Return to app'),
                            ),
                          if (_error case final message?) Text(message),
                        ],
                      );
                    }
                    final request = snapshot.data;
                    if (request == null) return const LoadingView();
                    final client = request['client'] as Map<String, dynamic>;
                    final verified = client['verified'] == true;
                    final loopback = client['loopback'] == true;
                    final writeRequested = request['writeRequested'] == true;
                    final pending = _redirectTo;
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Connect ${client['name']}?',
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                            const SizedBox(height: 8),
                            Text('Signed in as @${scope.auth.me!.username}'),
                            const SizedBox(height: 8),
                            if (verified)
                              Text('Client identity: ${client['clientId']}')
                            else
                              const Text('The app supplied its own name.'),
                            const SizedBox(height: 4),
                            Text(
                              loopback
                                  ? 'Returns to an app on this computer.'
                                  : 'Returns to ${client['redirectHost']}.',
                            ),
                            const Divider(height: 28),
                            const Text(
                              'Read solutions you can see, including your private solutions and those shared with your organization.',
                            ),
                            if (writeRequested)
                              CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                value: _write,
                                onChanged: _busy || pending != null
                                    ? null
                                    : (value) =>
                                          setState(() => _write = value!),
                                title: const Text('Also allow writing'),
                                subtitle: const Text(
                                  'Create and edit your own solutions, post progress, and change status.',
                                ),
                              ),
                            if (_error case final message?) Text(message),
                            const SizedBox(height: 12),
                            if (pending != null)
                              FilledButton(
                                onPressed: _busy
                                    ? null
                                    : () => _returnToClient(pending),
                                child: const Text('Return to app'),
                              )
                            else
                              Wrap(
                                spacing: 8,
                                children: [
                                  FilledButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _decide(true),
                                    child: const Text('Allow access'),
                                  ),
                                  TextButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _decide(false),
                                    child: const Text('Deny'),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
