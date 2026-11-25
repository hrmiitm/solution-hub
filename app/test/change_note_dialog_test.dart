import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:solutionhub/widgets/change_note_dialog.dart';

void main() {
  testWidgets('a change note needs text and can be canceled', (tester) async {
    final answers = <String?>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                answers.add(
                  await showChangeNoteDialog(
                    context,
                    title: 'Mark as completed?',
                    action: 'Mark completed',
                    hint: 'What was delivered or verified?',
                  ),
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );

    Future<void> tap(String label) async {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    await tap('Open');
    await tester.enterText(find.byType(TextFormField), '   ');
    await tap('Mark completed');
    expect(find.text('Enter a change note.'), findsOneWidget);
    expect(answers, isEmpty);

    await tester.enterText(find.byType(TextFormField), '  Handoff approved.  ');
    await tap('Mark completed');
    expect(answers, ['Handoff approved.']);

    await tap('Open');
    await tester.enterText(find.byType(TextFormField), 'Draft');
    await tap('Cancel');
    expect(answers, ['Handoff approved.', null]);
  });
}
