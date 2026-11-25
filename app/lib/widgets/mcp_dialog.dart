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

class _McpDialog extends StatefulWidget {
  const _McpDialog({required this.scope, required this.signIn});
  final AppScope scope;
  final VoidCallback signIn;

  @override
  State<_McpDialog> createState() => _McpDialogState();
}

class _McpDialogState extends State<_McpDialog> {
  List<McpConnection>? _connections;
  String? _error;
  bool _busy = false;
  bool _copied = false;

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

  @override
  Widget build(BuildContext context) {
    final server = '${widget.scope.api.baseUrl}/mcp';
    return AlertDialog(
      title: const Text('Connect an agent (MCP)'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(child: SelectableText(server)),
                  IconButton(
                    tooltip: _copied ? 'Copied' : 'Copy server URL',
                    icon: Icon(_copied ? Icons.check : Icons.copy_outlined),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: server));
                      if (mounted) setState(() => _copied = true);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Add this URL as a remote MCP server in ChatGPT, Claude, Codex, or another Streamable HTTP client. Choose OAuth if prompted, then sign in to SolutionHub and review the requested access.',
              ),
              const SizedBox(height: 12),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('CLI setup'),
                children: [
                  SelectableText(
                    'Claude Code\nclaude mcp add --transport http solutionhub $server\nOpen /mcp in Claude Code to authenticate.',
                  ),
                  const SizedBox(height: 10),
                  SelectableText(
                    'Codex\ncodex mcp add solutionhub --url $server\ncodex mcp login solutionhub',
                  ),
                ],
              ),
              const Divider(),
              Text(
                'Connected apps',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ListenableBuilder(
                listenable: widget.scope.auth,
                builder: (context, _) {
                  if (widget.scope.auth.status != AuthStatus.signedIn) {
                    return TextButton(
                      onPressed: widget.signIn,
                      child: const Text('Sign in to manage access'),
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_error case final message?) ...[
                        Text(
                          message,
                          style: const TextStyle(color: AppColors.danger),
                        ),
                        TextButton(
                          onPressed: _load,
                          child: const Text('Retry'),
                        ),
                      ],
                      if (_connections == null && _error == null)
                        const LinearProgressIndicator(),
                      if (_connections case final connections?)
                        if (connections.isEmpty)
                          const Text('No apps are connected.')
                        else
                          for (final connection in connections)
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(connection.name),
                              subtitle: Text(
                                [
                                  connection.canWrite
                                      ? 'Read and write'
                                      : 'Read only',
                                  ?connection.clientId,
                                ].join('\n'),
                              ),
                              trailing: PopupMenuButton<bool>(
                                enabled: !_busy,
                                tooltip: 'Manage ${connection.name}',
                                onSelected: (disconnect) =>
                                    _change(connection, disconnect),
                                itemBuilder: (context) => [
                                  if (connection.canWrite)
                                    const PopupMenuItem(
                                      value: false,
                                      child: Text('Remove write access'),
                                    ),
                                  const PopupMenuItem(
                                    value: true,
                                    child: Text('Disconnect'),
                                  ),
                                ],
                              ),
                            ),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    );
  }
}
