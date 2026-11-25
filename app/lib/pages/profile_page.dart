import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../api/models.dart';
import '../app_scope.dart';
import '../config.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import '../widgets/pager.dart';
import '../widgets/solution_card.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key, required this.username});
  final String username;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  Profile? _profile;
  List<Solution> _items = [];
  int _total = 0;
  String? _status; // null = all
  bool _loading = true;
  int _page = 1;
  Object? _error;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(ProfilePage old) {
    super.didUpdateWidget(old);
    if (old.username != widget.username) {
      _profile = null;
      _status = null;
      _page = 1;
      _load();
    }
  }

  SolutionQuery _query(int page) => SolutionQuery(
    filters: {
      if (_status != null) 'status': {_status!},
    },
    page: page,
  );

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    final id = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        api.profile(widget.username),
        api.userSolutions(widget.username, _query(_page)),
      ]);
      if (!mounted || id != _request) return;
      final page = results[1] as SolutionPage;
      setState(() {
        _profile = results[0] as Profile;
        _items = page.items;
        _total = page.total;
      });
    } catch (e) {
      if (mounted && id == _request) setState(() => _error = e);
    } finally {
      if (mounted && id == _request) setState(() => _loading = false);
    }
  }

  void _goToPage(int page) {
    if (page == _page || page < 1) return;
    _page = page;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_profile == null) {
      if (_error != null) {
        return PageBody(
          child: ErrorView(error: _error!, onRetry: _load),
        );
      }
      return const LoadingView();
    }
    final p = _profile!;
    final compact = MediaQuery.sizeOf(context).width < kCompactWidth;
    return SingleChildScrollView(
      child: PageBody(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: EdgeInsets.all(compact ? 14 : 20),
                child: Row(
                  children: [
                    UserAvatar(p.user, size: compact ? 56 : 68),
                    SizedBox(width: compact ? 12 : 18),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p.user.displayName,
                            style: TextStyle(
                              fontSize: compact ? 20 : 24,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            '@${p.user.username} · Joined ${formatDate(p.joinedAt)}',
                            style: const TextStyle(
                              color: AppColors.muted,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextButton.icon(
                            style: TextButton.styleFrom(
                              padding: EdgeInsets.zero,
                              minimumSize: const Size(0, 28),
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            onPressed: () async {
                              final link =
                                  '${AppConfig.apiBaseUrl}/${p.user.username}';
                              await Clipboard.setData(ClipboardData(text: link));
                              if (context.mounted) {
                                showMessage(context, 'Profile link copied: $link');
                              }
                            },
                            icon: const Icon(Icons.link, size: 16),
                            label: Text(
                              '/${p.user.username}',
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 18,
                            runSpacing: 4,
                            children: [
                              _Stat(p.counts.ongoing, 'Ongoing'),
                              _Stat(p.counts.completed, 'Completed'),
                              if (p.isSelf && p.counts.private > 0)
                                _Stat(p.counts.private, 'Private'),
                            ],
                          ),
                        ],
                      ),
                    ),
                    if (p.isSelf && !compact)
                      FilledButton.icon(
                        onPressed: () => context.go('/new'),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('New solution'),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Container(
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.line)),
              ),
              child: Row(
                children: [
                  for (final (value, label) in [
                    (null, 'All'),
                    ('ongoing', 'Ongoing'),
                    ('completed', 'Completed'),
                  ])
                    _Tab(
                      label: label,
                      active: _status == value,
                      onTap: () {
                        if (_status == value) return;
                        setState(() {
                          _status = value;
                          _page = 1;
                        });
                        _load();
                      },
                    ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (_error != null)
              ErrorView(error: _error!, onRetry: _load)
            else if (_loading && _items.isEmpty)
              const LoadingView()
            else if (_items.isEmpty)
              Card(
                child: MessageView(
                  icon: Icons.inbox_outlined,
                  title: p.isSelf
                      ? 'You have no solutions here yet'
                      : 'No solutions to show',
                  action: p.isSelf
                      ? FilledButton(
                          onPressed: () => context.go('/new'),
                          child: const Text('Create a solution'),
                        )
                      : null,
                ),
              )
            else ...[
              Opacity(
                opacity: _loading ? 0.6 : 1,
                child: SolutionGrid(items: _items),
              ),
              Pager(
                page: _page,
                total: _total,
                pageSize: _query(1).limit,
                busy: _loading,
                onPage: _goToPage,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label);
  final int value;
  final String label;

  @override
  Widget build(BuildContext context) => Text.rich(
    TextSpan(
      children: [
        TextSpan(
          text: '$value ',
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        TextSpan(
          text: label,
          style: const TextStyle(color: AppColors.muted),
        ),
      ],
    ),
  );
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.active, required this.onTap});
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: active ? AppColors.accent : Colors.transparent,
            width: 2,
          ),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: active ? AppColors.accent : AppColors.muted,
        ),
      ),
    ),
  );
}
