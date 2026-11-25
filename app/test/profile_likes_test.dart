import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:solutionhub/api/api_client.dart';
import 'package:solutionhub/api/models.dart';
import 'package:solutionhub/app_scope.dart';
import 'package:solutionhub/auth/auth_controller.dart';
import 'package:solutionhub/auth/token_store.dart';
import 'package:solutionhub/pages/explore_controller.dart';
import 'package:solutionhub/pages/profile_page.dart';
import 'package:solutionhub/theme.dart';

class _TestTokenStore extends TokenStore {
  @override
  Future<String?> read() async => null;
}

void main() {
  testWidgets('the profile owner can unlike a saved solution', (tester) async {
    tester.view.physicalSize = const Size(360, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const solution = {
      'id': 'solution-1',
      'slug': 'saved-demo',
      'path': '/alice/saved-demo',
      'title': 'Saved demo',
      'owner': {'username': 'alice'},
      'likeCount': 2,
      'likedByMe': true,
    };
    var liked = true;
    var likedListRequests = 0;
    http.Response json(Object body) => http.Response(jsonEncode(body), 200);
    http.Response page(List<Object> items) =>
        json({'items': items, 'total': items.length, 'page': 1, 'limit': 12});

    final api = ApiClient(
      baseUrl: 'https://example.invalid',
      tokenStore: _TestTokenStore(),
      client: MockClient((request) async {
        switch (request.url.path) {
          case '/api/users/bob':
          case '/api/users/alice':
            return json({
              'username': request.url.pathSegments.last,
              'isSelf': request.url.pathSegments.last == 'bob',
              'counts': {'ongoing': 0, 'completed': 0, 'total': 0},
            });
          case '/api/users/bob/solutions':
          case '/api/users/alice/solutions':
            return page([]);
          case '/api/me/liked-solutions':
            likedListRequests++;
            return page(liked ? [solution] : []);
          case '/api/solutions/solution-1/like':
            expect(request.method, 'DELETE');
            liked = false;
            return json({'likeCount': 1, 'likedByMe': false});
        }
        return http.Response('', 404);
      }),
    );
    final auth = AuthController(api)
      ..status = AuthStatus.signedIn
      ..me = const Me(username: 'bob', name: 'Bob', email: '');
    final explore = ExploreController(api);

    Future<void> showProfile(String username) async {
      await tester.pumpWidget(
        AppScope(
          api: api,
          auth: auth,
          explore: explore,
          themeMode: ThemeMode.light,
          onThemeChanged: (_) {},
          child: MaterialApp(
            theme: buildTheme(),
            home: Scaffold(body: ProfilePage(username: username)),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    await showProfile('alice');
    expect(find.text('Liked solutions'), findsNothing);
    expect(likedListRequests, 0);

    await showProfile('bob');
    await tester.ensureVisible(find.text('Liked solutions'));
    await tester.tap(find.text('Liked solutions'));
    await tester.pumpAndSettle();
    expect(find.text('Saved demo'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);

    await tester.ensureVisible(find.byTooltip('Unlike solution'));
    await tester.tap(find.byTooltip('Unlike solution'));
    await tester.pumpAndSettle();
    expect(find.text('Saved demo'), findsNothing);
    expect(find.text('No liked solutions yet'), findsOneWidget);
    expect(likedListRequests, 2);
  });
}
