// Typed models mirroring the REST API's JSON (camelCase).

List<String> _strings(Object? v) =>
    v is List ? v.whereType<String>().toList() : const <String>[];
DateTime _date(Object? v) =>
    DateTime.tryParse(v as String? ?? '')?.toLocal() ??
    DateTime.fromMillisecondsSinceEpoch(0);
DateTime? _dateOrNull(Object? v) =>
    v == null ? null : DateTime.tryParse(v as String)?.toLocal();

class Owner {
  const Owner({required this.username, required this.name, this.avatarUrl});
  final String username;
  final String name;
  final String? avatarUrl;

  factory Owner.fromJson(Map<String, dynamic> j) => Owner(
    username: j['username'] as String,
    name: (j['name'] as String?) ?? '',
    avatarUrl: j['avatarUrl'] as String?,
  );

  String get displayName => name.isNotEmpty ? name : username;
}

class Me extends Owner {
  const Me({
    required super.username,
    required super.name,
    super.avatarUrl,
    required this.email,
    this.orgDomain,
  });
  final String email;

  /// Verified Google Workspace domain; null for personal accounts, which
  /// cannot use organization visibility.
  final String? orgDomain;

  factory Me.fromJson(Map<String, dynamic> j) => Me(
    username: j['username'] as String,
    name: (j['name'] as String?) ?? '',
    avatarUrl: j['avatarUrl'] as String?,
    email: (j['email'] as String?) ?? '',
    orgDomain: j['orgDomain'] as String?,
  );
}

class Resource {
  const Resource({required this.label, required this.url, required this.type});
  final String label;
  final String url;
  final String type;

  factory Resource.fromJson(Map<String, dynamic> j) => Resource(
    label: j['label'] as String? ?? '',
    url: j['url'] as String,
    type: j['type'] as String? ?? 'link',
  );

  Map<String, dynamic> toJson() => {'label': label, 'url': url, 'type': type};
}

enum SolutionStatus { ongoing, completed }

/// Who can see a solution. Names match the API values.
enum SolutionVisibility {
  public('Public', 'Anyone, including people who are not signed in'),
  organization(
    'Organization',
    'Signed-in members of your Google Workspace organization',
  ),
  private('Private', 'Only you');

  const SolutionVisibility(this.label, this.description);
  final String label;
  final String description;

  static SolutionVisibility parse(Object? v) => values.firstWhere(
    (e) => e.name == v,
    orElse: () => SolutionVisibility.private,
  );
}

class Solution {
  const Solution({
    required this.id,
    required this.slug,
    required this.path,
    required this.title,
    required this.summary,
    required this.descriptionMd,
    required this.client,
    required this.type,
    required this.industry,
    required this.function,
    required this.category,
    required this.technologies,
    required this.keywords,
    required this.resources,
    required this.thumbnailUrl,
    required this.primaryResource,
    required this.visibility,
    required this.orgDomain,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.completedAt,
    required this.owner,
    required this.isOwner,
  });

  final String id;
  final String slug;
  final String path;
  final String title;
  final String summary;
  final String? descriptionMd;
  final String? client;
  final String type;
  final List<String> industry;
  final List<String> function;
  final List<String> category;
  final List<String> technologies;
  final List<String> keywords;
  final List<Resource> resources;
  final String? thumbnailUrl;
  final String? primaryResource;
  final SolutionVisibility visibility;

  /// The owner's organization; only set for organization-visible solutions.
  final String? orgDomain;
  bool get isPrivate => visibility == SolutionVisibility.private;
  final SolutionStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final Owner owner;
  final bool isOwner;

  bool get isCompleted => status == SolutionStatus.completed;

  factory Solution.fromJson(Map<String, dynamic> j) => Solution(
    id: j['id'] as String,
    slug: j['slug'] as String,
    path: j['path'] as String,
    title: j['title'] as String,
    summary: (j['summary'] as String?) ?? '',
    descriptionMd: j['descriptionMd'] as String?,
    client: j['client'] as String?,
    type: (j['type'] as String?) ?? 'other',
    industry: _strings(j['industry']),
    function: _strings(j['function']),
    category: _strings(j['category']),
    technologies: _strings(j['technologies']),
    keywords: _strings(j['keywords']),
    resources: (j['resources'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Resource.fromJson)
        .toList(),
    thumbnailUrl: j['thumbnailUrl'] as String?,
    primaryResource: j['primaryResource'] as String?,
    visibility: SolutionVisibility.parse(j['visibility']),
    orgDomain: j['orgDomain'] as String?,
    status: j['status'] == 'completed'
        ? SolutionStatus.completed
        : SolutionStatus.ongoing,
    createdAt: _date(j['createdAt']),
    updatedAt: _date(j['updatedAt']),
    completedAt: _dateOrNull(j['completedAt']),
    owner: Owner.fromJson(j['owner'] as Map<String, dynamic>),
    isOwner: j['isOwner'] == true,
  );
}

class SolutionPage {
  const SolutionPage({
    required this.items,
    required this.total,
    required this.page,
    required this.limit,
  });
  final List<Solution> items;
  final int total;
  final int page;
  final int limit;

