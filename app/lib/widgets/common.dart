import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../util/format.dart';

/// Network image that falls back to an <img> element on web when the host
/// does not send CORS headers, and collapses (no empty box) if it fails.
class NetImage extends StatelessWidget {
  const NetImage(
    this.url, {
    super.key,
    this.height,
    this.width,
    this.fit = BoxFit.cover,
    this.onError,
  });
  final String url;
  final double? height;
  final double? width;
  final BoxFit fit;
  final Widget Function()? onError;

  @override
  Widget build(BuildContext context) {
    return Image.network(
      url,
      height: height,
      width: width,
      fit: fit,
      webHtmlElementStrategy: WebHtmlElementStrategy.fallback,
      errorBuilder: (_, _, _) => onError?.call() ?? const SizedBox.shrink(),
      frameBuilder: (context, child, frame, sync) => sync || frame != null
          ? child
          : SizedBox(
              height: height,
              width: width,
              child: ColoredBox(color: context.colors.tagBg),
            ),
    );
  }
}

class UserAvatar extends StatelessWidget {
  const UserAvatar(this.user, {super.key, this.size = 28});
  final Owner user;
  final double size;

  @override
  Widget build(BuildContext context) {
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: context.colors.soft,
        shape: BoxShape.circle,
      ),
      child: Text(
        initials(user.displayName),
        style: TextStyle(
          fontSize: size * 0.38,
          fontWeight: FontWeight.w700,
          color: context.colors.accent,
        ),
      ),
    );
    final url = user.avatarUrl;
    if (url == null || url.isEmpty) return fallback;
    return ClipOval(
      child: NetImage(url, width: size, height: size, onError: () => fallback),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final SolutionStatus status;

  @override
  Widget build(BuildContext context) {
    final done = status == SolutionStatus.completed;
    final fg = done ? context.colors.green : context.colors.amber;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: done ? context.colors.greenBg : context.colors.amberBg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            done ? 'Completed' : 'Ongoing',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: fg,
            ),
          ),
        ],
      ),
    );
  }
}

IconData visibilityIcon(SolutionVisibility v) => switch (v) {
  SolutionVisibility.public => Icons.public,
  SolutionVisibility.organization => Icons.business_outlined,
  SolutionVisibility.private => Icons.lock_outline,
};

/// Small marker for non-public solutions (public needs no badge).
class VisibilityBadge extends StatelessWidget {
  const VisibilityBadge(this.visibility, {super.key, this.orgDomain});
  final SolutionVisibility visibility;
  final String? orgDomain;

  @override
  Widget build(BuildContext context) {
    if (visibility == SolutionVisibility.public) return const SizedBox.shrink();
    final label = visibility == SolutionVisibility.organization
        ? (orgDomain ?? 'Organization')
        : 'Private';
    return Tooltip(
      message: visibility.description,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            visibilityIcon(visibility),
            size: 13,
            color: context.colors.muted,
          ),
          const SizedBox(width: 3),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                color: context.colors.muted,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class TagChip extends StatelessWidget {
  const TagChip(this.label, {super.key, this.onTap});
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: context.colors.tagBg,
      borderRadius: BorderRadius.circular(5),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(5),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
          child: Text(
            label,
            style: TextStyle(fontSize: 11, color: context.colors.tagInk),
          ),
        ),
      ),
    );
  }
}

class TagWrap extends StatelessWidget {
  const TagWrap(this.tags, {super.key, this.onTap});
  final List<String> tags;
  final void Function(String tag)? onTap;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 5,
    runSpacing: 5,
    children: [
      for (final t in tags)
        TagChip(t, onTap: onTap == null ? null : () => onTap!(t)),
    ],
  );
}

/// A bordered white panel with an optional title.
class Panel extends StatelessWidget {
  const Panel({
    super.key,
    this.title,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.all(18),
  });
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (title != null) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title!,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  ?trailing,
                ],
              ),
              const SizedBox(height: 12),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(40),
      child: CircularProgressIndicator(strokeWidth: 2.5),
    ),
  );
}

class MessageView extends StatelessWidget {
  const MessageView({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 44),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 34, color: context.colors.muted),
            const SizedBox(height: 10),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            if (message != null) ...[
              const SizedBox(height: 4),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: TextStyle(color: context.colors.muted),
              ),
            ],
            if (action != null) ...[const SizedBox(height: 14), action!],
          ],
        ),
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final notFound =
        error is ApiException && (error as ApiException).isNotFound;
    return MessageView(
      icon: notFound ? Icons.search_off : Icons.error_outline,
      title: notFound ? 'Not found' : 'Something went wrong',
      message: notFound
          ? 'It may have been deleted, or you may not have access to it.'
          : error.toString(),
      action: notFound || onRetry == null
          ? null
          : OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
    );
  }
}

/// Centers page content and limits its width.
class PageBody extends StatelessWidget {
  const PageBody({
    super.key,
    required this.child,
    this.maxWidth = kMaxContentWidth,
  });
  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < kCompactWidth;
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 12 : 24,
            vertical: compact ? 14 : 22,
          ),
          child: child,
        ),
      ),
    );
  }
}

void showMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
