import 'package:flutter_test/flutter_test.dart';
import 'package:solutionhub/api/models.dart';
import 'package:solutionhub/util/format.dart';
import 'package:solutionhub/util/keywords.dart';
import 'package:solutionhub/util/resources.dart';

void main() {
  group('suggestKeywords', () {
    test('ranks recurring and title terms, skips stopwords and markdown', () {
      final k = suggestKeywords(
        title: 'Retail shelf analytics',
        description:
            '## Overview\nComputer vision detects empty shelf gaps. Computer vision runs on edge cameras. '
            'See [docs](https://example.com/docs) and `code`.',
      );
      expect(k, contains('computer vision'));
      expect(k, contains('shelf'));
      expect(k, isNot(contains('the')));
      expect(k, isNot(contains('https')));
      expect(k.length, lessThanOrEqualTo(8));
    });

    test('is deterministic and respects exclusions', () {
      List<String> run() => suggestKeywords(
        title: 'Live translation',
        description: 'Real-time speech translation for meetings. Speech translation is fast.',
        exclude: ['speech translation'],
      );
      expect(run(), run());
      expect(run(), isNot(contains('speech translation')));
      expect(
        run(),
        isNot(contains('speech')),
        reason: 'covered by an existing keyword',
      );
    });

    test('boosts known vocabulary', () {
      final k = suggestKeywords(
        title: 'x',
        description: 'Uses Kotlin on device.',
        vocabulary: ['Kotlin'],
      );
      expect(k.first, 'kotlin');
    });
  });

  group('resources', () {
    test('detects types', () {
      expect(detectResourceType('https://youtu.be/aircAruvnKk'), 'youtube');
      expect(
        detectResourceType('https://docs.google.com/presentation/d/abc/edit'),
        'slides',
      );
      expect(detectResourceType('https://arxiv.org/pdf/1706.03762'), 'pdf');
      expect(detectResourceType('https://github.com/a/b'), 'repository');
      expect(detectResourceType('https://huggingface.co/a/b'), 'model');
      expect(detectResourceType('https://example.com/README.md'), 'markdown');
      expect(detectResourceType('https://example.com'), 'link');
    });

    test('rejects unsafe URLs', () {
      expect(safeHttpUrl('javascript:alert(1)'), isNull);
      expect(safeHttpUrl('data:text/html,x'), isNull);
      expect(safeHttpUrl('https://u:p@x.com'), isNull);
      expect(safeHttpUrl('https://x.com/a'), 'https://x.com/a');
    });

    test('builds embed URLs', () {
      expect(
        embedUrl(
          'youtube',
          'https://www.youtube.com/watch?v=aircAruvnKk',
          isWeb: true,
        ),
        'https://www.youtube-nocookie.com/embed/aircAruvnKk',
      );
      expect(
        embedUrl(
          'slides',
          'https://docs.google.com/presentation/d/AbC_1/edit',
          isWeb: true,
        ),
        contains('/presentation/d/AbC_1/embed'),
      );
      expect(
        embedUrl('pdf', 'https://x.com/a.pdf', isWeb: false),
        startsWith('https://docs.google.com/viewer'),
      );
      expect(
        rawContentUrl('https://github.com/o/r/blob/main/README.md'),
        'https://raw.githubusercontent.com/o/r/main/README.md',
      );
    });
  });

  test('query parameters', () {
    const q = SolutionQuery(
      q: ' llm ',
      filters: {
        'status': {'ongoing'},
      },
      sort: 'created',
      visibility: 'public',
    );
    expect(q.toQueryParameters(), {
      'q': 'llm',
      'status': 'ongoing',
      'sort': 'created',
      'visibility': 'public',
      'page': '1',
      'limit': '24',
    });
  });

  test('formatting helpers', () {
    expect(initials('Ada Lovelace'), 'AL');
    expect(initials(''), '?');
    final now = DateTime(2026, 1, 10, 12);
    expect(
      relativeDate(now.subtract(const Duration(hours: 3)), now: now),
      '3h ago',
    );
    expect(relativeDate(DateTime(2025, 12, 1), now: now), 'Dec 1, 2025');
  });

  test('parses solution JSON', () {
    final s = Solution.fromJson({
      'id': '1',
      'slug': 's',
      'path': '/u/s',
      'title': 'T',
      'summary': '',
      'type': 'demo',
      'industry': ['A'],
      'function': [],
      'category': [],
      'technologies': [],
      'keywords': [],
      'resources': [
        {'label': 'R', 'url': 'https://x.com', 'type': 'link'},
      ],
      'visibility': 'private',
      'status': 'completed',
      'createdAt': '2026-01-01T00:00:00Z',
      'updatedAt': '2026-01-02T00:00:00Z',
      'completedAt': null,
      'owner': {'username': 'u', 'name': 'U', 'avatarUrl': null},
      'isOwner': true,
    });
    expect(s.isPrivate, isTrue);
    expect(
      SolutionVisibility.parse('organization'),
      SolutionVisibility.organization,
    );
    expect(
      SolutionVisibility.parse('unknown'),
      SolutionVisibility.private,
      reason: 'unknown values fail closed',
    );
    expect(s.isCompleted, isTrue);
    expect(s.resources.single.label, 'R');
  });
}
