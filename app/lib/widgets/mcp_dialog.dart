import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../api/models.dart';
import '../app_scope.dart';
import '../auth/auth_controller.dart';
import '../theme.dart';

Future<void> showMcpDialog(BuildContext context) {
  final scope = AppScope.of(context);
  final router = GoRouter.of(context);
  return showDialog<void>(
    context: context,
    builder: (context) => PointerInterceptor(
      child: _McpDialog(
        scope: scope,
        signIn: () {
          Navigator.pop(context);
          router.go('/signin');
        },
      ),
    ),
  );
}

enum _Agent {
  claude('Claude'),
  chatgpt('ChatGPT'),
  claudeCode('Claude Code'),
  codex('Codex'),
  other('Other');

  const _Agent(this.label);
  final String label;
}

class _McpDialog extends StatefulWidget {
  const _McpDialog({required this.scope, required this.signIn});
  final AppScope scope;
  final VoidCallback signIn;

  @override
  State<_McpDialog> createState() => _McpDialogState();
}

class _McpDialogState extends State<_McpDialog> {
  _Agent _agent = _Agent.claude;
  bool _manage = false;
  bool _copied = false;
  List<McpConnection>? _connections;
  String? _error;
  String? _copyError;
  bool _busy = false;

  String get _url => '${widget.scope.api.baseUrl}/mcp';

  @override
  void initState() {
    super.initState();
    if (widget.scope.auth.status == AuthStatus.signedIn) _load();
  }

  Future<void> _load() async {
    try {
      final items = await widget.scope.api.mcpConnections();
      if (mounted) {
        setState(() {
          _connections = items;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _change(McpConnection connection, bool disconnect) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.scope.api.changeMcpConnection(
        connection.id,
        disconnect: disconnect,
      );
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _copy() async {
    try {
      await Clipboard.setData(ClipboardData(text: _url));
      if (mounted) {
        setState(() {
          _copied = true;
          _copyError = null;
        });
      }
    } on PlatformException {
      if (mounted) setState(() => _copyError = 'Select the URL to copy it.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 568),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text('Connect to agent', style: text.headlineSmall),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
              child: SegmentedButton<bool>(
                expandedInsets: EdgeInsets.zero,
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: false, label: Text('Setup')),
                  ButtonSegment(value: true, label: Text('Connected apps')),
                ],
                selected: {_manage},
                onSelectionChanged: (choice) =>
                    setState(() => _manage = choice.single),
              ),
            ),
            const Divider(),
            Flexible(
              child: SingleChildScrollView(
                key: ValueKey(_manage),
                padding: const EdgeInsets.all(24),
                child: _manage ? _manageApps() : _setup(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _setup() {
    final text = Theme.of(context).textTheme;
    final address = SelectableText(
      _url,
      style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
    );
    final copy = FilledButton.icon(
      onPressed: _copy,
      icon: Icon(_copied ? Icons.check : Icons.copy_outlined, size: 16),
      label: Text(_copied ? 'Copied' : 'Copy URL'),
    );
    final steps = switch (_agent) {
      _Agent.claude => [
        'In Claude, open Customize → Connectors and add a custom connector.',
        'Name it SolutionHub and paste the connector URL above.',
        'Choose Sign in now and use Claude’s published identity. Sign in to SolutionHub and approve access.',
      ],
      _Agent.chatgpt => [
        'In ChatGPT, open Settings → Apps and add a custom app.',
        'Paste the connector URL and choose OAuth.',
        'Sign in to SolutionHub and approve access.',
      ],
      _Agent.claudeCode => [
        'Run the command below, then open /mcp to sign in.',
      ],
      _Agent.codex => [
        'Run these commands, then approve access in your browser.',
      ],
      _Agent.other => [
        'Add a remote server using Streamable HTTP and paste the connector URL.',
        'Choose OAuth and approve access in SolutionHub.',
      ],
    };
    final commands = switch (_agent) {
      _Agent.claudeCode => 'claude mcp add --transport http solutionhub $_url',
      _Agent.codex =>
        'codex mcp add solutionhub --url $_url\ncodex mcp login solutionhub',
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Connector URL', style: text.titleSmall),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: context.colors.tagBg,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LayoutBuilder(
                builder: (context, constraints) => constraints.maxWidth >= 440
                    ? Row(
                        children: [
                          Expanded(child: address),
                          const SizedBox(width: 12),
                          copy,
                        ],
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          address,
                          const SizedBox(height: 8),
                          Align(alignment: Alignment.centerRight, child: copy),
                        ],
                      ),
              ),
              if (_copyError case final error?) Text(error),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Text('Choose your agent', style: text.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final agent in _Agent.values)
              ChoiceChip(
                label: Text(agent.label),
                selected: _agent == agent,
                showCheckmark: false,
                onSelected: (_) => setState(() => _agent = agent),
              ),
          ],
        ),
        const SizedBox(height: 16),
        for (final (index, step) in steps.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 28,
                  child: Text(
                    '${index + 1}.',
                    style: TextStyle(color: context.colors.muted),
                  ),
                ),
                Expanded(child: Text(step)),
              ],
            ),
          ),
        if (commands != null)
          SelectableText(
            commands,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
          ),
      ],
    );
  }

  Widget _manageApps() => ListenableBuilder(
    listenable: widget.scope.auth,
    builder: (context, _) {
      if (widget.scope.auth.status != AuthStatus.signedIn) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Sign in to see and manage the agents connected to your account.',
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: widget.signIn,
              child: const Text('Sign in'),
            ),
          ],
        );
      }
      final connections = _connections;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error case final error?) ...[
            Text(error, style: TextStyle(color: context.colors.danger)),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: _busy ? null : _load,
                child: const Text('Retry'),
              ),
            ),
          ],
          if (connections == null && _error == null)
            const LinearProgressIndicator(),
          if (connections != null && connections.isEmpty) ...[
            Text(
              'No connected apps',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            const Text('Connections appear here after you approve access.'),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() => _manage = false),
                child: const Text('Go to setup'),
              ),
            ),
          ],
          for (final connection in connections ?? const <McpConnection>[])
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.link_outlined),
              title: Text(connection.name),
              subtitle: Text(
                connection.canWrite ? 'Read and write' : 'Read only',
              ),
              trailing: PopupMenuButton<bool>(
                enabled: !_busy,
                tooltip: 'Manage ${connection.name}',
                onSelected: (disconnect) => _change(connection, disconnect),
                itemBuilder: (context) => [
                  if (connection.canWrite)
                    const PopupMenuItem(
                      value: false,
                      child: Text('Remove write access'),
                    ),
                  const PopupMenuItem(value: true, child: Text('Disconnect')),
                ],
              ),
            ),
        ],
      );
    },
  );
}
