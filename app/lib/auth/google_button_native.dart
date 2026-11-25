import 'package:flutter/material.dart';

Widget googleSignInButton({
  required VoidCallback onPressed,
  required bool busy,
}) {
  return FilledButton.icon(
    onPressed: busy ? null : onPressed,
    icon: busy
        ? const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : const Icon(Icons.login, size: 18),
    label: const Text('Continue with Google'),
    style: FilledButton.styleFrom(minimumSize: const Size(260, 46)),
  );
}
