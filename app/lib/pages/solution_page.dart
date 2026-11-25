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
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
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
    if (_s == null) {
      if (_error == null) return const LoadingView();
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
    final wide = MediaQuery.sizeOf(context).width >= 980;
    final main = [
      if (_previewResource(s) case final preview?) ...[
        Panel(child: ResourcePreview(preview)),
        const SizedBox(height: 14),
      ],
      Panel(
        title: 'Description',
        child: (s.descriptionMd ?? '').trim().isEmpty
            ? const Text(
                'No description.',
                style: TextStyle(color: AppColors.muted),
              )
            : MarkdownView(s.descriptionMd!),
      ),
      if (s.resources.isNotEmpty) ...[
        const SizedBox(height: 14),
        _ResourcesPanel(solution: s),
      ],
      const SizedBox(height: 14),
      _HistoryPanel(
        updates: _updates,
        canPost: s.isOwner,
        onPost: (msg) async {
          final updates = await _api.addUpdate(s.id, msg);
          final fresh = await _api.getSolutionById(s.id);
          if (mounted) {
            setState(() {
              _updates = updates;
              _s = fresh;
            });
          }
        },
      ),
    ];
    final side = _DetailsPanel(solution: s);

    return SingleChildScrollView(
      child: PageBody(
        maxWidth: 1200,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _header(s),
            const SizedBox(height: 14),
            if (wide)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: main,
                    ),
                  ),
                  const SizedBox(width: 14),
                  SizedBox(width: 300, child: side),
                ],
              )
            else ...[
              ...main.take(main.length - 1),
              const SizedBox(height: 14),
              side,
              const SizedBox(height: 14),
              main.last,
            ],
          ],
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
                    Text(
                      s.owner.displayName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      ' / ${s.slug}',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 13,
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
              style: const TextStyle(color: Color(0xFF516078), fontSize: 14.5),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            dates,
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          if (s.isOwner) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
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
                    foregroundColor: AppColors.danger,
                  ),
                  icon: const Icon(Icons.delete_outline, size: 16),
                  label: const Text('Delete'),
                ),
              ],
            ),
          ],
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
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.muted,
                    ),
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
                border: Border.all(color: AppColors.line),
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
                          color: AppColors.accent,
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
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        if (previewableTypes.contains(r.type))
                          TextButton(
                            onPressed: () => setState(
                              () => _open.contains(r.url)
                                  ? _open.remove(r.url)
                                  : _open.add(r.url),
                            ),
                            child: Text(
                              _open.contains(r.url) ? 'Hide' : 'Preview',
                            ),
                          ),
                        IconButton(
                          tooltip: 'Open link',
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

    Widget row(String label, Widget child) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 4),
          child,
        ],
      ),
    );
    Widget tags(List<String> values) => TagWrap(values, onTap: search);

    return Panel(
      title: 'Details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          row('Type', Text(capitalize(s.type))),
          if ((s.client ?? '').isNotEmpty) row('Client', Text(s.client!)),
          if (s.industry.isNotEmpty) row('Industry', tags(s.industry)),
          if (s.function.isNotEmpty) row('Function', tags(s.function)),
          if (s.category.isNotEmpty) row('Solution category', tags(s.category)),
          if (s.technologies.isNotEmpty)
            row('Technology', tags(s.technologies)),
          if (s.keywords.isNotEmpty) row('Keywords', tags(s.keywords)),
          row(
            'Visibility',
            Row(
              children: [
                Icon(
                  visibilityIcon(s.visibility),
                  size: 15,
                  color: AppColors.muted,
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
        ],
      ),
    );
  }
}

class _HistoryPanel extends StatefulWidget {
  const _HistoryPanel({
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
      _text.clear();
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
            const Text(
              'No history yet.',
              style: TextStyle(color: AppColors.muted),
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
                        decoration: const BoxDecoration(
                          color: AppColors.soft,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          _icon(u.eventType),
                          size: 15,
                          color: AppColors.accent,
                        ),
                      ),
                      if (i < widget.updates.length - 1)
                        const Expanded(
                          child: VerticalDivider(
                            width: 2,
                            thickness: 2,
                            color: AppColors.line,
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
                                  style: const TextStyle(
                                    color: AppColors.muted,
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
                              style: const TextStyle(color: Color(0xFF3B4A63)),
                            )
                          else
                            Text(
                              u.message,
                              style: const TextStyle(color: Color(0xFF3B4A63)),
                            ),
                          if (u.changeNote case final note?)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: SelectableText(
                                note,
                                style: const TextStyle(
                                  color: Color(0xFF3B4A63),
                                ),
                              ),
                            ),
                          if (_resourceDiff(u) case final diff?)
                            Padding(
                              padding: const EdgeInsets.only(top: 3),
                              child: Text(
                                diff,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
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