  bool get hasMore => page * limit < total;

  factory SolutionPage.fromJson(Map<String, dynamic> j) => SolutionPage(
    items: (j['items'] as List)
        .cast<Map<String, dynamic>>()
        .map(Solution.fromJson)
        .toList(),
    total: j['total'] as int,
    page: j['page'] as int,
    limit: j['limit'] as int,
  );
}

class ProfileCounts {
  const ProfileCounts({
    required this.ongoing,
    required this.completed,
    required this.total,
    required this.private,
  });
  final int ongoing;
  final int completed;
  final int total;
  final int private;
}

class Profile {
  const Profile({
    required this.user,
    required this.joinedAt,
    required this.isSelf,
    required this.counts,
  });
  final Owner user;
  final DateTime joinedAt;
  final bool isSelf;
  final ProfileCounts counts;

  factory Profile.fromJson(Map<String, dynamic> j) {
    final c = j['counts'] as Map<String, dynamic>;
    return Profile(
      user: Owner.fromJson(j),
      joinedAt: _date(j['joinedAt']),
      isSelf: j['isSelf'] == true,
      counts: ProfileCounts(
        ongoing: c['ongoing'] as int,
        completed: c['completed'] as int,
        total: c['total'] as int,
        private: c['private'] as int? ?? 0,
      ),
    );
  }
}

class SolutionUpdate {
  const SolutionUpdate({
    required this.id,
    required this.eventType,
    required this.message,
    required this.changes,
    required this.createdAt,
    required this.author,
  });
  final String id;
  final String eventType;
  final String message;
  final Map<String, dynamic> changes;
  final DateTime createdAt;
  final Owner author;

  String? get changeNote => switch (changes['note']) {
    final String note when note.isNotEmpty => note,
    _ => null,
  };

  factory SolutionUpdate.fromJson(Map<String, dynamic> j) => SolutionUpdate(
    id: j['id'] as String,
    eventType: j['eventType'] as String,
    message: (j['message'] as String?) ?? '',
    changes: (j['changes'] as Map<String, dynamic>?) ?? const {},
    createdAt: _date(j['createdAt']),
    author: Owner.fromJson(j['author'] as Map<String, dynamic>),
  );
}

class Facet {
  const Facet(this.value, this.count);
  final String value;
  final int count;
}

/// Distinct metadata values (with counts) for filters and form suggestions.
class Categories {
  const Categories(this.facets);
  final Map<String, List<Facet>> facets;

  static const empty = Categories({});

  List<Facet> operator [](String key) => facets[key] ?? const [];
  List<String> values(String key) => this[key].map((f) => f.value).toList();

  factory Categories.fromJson(Map<String, dynamic> j) => Categories({
    for (final e in j.entries)
      if (e.value is List)
        e.key: (e.value as List)
            .cast<Map<String, dynamic>>()
            .map(
              (f) => Facet(f['value'].toString(), (f['count'] as num).toInt()),
            )
            .toList(),
  });
}

/// Search, filter, sort and paging options for solution lists.
class SolutionQuery {
  const SolutionQuery({
    this.q = '',
    this.filters = const {},
    this.sort,
    this.visibility,
    this.page = 1,
    this.limit = 12,
  });

  final String q;

  /// Filter key (status, type, industry, function, category, technology) -> selected values.
  final Map<String, Set<String>> filters;
  final String? sort;
  final String? visibility;
  final int page;
  final int limit;

  SolutionQuery copyWith({
    String? q,
    Map<String, Set<String>>? filters,
    String? sort,
    bool clearSort = false,
    int? page,
  }) => SolutionQuery(
    q: q ?? this.q,
    filters: filters ?? this.filters,
    sort: clearSort ? null : (sort ?? this.sort),
    visibility: visibility,
    page: page ?? this.page,
    limit: limit,
  );

  Map<String, String> toQueryParameters() => {
    if (q.trim().isNotEmpty) 'q': q.trim(),
    for (final e in filters.entries)
      if (e.value.isNotEmpty) e.key: e.value.join(','),
    'sort': ?sort,
    'visibility': ?visibility,
    'page': '$page',
    'limit': '$limit',
  };
}

class McpConnection {
  const McpConnection({
    required this.id,
    required this.name,
    required this.canWrite,
    this.clientId,
  });

  final String id;
  final String name;
  final bool canWrite;
  final String? clientId;

  factory McpConnection.fromJson(Map<String, dynamic> json) => McpConnection(
    id: json['id'] as String,
    name: json['clientName'] as String,
    canWrite: (json['scopes'] as List).contains('solutions:write'),
    clientId: json['clientId'] as String?,
  );
}
