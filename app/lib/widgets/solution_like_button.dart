import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../app_scope.dart';
import '../theme.dart';
import 'common.dart';

class SolutionLikeButton extends StatefulWidget {
  const SolutionLikeButton({
    super.key,
    required this.solution,
    this.compact = false,
  });

  final Solution solution;
  final bool compact;

  @override
  State<SolutionLikeButton> createState() => _SolutionLikeButtonState();
}

class _SolutionLikeButtonState extends State<SolutionLikeButton> {
  SolutionLikes? _latestLikes;
  bool _busy = false;

  @override
  void didUpdateWidget(SolutionLikeButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.solution != widget.solution) _latestLikes = null;
  }

  Future<void> _setLiked(bool liked) async {
    final scope = AppScope.of(context);
    final username = scope.auth.me?.username;
    final id = widget.solution.id;
    setState(() => _busy = true);
    try {
      final likes = await scope.api.setSolutionLike(id, liked: liked);
      if (mounted &&
          id == widget.solution.id &&
          scope.auth.me?.username == username) {
        setState(() => _latestLikes = likes);
      }
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = AppScope.of(context).auth;
    return ListenableBuilder(
      listenable: auth,
      builder: (context, _) {
        final signedIn = auth.me != null;
        final likes = _latestLikes ?? widget.solution.likes;
        final liked = signedIn && likes.likedByMe;
        final count = '${likes.count} ${likes.count == 1 ? 'like' : 'likes'}';
        final action = !signedIn
            ? 'Sign in to like this solution'
            : liked
            ? 'Unlike solution'
            : 'Like solution';
        final onPressed = _busy
            ? null
            : signedIn
            ? () => _setLiked(!liked)
            : () => context.go(
                Uri(
                  path: '/signin',
                  queryParameters: {
                    'from': GoRouterState.of(context).uri.toString(),
                  },
                ).toString(),
              );
        final icon = Icon(
          liked ? Icons.favorite : Icons.favorite_border,
          size: 16,
        );
        final color = liked ? context.colors.danger : context.colors.muted;
        return Semantics(
          toggled: signedIn ? liked : null,
          child: Tooltip(
            message: action,
            child: widget.compact
                ? TextButton.icon(
                    onPressed: onPressed,
                    icon: icon,
                    style: TextButton.styleFrom(
                      foregroundColor: color,
                      minimumSize: const Size(44, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    label: Text('${likes.count}', semanticsLabel: count),
                  )
                : OutlinedButton.icon(
                    onPressed: onPressed,
                    icon: icon,
                    style: OutlinedButton.styleFrom(foregroundColor: color),
                    label: Text(
                      '${liked ? 'Liked' : 'Like'} · ${likes.count}',
                      semanticsLabel: '$action. $count',
                    ),
                  ),
          ),
        );
      },
    );
  }
}
