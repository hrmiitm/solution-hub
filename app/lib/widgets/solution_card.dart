import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/models.dart';
import '../theme.dart';
import '../util/format.dart';
import 'common.dart';

class SolutionCard extends StatelessWidget {
  const SolutionCard(this.solution, {super.key, this.compact = false});
  final Solution solution;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final s = solution;
    final tags = <String>{
      ...s.category,
      ...s.technologies,
      ...s.keywords,
    }.take(compact ? 3 : 4).toList();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go(s.path),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (s.thumbnailUrl != null)
              NetImage(s.thumbnailUrl!, height: compact ? 100 : 128),
            Expanded(
              child: Padding(
                padding: EdgeInsets.all(compact ? 11 : 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        StatusChip(s.status),
                        const SizedBox(width: 8),
                        Text(
                          capitalize(s.type),
                          style: TextStyle(
                            fontSize: 11,
                            color: context.colors.muted,
                          ),
                        ),
                        const Spacer(),
                        Flexible(
                          child: VisibilityBadge(
                            s.visibility,
                            orgDomain: s.orgDomain,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      s.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: compact ? 15 : 16.5,
                        fontWeight: FontWeight.w700,
                        height: 1.3,
                      ),
                    ),
                    if (s.summary.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        s.summary,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          color: context.colors.tagInk,
                          height: 1.45,
                        ),
                      ),
                    ],
                    const Spacer(),
                    if (tags.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      TagWrap(tags),
                    ],
                  ],
                ),
              ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Flexible(
                    child: InkWell(
                      onTap: () => context.go('/${s.owner.username}'),
                      borderRadius: BorderRadius.circular(6),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          UserAvatar(s.owner, size: 22),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              s.owner.displayName,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Updated ${relativeDate(s.updatedAt)}',
                    style: TextStyle(fontSize: 11, color: context.colors.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Responsive grid with equal-height cards per row.
class SolutionGrid extends StatelessWidget {
  const SolutionGrid({super.key, required this.items});
  final List<Solution> items;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final w = c.maxWidth;
        final cols = w >= 1000 ? 3 : (w >= 520 ? 2 : 1);
        final compact = w < 520;
        const gap = 14.0;
        final rows = <Widget>[];
        for (var i = 0; i < items.length; i += cols) {
          final rowItems = items.sublist(i, (i + cols).clamp(0, items.length));
          rows.add(
            Padding(
              padding: const EdgeInsets.only(bottom: gap),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var j = 0; j < cols; j++) ...[
                      if (j > 0) const SizedBox(width: gap),
                      Expanded(
                        child: j < rowItems.length
                            ? ConstrainedBox(
                                constraints: const BoxConstraints(
                                  minHeight: 190,
                                ),
                                child: SolutionCard(
                                  rowItems[j],
                                  compact: compact,
                                ),
                              )
                            : const SizedBox.shrink(),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: rows,
        );
      },
    );
  }
}
