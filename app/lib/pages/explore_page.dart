import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../app_scope.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import '../widgets/pager.dart';
import '../widgets/solution_card.dart';
import 'explore_controller.dart';

class ExplorePage extends StatefulWidget {
  const ExplorePage({super.key});

  @override
  State<ExplorePage> createState() => _ExplorePageState();
}

class _ExplorePageState extends State<ExplorePage> {
  late final ExploreController c = AppScope.of(context).explore;
  late final TextEditingController _search = TextEditingController(
    text: c.query.q,
  );
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    // Refresh on every visit so newly created/edited solutions appear.
    WidgetsBinding.instance.addPostFrameCallback((_) => c.refresh());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onSearchChanged(String v) {
    setState(() {}); // toggles the clear button
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => c.setSearch(v));
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 900;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) => SingleChildScrollView(
        child: PageBody(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Explore solutions',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.6,
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                'Projects, demos and business solutions shared across the team.',
                style: TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 16),
              _toolbar(compact),
              const SizedBox(height: 14),
              if (compact)
                _results(context)
              else
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 232,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: FilterPanel(controller: c),
                        ),
                      ),
                    ),
                    const SizedBox(width: 20),
                    Expanded(child: _results(context)),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _toolbar(bool compact) {
    final sortItems = <String?, String>{
      if (c.query.q.trim().isNotEmpty)
        null: 'Best match'
      else
        null: 'Recently updated',
      if (c.query.q.trim().isNotEmpty) 'updated': 'Recently updated',
      'created': 'Recently created',
      'oldest': 'Oldest',
    };
    final sortValue = sortItems.containsKey(c.query.sort) ? c.query.sort : null;
    final search = TextField(
      controller: _search,
      onChanged: _onSearchChanged,
      onSubmitted: c.setSearch,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText:
            'Search titles, descriptions, keywords, technologies, people…',
        prefixIcon: const Icon(Icons.search, size: 20),
        suffixIcon: _search.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                icon: const Icon(Icons.close, size: 18),
                onPressed: () {
                  _search.clear();
                  c.setSearch('');
                  setState(() {});
                },
              ),
      ),
    );
    final sort = DropdownButtonHideUnderline(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.line),
          borderRadius: BorderRadius.circular(8),
        ),
        child: DropdownButton<String?>(
          value: sortValue,
          isDense: true,
          padding: const EdgeInsets.symmetric(vertical: 10),
          borderRadius: BorderRadius.circular(8),
          items: [
            for (final e in sortItems.entries)
              DropdownMenuItem(
                value: e.key,
                child: Text(e.value, style: const TextStyle(fontSize: 13)),
              ),
          ],
          onChanged: c.setSort,
        ),
      ),
    );
    if (!compact) {
      return Row(
        children: [
          Expanded(child: search),
          const SizedBox(width: 10),
          sort,
        ],
      );
    }
    return Column(
      children: [
        search,
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton.icon(
              onPressed: () => _openFilterSheet(context),
              icon: const Icon(Icons.tune, size: 18),
              label: Text(
                c.activeFilterCount > 0
                    ? 'Filters (${c.activeFilterCount})'
                    : 'Filters',
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Align(alignment: Alignment.centerRight, child: sort),
            ),
          ],
        ),
      ],
    );
  }

  void _openFilterSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (context, scroll) => ListenableBuilder(
          listenable: c,
          builder: (context, _) => SingleChildScrollView(
            controller: scroll,
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
            child: FilterPanel(controller: c),
          ),
        ),
      ),
    );
  }

  Widget _results(BuildContext context) {
    final active = [
      for (final e in c.query.filters.entries)
        for (final v in e.value) (e.key, v),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text(
              c.loading && c.items.isEmpty
                  ? 'Loading…'
                  : '${c.total} ${c.total == 1 ? 'solution' : 'solutions'}',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            if (c.loading && c.items.isNotEmpty) ...[
              const SizedBox(width: 8),
              const SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(strokeWidth: 1.6),
              ),
            ],
          ],
        ),
        if (active.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              for (final (key, value) in active)
                InputChip(
                  label: Text(
                    key == 'status' || key == 'type'
                        ? capitalize(value)
                        : value,
                  ),
                  onDeleted: () => c.toggleFilter(key, value),
                  visualDensity: VisualDensity.compact,
                ),
              TextButton(
                onPressed: c.clearFilters,
                child: const Text('Clear all'),
              ),
            ],
          ),
        ],
        const SizedBox(height: 10),
        if (c.error != null && c.items.isEmpty)
          Card(
            child: ErrorView(error: c.error!, onRetry: c.refresh),
          )
        else if (c.loading && c.items.isEmpty)
          const LoadingView()
        else if (c.items.isEmpty)
          Card(
            child: MessageView(
              icon: Icons.inbox_outlined,
              title: c.query.q.isNotEmpty || active.isNotEmpty
                  ? 'No matching solutions'
                  : 'No public solutions yet',
              message: c.query.q.isNotEmpty || active.isNotEmpty
                  ? 'Try different keywords or remove some filters.'
                  : 'Share the first one — it only takes a minute.',
            ),
          )
        else ...[
          SolutionGrid(items: c.items),
          Pager(
            page: c.page,
            total: c.total,
            pageSize: c.query.limit,
            busy: c.loading,
            onPage: c.goToPage,
          ),
        ],
      ],
    );
  }
}

