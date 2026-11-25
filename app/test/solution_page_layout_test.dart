import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:solutionhub/api/api_client.dart';
import 'package:solutionhub/app_scope.dart';
import 'package:solutionhub/auth/auth_controller.dart';
import 'package:solutionhub/auth/token_store.dart';
import 'package:solutionhub/pages/explore_controller.dart';
import 'package:solutionhub/pages/solution_page.dart';
import 'package:solutionhub/theme.dart';
import 'package:solutionhub/widgets/common.dart';
import 'package:solutionhub/widgets/resource_preview.dart';

class _TestTokenStore extends TokenStore {
  @override
  Future<String?> read() async => null;
}

const _slug =
    'a-long-solution-slug-for-checking-the-breadcrumb-on-narrow-screens';
const _resources = [
  {
    'label': 'Project repository',
    'url': 'https://example.invalid/repo',
    'type': 'repository',
  },
  {
    'label': 'Architecture diagram',
    'url': 'https://example.invalid/diagram.png',
    'type': 'image',
  },
];

Future<void> _showSolution(
  WidgetTester tester, {
  required double width,
  required List<Map<String, String>> resources,
  bool checkLoading = false,
}) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final pending = checkLoading ? Completer<void>() : null;
  final api = ApiClient(
    baseUrl: 'https://example.invalid',
    tokenStore: _TestTokenStore(),
    client: MockClient((request) async {
      await pending?.future;
      final body = switch (request.url.path) {
        '/api/users/sam/solutions/$_slug' => {
          'id': 'layout-1',
          'slug': _slug,
          'path': '/sam/$_slug',
          'title': 'Project showcase',
          'descriptionMd': 'Project description',
          'resources': resources,
          'owner': {'username': 'sam', 'name': 'Sam Example'},
        },
        '/api/solutions/layout-1/updates' => {'items': []},
        _ => null,
      };
      return http.Response(jsonEncode(body), body == null ? 404 : 200);
    }),
  );
  final auth = AuthController(api)..status = AuthStatus.signedOut;
  await tester.pumpWidget(
    AppScope(
      api: api,
      auth: auth,
      explore: ExploreController(api),
      themeMode: ThemeMode.light,
      onThemeChanged: (_) {},
      child: MaterialApp(
        theme: buildTheme(),
        home: const Scaffold(
          body: SolutionPage(username: 'sam', slug: _slug),
        ),
      ),
    ),
  );
  if (pending != null) {
    expect(find.byType(SkeletonBlock), findsWidgets);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Project showcase'), findsNothing);
    pending.complete();
  }
  await tester.pumpAndSettle();
  expect(find.byType(SkeletonBlock), findsNothing);
}

Finder _panel(Finder child) =>
    find.ancestor(of: child, matching: find.byType(Panel)).first;

void main() {
  testWidgets('desktop places resources and details in the sidebar', (
    tester,
  ) async {
    await _showSolution(
      tester,
      width: 1280,
      resources: _resources,
      checkLoading: true,
    );
    final preview = tester.getRect(_panel(find.byType(ResourcePreview)));
    final resources = tester.getRect(_panel(find.text('Resources')));
    final description = tester.getRect(_panel(find.text('Description')));
    final details = tester.getRect(_panel(find.text('Details')));
    final history = tester.getRect(_panel(find.text('Update history')));

    expect(resources.top, preview.top);
    expect(resources.left, greaterThan(preview.right));
    expect(description.left, preview.left);
    expect(description.right, resources.right);
    expect(description.top, greaterThan(preview.bottom));
    expect(description.top, greaterThan(resources.bottom));
    expect(history.top, greaterThan(description.bottom));
    expect(details.top, history.top);
    expect(details.left, greaterThan(history.right));
    expect(details.left, resources.left);

    final previewButton = find.byTooltip('Preview Architecture diagram');
    await tester.tap(previewButton);
    await tester.pumpAndSettle();
    expect(find.byType(ResourcePreview), findsNWidgets(2));
    await tester.tap(find.byTooltip('Hide Architecture diagram preview'));
    await tester.pumpAndSettle();
    expect(find.byType(ResourcePreview), findsOneWidget);
  });

  testWidgets('phone stacks preview, resources, description and history', (
    tester,
  ) async {
    await _showSolution(tester, width: 360, resources: _resources);
    final sections = [
      find.byType(ResourcePreview),
      for (final title in [
        'Resources',
        'Description',
        'Details',
        'Update history',
      ])
        find.text(title),
    ].map((finder) => tester.getRect(_panel(finder))).toList();
    for (var index = 1; index < sections.length; index++) {
      expect(sections[index].left, sections.first.left);
      expect(sections[index].right, sections.first.right);
      expect(sections[index].top, greaterThan(sections[index - 1].bottom));
    }
  });

  testWidgets('link-only solutions use the full width for resources', (
    tester,
  ) async {
    await _showSolution(tester, width: 1280, resources: [_resources.first]);
    expect(find.byType(ResourcePreview), findsNothing);
    final resources = tester.getRect(_panel(find.text('Resources')));
    final description = tester.getRect(_panel(find.text('Description')));
    expect(resources.left, description.left);
    expect(resources.right, description.right);
    expect(resources.bottom, lessThan(description.top));
  });
}
