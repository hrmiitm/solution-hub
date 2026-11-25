import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/models.dart';

class FilterDef {
  const FilterDef(this.key, this.label, {this.facet, this.always = false});

  /// Query parameter name.
  final String key;
  final String label;

  /// Key in the /api/categories response (defaults to [key]).
  final String? facet;

  /// Always shown; the others can be switched on in "Customize filters".
  final bool always;
}

const filterDefs = [
  FilterDef('status', 'Status', always: true),
  FilterDef('type', 'Type', always: true),
  FilterDef('category', 'Solution category'),
  FilterDef('technology', 'Technology'),
  FilterDef('industry', 'Industry'),
  FilterDef('function', 'Function'),
];

/// Explore page state (search, filters, sort, paging). Lives for the whole
/// session so returning to Explore restores what the user was looking at.
class ExploreController extends ChangeNotifier {
  ExploreController(this.api);

  final ApiClient api;
  static const _prefsKey = 'explore.extraFilters';

  /// Explore lists shared solutions (public, and organization ones the viewer
  /// may see); private solutions appear only on their owner's profile.
  static const sharedLevels = 'public,organization';
  SolutionQuery query = const SolutionQuery(visibility: sharedLevels);
  List<Solution> items = [];
  int total = 0;
  bool loading = false;
  bool loadingMore = false;
  Object? error;
  Categories categories = Categories.empty;
  Set<String> extraFilters = {};
  int _requestId = 0;
  bool _prefsLoaded = false;

  bool get hasMore => items.length < total;
  int get activeFilterCount =>
      query.filters.values.fold(0, (n, v) => n + v.length);
  List<FilterDef> get visibleFilters => filterDefs
      .where((f) => f.always || extraFilters.contains(f.key))
      .toList();

  Future<void> _loadPrefs() async {
    if (_prefsLoaded) return;
    _prefsLoaded = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      extraFilters = (prefs.getStringList(_prefsKey) ?? const ['category'])
          .toSet();
    } catch (_) {
      extraFilters = {'category'};
    }
  }

  Future<void> setExtraFilters(Set<String> keys) async {
    extraFilters = keys;
    // Drop selections for filters that are no longer shown.
    final filters = {
      for (final e in query.filters.entries)
        if (visibleFilters.any((f) => f.key == e.key)) e.key: e.value,
    };
    notifyListeners();
    if (filters.length != query.filters.length) {
      _apply(query.copyWith(filters: filters));
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_prefsKey, keys.toList());
    } catch (_) {}
  }

  /// Reloads the first page (keeps current results visible meanwhile).
  Future<void> refresh() async {
    await _loadPrefs();
    final id = ++_requestId;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        api.solutions(query.copyWith(page: 1)),
        api.categories(visibility: sharedLevels),
      ]);
      if (id != _requestId) return;
      final page = results[0] as SolutionPage;
      categories = results[1] as Categories;
      items = page.items;
      total = page.total;
    } catch (e) {
      if (id != _requestId) return;
      error = e;
    } finally {
      if (id == _requestId) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> loadMore() async {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    notifyListeners();
    final id = _requestId;
    try {
      final next = query.copyWith(page: (items.length ~/ query.limit) + 1);
      final page = await api.solutions(next);
      if (id != _requestId) return;
      final seen = items.map((s) => s.id).toSet();
      items = [...items, ...page.items.where((s) => !seen.contains(s.id))];
      total = page.total;
    } on ApiException catch (e) {
      error = e;
    } finally {
      loadingMore = false;
      notifyListeners();
    }
  }

  void _apply(SolutionQuery next) {
    query = next.copyWith(page: 1);
    refresh();
  }

  void setSearch(String q) {
    if (q.trim() == query.q.trim()) return;
    // With no explicit sort, the API orders searches by best match.
    _apply(query.copyWith(q: q, clearSort: query.sort == 'relevance'));
  }

  void setSort(String? sort) =>
      _apply(query.copyWith(sort: sort, clearSort: sort == null));

  void toggleFilter(String key, String value) {
    final filters = {
      for (final e in query.filters.entries) e.key: {...e.value},
    };
    final set = filters.putIfAbsent(key, () => <String>{});
    if (!set.remove(value)) set.add(value);
    if (set.isEmpty) filters.remove(key);
    _apply(query.copyWith(filters: filters));
  }

  void clearFilters() => _apply(query.copyWith(filters: {}));

  bool isSelected(String key, String value) =>
      query.filters[key]?.contains(value) ?? false;
}