/// Filter sections (status, type and any user-selected extras).
class FilterPanel extends StatelessWidget {
  const FilterPanel({super.key, required this.controller});
  final ExploreController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Filters',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            if (c.activeFilterCount > 0)
              TextButton(
                onPressed: c.clearFilters,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                ),
                child: const Text('Clear'),
              ),
            IconButton(
              tooltip: 'Customize filters',
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.tune, size: 18),
              onPressed: () => _customize(context),
            ),
          ],
        ),
        for (final f in c.visibleFilters) _FilterSection(def: f, controller: c),
      ],
    );
  }

  Future<void> _customize(BuildContext context) async {
    final selected = {...controller.extraFilters};
    final result = await showDialog<Set<String>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Customize filters'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final f in filterDefs.where((f) => !f.always))
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(f.label),
                  value: selected.contains(f.key),
                  onChanged: (v) => setState(
                    () => v == true
                        ? selected.add(f.key)
                        : selected.remove(f.key),
                  ),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, selected),
              child: const Text('Apply'),
            ),
          ],
        ),
      ),
    );
    if (result != null) await controller.setExtraFilters(result);
  }
}

class _FilterSection extends StatefulWidget {
  const _FilterSection({required this.def, required this.controller});
  final FilterDef def;
  final ExploreController controller;

  @override
  State<_FilterSection> createState() => _FilterSectionState();
}

class _FilterSectionState extends State<_FilterSection> {
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final key = widget.def.key;
    List<Facet> facets = c.categories[widget.def.facet ?? key];
    // Keep fixed options visible even when a value currently has no results.
    if (key == 'status') {
      facets = [
        for (final v in ['ongoing', 'completed']) Facet(v, _count(facets, v)),
      ];
    } else if (key == 'type') {
      facets = [for (final v in solutionTypes) Facet(v, _count(facets, v))];
    }
    // Selected values stay listed even if the current data lacks them.
    for (final v in c.query.filters[key] ?? const <String>{}) {
      if (!facets.any((f) => f.value == v)) facets = [...facets, Facet(v, 0)];
    }
    final visible = _showAll ? facets : facets.take(6).toList();

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text(
              widget.def.label,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
          ),
          if (facets.isEmpty)
            const Text(
              'No values yet',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          for (final f in visible)
            InkWell(
              onTap: () => c.toggleFilter(key, f.value),
              borderRadius: BorderRadius.circular(6),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    SizedBox(
                      width: 28,
                      height: 26,
                      child: Checkbox(
                        value: c.isSelected(key, f.value),
                        onChanged: (_) => c.toggleFilter(key, f.value),
                        visualDensity: VisualDensity.compact,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        key == 'status' || key == 'type'
                            ? capitalize(f.value)
                            : f.value,
                        style: const TextStyle(fontSize: 12.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      '${f.count}',
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (facets.length > 6)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() => _showAll = !_showAll),
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                ),
                child: Text(
                  _showAll ? 'Show less' : 'Show all ${facets.length}',
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ),
        ],
      ),
    );
  }

  static int _count(List<Facet> facets, String value) =>
      facets.where((f) => f.value == value).fold(0, (n, f) => n + f.count);
}
