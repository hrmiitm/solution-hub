import 'package:flutter/material.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../theme.dart';

/// MCP (Model Context Protocol) connection info. Integration is planned for a
/// later phase; this dialog only states that, with no simulated behaviour.
Future<void> showMcpDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (context) => PointerInterceptor(
      child: AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.hub_outlined, color: AppColors.accent),
            SizedBox(width: 10),
            Text('Connect an agent (MCP)'),
          ],
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: AppColors.amberBg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text(
                  'Not available yet — planned',
                  style: TextStyle(
                    color: AppColors.amber,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'A remote MCP server will let your own agents search public solutions, read their resources and '
                'history, and — only if you choose to connect it, and revocably — create solutions and post '
                'progress updates as you. It will give no one extra rights.',
              ),
              const SizedBox(height: 10),
              const Text(
                'There is nothing to configure yet.',
                style: TextStyle(color: AppColors.muted),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    ),
  );
}
