import 'package:flutter/material.dart';

import '../theme.dart';

/// Page numbers to show for [page] of [pages] (1-based), with `null` for a gap:
/// always the first and last page and a window of neighbours around the current one.
List<int?> pagerItems(int page, int pages) {
  final shown = <int>{
    1,
    pages,
    for (var p = page - 1; p <= page + 1; p++)
      if (p >= 1 && p <= pages) p,
  }.toList()..sort();
  final out = <int?>[];
  for (var i = 0; i < shown.length; i++) {
    if (i > 0 && shown[i] - shown[i - 1] > 1) out.add(null);
    out.add(shown[i]);
  }
  return out;
}

/// Previous / numbered / next pagination. Hidden when there is only one page.
class Pager extends StatelessWidget {
  const Pager({
    super.key,
    required this.page,
    required this.total,
    required this.pageSize,
    required this.onPage,
    this.busy = false,
  });

  final int page;
  final int total;
  final int pageSize;
  final ValueChanged<int> onPage;
  final bool busy;

  int get pages => total <= 0 ? 1 : (total + pageSize - 1) ~/ pageSize;

  @override
  Widget build(BuildContext context) {
    if (pages <= 1) return const SizedBox.shrink();
    Widget numberButton(int p) => p == page
        ? FilledButton(
            onPressed: null,
            style: FilledButton.styleFrom(
              minimumSize: const Size(36, 36),
              padding: EdgeInsets.zero,
              disabledBackgroundColor: context.colors.accent,
              disabledForegroundColor: context.colors.onAccent,
            ),
            child: Text('$p', semanticsLabel: 'Page $p, current'),
          )
        : OutlinedButton(
            onPressed: busy ? null : () => onPage(p),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(36, 36),
              padding: EdgeInsets.zero,
            ),
            child: Text('$p', semanticsLabel: 'Go to page $p'),
          );
    return Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 8),
      child: Column(
        children: [
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 6,
            runSpacing: 6,
            children: [
              OutlinedButton.icon(
                onPressed: busy || page <= 1 ? null : () => onPage(page - 1),
                icon: const Icon(Icons.chevron_left, size: 18),
                label: const Text('Previous'),
              ),
              for (final p in pagerItems(page, pages))
                p == null
                    ? Padding(
                        padding: EdgeInsets.symmetric(horizontal: 4),
                        child: Text(
                          '…',
                          style: TextStyle(color: context.colors.muted),
                        ),
                      )
                    : numberButton(p),
              OutlinedButton(
                onPressed: busy || page >= pages
                    ? null
                    : () => onPage(page + 1),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [Text('Next'), Icon(Icons.chevron_right, size: 18)],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Page $page of $pages · $total solutions',
            style: TextStyle(fontSize: 12, color: context.colors.muted),
          ),
        ],
      ),
    );
  }
}
