import 'package:flutter/material.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

Future<String?> showChangeNoteDialog(
  BuildContext context, {
  required String title,
  required String action,
  required String hint,
  String? initialNote,
}) {
  final formKey = GlobalKey<FormState>();
  const maxLength = 5000;
  String? note;

  return showDialog<String>(
    context: context,
    builder: (context) => PointerInterceptor(
      child: AlertDialog(
        title: Text(title),
        scrollable: true,
        content: SizedBox(
          width: 420,
          child: Form(
            key: formKey,
            child: TextFormField(
              initialValue: initialNote,
              autofocus: true,
              minLines: 3,
              maxLines: 6,
              maxLength: maxLength,
              decoration: InputDecoration(
                labelText: 'Change note',
                alignLabelWithHint: true,
                hintText: hint,
                helperText: 'Appears in Update history for anyone who can view this solution.',
                helperMaxLines: 2,
                counterText: '',
              ),
              validator: (value) {
                final text = value?.trim() ?? '';
                if (text.isEmpty) return 'Enter a change note.';
                if (text.length > maxLength) {
                  return 'Use at most $maxLength characters.';
                }
                return null;
              },
              onSaved: (value) => note = value!.trim(),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final form = formKey.currentState!;
              if (!form.validate()) return;
              form.save();
              Navigator.pop(context, note);
            },
            child: Text(action),
          ),
        ],
      ),
    ),
  );
}
