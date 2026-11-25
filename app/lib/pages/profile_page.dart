import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/models.dart';
import '../app_scope.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
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
  bool _loadingMore = false;
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
        api.userSolutions(widget.username, _query(1)),
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

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final page = await AppScope.of(context).api
          .userSolutions(widget.username, _query(_items.length ~/ 24 + 1));
      if (!mounted) return;
      final seen = _items.map((s) => s.id).toSet();
      setState(() {
        _items = [..._items, ...page.items.where((s) => !seen.contains(s.id))];
        _total = page.total;
      });
    } catch (e) {
      if (mounted) showMessage(context, e.toString());
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
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
                        setState(() => _status = value);
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
              if (_items.length < _total)
                Center(
                  child: OutlinedButton(
                    onPressed: _loadingMore ? null : _loadMore,
                    child: Text(_loadingMore ? 'Loading…' : 'Load more'),
                  ),
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
