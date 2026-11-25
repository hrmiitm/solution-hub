import 'package:flutter_test/flutter_test.dart';
import 'package:solutionhub/widgets/pager.dart';

void main() {
  test('pagerItems keeps first, last and neighbours with gaps', () {
    expect(pagerItems(1, 1), [1]);
    expect(pagerItems(1, 3), [1, 2, 3]);
    expect(pagerItems(1, 10), [1, 2, null, 10]);
    expect(pagerItems(5, 10), [1, null, 4, 5, 6, null, 10]);
    expect(pagerItems(10, 10), [1, null, 9, 10]);
    expect(pagerItems(3, 5), [1, 2, 3, 4, 5]);
  });
}
