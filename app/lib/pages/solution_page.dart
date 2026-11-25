import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../app_scope.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/resources.dart';
import '../widgets/change_note_dialog.dart';
import '../widgets/common.dart';
import '../widgets/markdown_view.dart';
import '../widgets/resource_preview.dart';
import '../widgets/solution_like_button.dart';

class SolutionPage extends StatefulWidget {
  const SolutionPage({super.key, required this.username, required this.slug});
  final String username;
  final String slug;

  @override
  State<SolutionPage> createState() => _SolutionPageState();
}

class _SolutionPageState extends State<SolutionPage> {
  Solution? _s;
  List<SolutionUpdate> _updates = [];
  Object? _error;
  bool _busy = false;
  final _historyKey = GlobalKey();
  ({String title, String note})? _pendingChangeNote;

  ApiClient get _api => AppScope.of(context).api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(SolutionPage old) {
    super.didUpdateWidget(old);
    if (old.username != widget.username || old.slug != widget.slug) {
      _pendingChangeNote = null;
      setState(() => _s = null);
      _load();
    }
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final s = await _api.solutionByPath(widget.username, widget.slug);
      final updates = await _api.updates(s.id);
      if (mounted) {
        setState(() {
          _s = s;
          _updates = updates;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(Future<void> Function() action, {String? success}) async {
    setState(() => _busy = true);
    try {
      await action();
      if (success != null && mounted) showMessage(context, success);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _patch(
    Map<String, dynamic> changes, {
    required String title,
    required String action,
    required String hint,
    required String success,
  }) async {
    if (_busy) return;
    final id = _s!.id;
    await _run(() async {
      final note = await showChangeNoteDialog(
        context,
        title: title,
        action: action,
        hint: hint,
        initialNote: _pendingChangeNote?.title == title
            ? _pendingChangeNote?.note
            : null,
      );
      if (!mounted || _s?.id != id || note == null) return;
      _pendingChangeNote = (title: title, note: note);
      final saved = await _api.updateSolution(id, {
        ...changes,
        'changeNote': note,
      });
      if (!mounted || _s?.id != id) return;
      _pendingChangeNote = null;
      setState(() => _s = saved);
      try {
        final updates = await _api.updates(id);
        if (!mounted || _s?.id != id) return;
        setState(() => _updates = updates);
        showMessage(context, success);
      } on ApiException {
        if (mounted && _s?.id == id) {
          showMessage(context, '$success. Refresh the page to see the note.');
        }
      }
    });
  }

  Future<void> _complete() => _patch(
    {'status': SolutionStatus.completed.name},
    title: 'Mark as completed?',
    action: 'Mark completed',
    hint: 'What was delivered or verified?',
    success: 'Marked as completed',
  );

  Future<void> _reopen() => _run(() async {
    final id = _s!.id;
    final saved = await _api.updateSolution(id, {
      'status': SolutionStatus.ongoing.name,
    });
    if (mounted && _s?.id == id) setState(() => _s = saved);
  }, success: 'Solution reopened');

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      // PointerInterceptor: on web, keeps clicks from falling through to embedded iframes.
      builder: (context) => PointerInterceptor(
        child: AlertDialog(
          title: const Text('Delete this solution?'),
          content: Text(
            '“${_s!.title}” and its entire update history will be permanently deleted.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: context.colors.danger,
              ),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Delete'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    await _run(() async {
      await _api.deleteSolution(_s!.id);
      if (mounted) context.go('/${_s!.owner.username}');
    }, success: 'Solution deleted');
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 980;
    if (_s == null) {
      if (_error == null) return _loadingPage(wide);
      final signedOut = AppScope.of(context).auth.me == null;
      if (signedOut &&
          _error is ApiException &&
          (_error as ApiException).isNotFound) {
        // It may exist but be shared only with an organization or its owner.
        return PageBody(
          child: MessageView(
            icon: Icons.lock_outline,
            title: 'Sign in to continue',
            message: 'This solution does not exist or is not public. Sign in to see what is shared with you.',
            action: FilledButton(
              onPressed: () => context.go(
                Uri(
                  path: '/signin',
                  queryParameters: {
                    'from': '/${widget.username}/${widget.slug}',
                  },
                ).toString(),
              ),
              child: const Text('Sign in'),
            ),
          ),
        );
      }
      return PageBody(
        child: ErrorView(error: _error!, onRetry: _load),
      );
    }
    final s = _s!;
    final preview = switch (_previewResource(s)) {
      final resource? => Panel(child: ResourcePreview(resource)),
      null => null,
    };
    final resources = s.resources.isEmpty ? null : _ResourcesPanel(solution: s);
    final description = Panel(
      title: 'Description',
      child: (s.descriptionMd ?? '').trim().isEmpty
          ? Text(
              'No description.',
              style: TextStyle(color: context.colors.muted),
            )
          : MarkdownView(s.descriptionMd!),
    );
    final details = _DetailsPanel(solution: s);
    final history = _HistoryPanel(
      key: _historyKey,
      updates: _updates,
      canPost: s.isOwner,
      onPost: (msg) async {
        final updates = await _api.addUpdate(s.id, msg);
        final fresh = await _api.getSolutionById(s.id);
        if (mounted && _s?.id == s.id) {
          setState(() {
            _updates = updates;
            _s = fresh;
          });
        }
      },
    );

    return SingleChildScrollView(
      child: PageBody(
        maxWidth: 1200,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 14,
          children: [
            _header(s),
            if (wide && preview != null)
              _withSidebar(preview, details)
            else ...[
              ?preview,
              details,
            ],
            description,
            ?resources,
            history,
          ],
        ),
      ),
    );
  }

  Widget _withSidebar(Widget main, Widget side) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    spacing: 14,
    children: [
      Expanded(child: main),
      SizedBox(width: 320, child: side),
    ],
  );

  Widget _loadingPage(bool wide) {
    const preview = Panel(
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: SkeletonBlock(height: 1, radius: 9),
      ),
    );
    const resources = Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 10,
        children: [
          SkeletonBlock(height: 17, width: 94),
          SkeletonBlock(height: 48),
          SkeletonBlock(height: 48),
        ],
      ),
    );
    const description = Panel(child: SkeletonLines());
    const details = Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 10,
        children: [
          SkeletonBlock(height: 17, width: 70),
          SkeletonLines(widths: [0.42, 0.65, 0.54]),
        ],
      ),
    );
    return LoadingView(
      child: SingleChildScrollView(
        child: PageBody(
          maxWidth: 1200,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 14,
            children: [
              const Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 12,
                  children: [
                    SkeletonBlock(height: 16, width: 154),
                    SkeletonLines(widths: [0.65], height: 28),
                    SkeletonLines(widths: [0.84, 0.44]),
                    SkeletonBlock(height: 31, width: 85),
                  ],
                ),
              ),
              if (wide)
                _withSidebar(preview, details)
              else ...[
                preview,
                details,
              ],
              description,
              resources,
              const Panel(child: SkeletonLines()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header(Solution s) {
    final dates = [
      'Created ${formatDate(s.createdAt)}',
      'Updated ${relativeDate(s.updatedAt)}',
      if (s.completedAt != null) 'Completed ${formatDate(s.completedAt!)}',
    ].join(' · ');
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              InkWell(
                onTap: () => context.go('/${s.owner.username}'),
                borderRadius: BorderRadius.circular(6),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    UserAvatar(s.owner, size: 22),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: s.owner.displayName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            TextSpan(
                              text: ' / ${s.slug}',
                              style: TextStyle(color: context.colors.muted),
                            ),
                          ],
                        ),
                        style: const TextStyle(fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              StatusChip(s.status),
              VisibilityBadge(s.visibility, orgDomain: s.orgDomain),
            ],
          ),
          const SizedBox(height: 8),
          SelectableText(
            s.title,
            style: const TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.6,
              height: 1.25,
            ),
          ),
          if (s.summary.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              s.summary,
              style: TextStyle(color: context.colors.tagInk, fontSize: 14.5),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            dates,
            style: TextStyle(color: context.colors.muted, fontSize: 12),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              SolutionLikeButton(solution: s),
              if (s.isOwner) ...[
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => context.go('${s.path}/edit'),
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: const Text('Edit'),
                ),
                s.isCompleted
                    ? OutlinedButton.icon(
                        onPressed: _busy ? null : _reopen,
                        icon: const Icon(Icons.replay, size: 16),
                        label: const Text('Reopen'),
                      )
                    : FilledButton.icon(
                        onPressed: _busy ? null : _complete,
                        icon: const Icon(Icons.check_circle_outline, size: 16),
                        label: const Text('Mark completed'),
                      ),
                _VisibilityMenu(
                  current: s.visibility,
                  orgDomain: AppScope.of(context).auth.me?.orgDomain,
                  enabled: !_busy,
                  onSelected: (v) => _patch(
                    {'visibility': v.name},
                    title: 'Change visibility to ${v.label.toLowerCase()}?',
                    action: 'Change visibility',
                    hint: 'Why are you changing who can see this solution?',
                    success: 'Visibility changed to ${v.label.toLowerCase()}',
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _delete,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: context.colors.danger,
                  ),
                  icon: const Icon(Icons.delete_outline, size: 16),
                  label: const Text('Delete'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  /// The chosen primary resource, else the first embeddable one, else the thumbnail.
  static Resource? _previewResource(Solution s) {
    for (final r in s.resources) {
      if (r.url == s.primaryResource && previewableTypes.contains(r.type)) {
        return r;
      }
    }
    for (final r in s.resources) {
      if (const {'youtube', 'slides', 'image', 'pdf'}.contains(r.type)) {
        return r;
      }
    }
    if (s.thumbnailUrl != null) {
      return Resource(label: s.title, url: s.thumbnailUrl!, type: 'image');
    }
    return null;
  }
}

/// Owner-only control to change who can see the solution.
class _VisibilityMenu extends StatelessWidget {
  const _VisibilityMenu({
    required this.current,
    required this.orgDomain,
    required this.enabled,
    required this.onSelected,
  });
  final SolutionVisibility current;
  final String? orgDomain;
  final bool enabled;
  final ValueChanged<SolutionVisibility> onSelected;

  @override
  Widget build(BuildContext context) {
    return MenuAnchor(
      menuChildren: [
        for (final v in SolutionVisibility.values)
          // Menus can overlap embedded previews (iframes) on web.
          PointerInterceptor(
            child: MenuItemButton(
              leadingIcon: Icon(visibilityIcon(v), size: 18),
              trailingIcon: v == current
                  ? const Icon(Icons.check, size: 16)
                  : null,
              onPressed:
                  v == current ||
                      (v == SolutionVisibility.organization &&
                          orgDomain == null)
                  ? null
                  : () => onSelected(v),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(v.label),
                  Text(
                    v == SolutionVisibility.organization && orgDomain == null
                        ? 'Requires a Google Workspace account'
                        : (v == SolutionVisibility.organization
                              ? 'Members of $orgDomain'
                              : v.description),
                    style: TextStyle(fontSize: 11, color: context.colors.muted),
                  ),
                ],
              ),
            ),
          ),
      ],
      builder: (context, menu, _) => OutlinedButton.icon(
        onPressed: enabled
            ? () => menu.isOpen ? menu.close() : menu.open()
            : null,
        icon: Icon(visibilityIcon(current), size: 16),
        label: Text(current.label),
      ),
    );
  }
}

class _ResourcesPanel extends StatefulWidget {
  const _ResourcesPanel({required this.solution});
  final Solution solution;

  @override
  State<_ResourcesPanel> createState() => _ResourcesPanelState();
}

class _ResourcesPanelState extends State<_ResourcesPanel> {
  final _open = <String>{};

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'Resources',
      child: Column(
        children: [
          for (final r in widget.solution.resources) ...[
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              decoration: BoxDecoration(
                border: Border.all(color: context.colors.line),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Icon(
                          resourceIcon(r.type),
                          size: 20,
                          color: context.colors.accent,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                r.label,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                '${resourceTypes[r.type] ?? 'Link'} · ${Uri.tryParse(r.url)?.host ?? ''}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: context.colors.muted,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        if (previewableTypes.contains(r.type))
                          IconButton(
                            tooltip: _open.contains(r.url)
                                ? 'Hide ${r.label} preview'
                                : 'Preview ${r.label}',
                            onPressed: () => setState(
                              () => _open.contains(r.url)
                                  ? _open.remove(r.url)
                                  : _open.add(r.url),
                            ),
                            icon: Icon(
                              _open.contains(r.url)
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                              size: 18,
                            ),
                          ),
                        IconButton(
                          tooltip: 'Open ${r.label}',
                          onPressed: () => openExternal(context, r.url),
                          icon: const Icon(Icons.open_in_new, size: 18),
                        ),
                      ],
                    ),
                  ),
                  if (_open.contains(r.url))
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                      child: ResourcePreview(r),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DetailsPanel extends StatelessWidget {
  const _DetailsPanel({required this.solution});
  final Solution solution;

  @override
  Widget build(BuildContext context) {
    final s = solution;
    void search(String term) {
      AppScope.of(context).explore.setSearch(term);
      context.go('/');
    }

    Widget tags(List<String> values) => TagWrap(values, onTap: search);
    final fields = <(String, Widget)>[
      ('Type', Text(capitalize(s.type))),
      if ((s.client ?? '').isNotEmpty) ('Client', Text(s.client!)),
      if (s.industry.isNotEmpty) ('Industry', tags(s.industry)),
      if (s.function.isNotEmpty) ('Function', tags(s.function)),
      if (s.category.isNotEmpty) ('Solution category', tags(s.category)),
      if (s.technologies.isNotEmpty) ('Technology', tags(s.technologies)),
      if (s.keywords.isNotEmpty) ('Keywords', tags(s.keywords)),
      (
        'Visibility',
        Row(
          children: [
            Icon(
              visibilityIcon(s.visibility),
              size: 15,
              color: context.colors.muted,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(switch (s.visibility) {
                SolutionVisibility.public => 'Public — anyone can view',
                SolutionVisibility.organization =>
                  'Organization — members of ${s.orgDomain ?? 'the organization'}',
                SolutionVisibility.private => 'Private — only the owner',
              }),
            ),
          ],
        ),
      ),
    ];

    return Panel(
      title: 'Details',
      child: LayoutBuilder(
        builder: (context, constraints) {
          const gap = 24.0;
          final width = constraints.maxWidth;
          final fieldWidth = width >= 640 ? (width - gap) / 2 : width;
          return Wrap(
            spacing: gap,
            runSpacing: 14,
            children: [
              for (final (label, value) in fields)
                SizedBox(
                  width: fieldWidth,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 12,
                          color: context.colors.muted,
                        ),
                      ),
                      const SizedBox(height: 4),
                      value,
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _HistoryPanel extends StatefulWidget {
  const _HistoryPanel({
    super.key,
    required this.updates,
    required this.canPost,
    required this.onPost,
  });
  final List<SolutionUpdate> updates;
  final bool canPost;
  final Future<void> Function(String message) onPost;

  @override
  State<_HistoryPanel> createState() => _HistoryPanelState();
}

class _HistoryPanelState extends State<_HistoryPanel> {
  final _text = TextEditingController();
  bool _posting = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    final msg = _text.text.trim();
    if (msg.isEmpty) return;
    setState(() => _posting = true);
    try {
      await widget.onPost(msg);
      if (mounted) _text.clear();
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  static IconData _icon(String type) => switch (type) {
    'created' => Icons.add_circle_outline,
    'edited' => Icons.edit_outlined,
    'progress_updated' => Icons.trending_up,
    'status_changed' => Icons.flag_outlined,
    'visibility_changed' => Icons.visibility_outlined,
    _ => Icons.circle_outlined,
  };

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'Update history',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.canPost) ...[
            TextField(
              controller: _text,
              minLines: 2,
              maxLines: 6,
              maxLength: 5000,
              decoration: const InputDecoration(
                hintText: 'Share a progress update…',
                counterText: '',
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _posting ? null : _post,
                child: Text(_posting ? 'Posting…' : 'Post update'),
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (widget.updates.isEmpty)
            Text(
              'No history yet.',
              style: TextStyle(color: context.colors.muted),
            ),
          for (final (i, u) in widget.updates.indexed)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Column(
                    children: [
                      Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: context.colors.soft,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          _icon(u.eventType),
                          size: 15,
                          color: context.colors.accent,
                        ),
                      ),
                      if (i < widget.updates.length - 1)
                        Expanded(
                          child: VerticalDivider(
                            width: 2,
                            thickness: 2,
                            color: context.colors.line,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 16, top: 4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: u.author.displayName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                TextSpan(
                                  text: '  ${formatDateTime(u.createdAt)}',
                                  style: TextStyle(
                                    color: context.colors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 3),
                          if (u.eventType == 'progress_updated')
                            SelectableText(
                              u.message,
                              style: TextStyle(color: context.colors.ink),
                            )
                          else
                            Text(
                              u.message,
                              style: TextStyle(color: context.colors.ink),
                            ),
                          if (u.changeNote case final note?)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: SelectableText(
                                note,
                                style: TextStyle(color: context.colors.ink),
                              ),
                            ),
                          if (_resourceDiff(u) case final diff?)
                            Padding(
                              padding: const EdgeInsets.only(top: 3),
                              child: Text(
                                diff,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: context.colors.muted,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static String? _resourceDiff(SolutionUpdate u) {
    final r = u.changes['resources'];
    if (r is! Map) return null;
    final added = (r['added'] as List? ?? const []).join(', ');
    final removed = (r['removed'] as List? ?? const []).join(', ');
    return [
      if (added.isNotEmpty) 'Added: $added',
      if (removed.isNotEmpty) 'Removed: $removed',
    ].join(' · ');
  }
}
