import 'package:flutter/material.dart';

import '../theme.dart';

/// Editable list of short values (chips) with autocomplete from existing
/// values, so people reuse "Computer Vision" instead of inventing "CV".
class TagInput extends StatefulWidget {
  const TagInput({
    super.key,
    required this.label,
    required this.values,
    required this.onChanged,
    this.suggestions = const [],
    this.hint = 'Type and press Enter',
    this.maxItems = 10,
    this.maxLength = 50,
    this.lowercase = false,
  });

  final String label;
  final List<String> values;
  final ValueChanged<List<String>> onChanged;
  final List<String> suggestions;
  final String hint;
  final int maxItems;
  final int maxLength;
  final bool lowercase;

  @override
  State<TagInput> createState() => _TagInputState();
}

class _TagInputState extends State<TagInput> {
  TextEditingController? _text;
  FocusNode? _focus;

  void _add(String raw) {
    final parts = raw
        .split(',')
        .map((s) => s.trim().replaceAll(RegExp(r'\s+'), ' '))
        .where((s) => s.isNotEmpty);
    final next = [...widget.values];
    for (var v in parts) {
      if (widget.lowercase) v = v.toLowerCase();
      if (v.length > widget.maxLength) v = v.substring(0, widget.maxLength);
      // Reuse the existing spelling of a known value.
      final known = widget.suggestions.where(
        (s) => s.toLowerCase() == v.toLowerCase(),
      );
      if (known.isNotEmpty && !widget.lowercase) v = known.first;
      if (next.length >= widget.maxItems) break;
      if (!next.any((e) => e.toLowerCase() == v.toLowerCase())) next.add(v);
    }
    _text?.clear();
    if (next.length != widget.values.length) widget.onChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final full = widget.values.length >= widget.maxItems;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        if (widget.values.isNotEmpty) ...[
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final v in widget.values)
                InputChip(
                  label: Text(v),
                  onDeleted: () =>
                      widget.onChanged([...widget.values]..remove(v)),
                  deleteButtonTooltipMessage: 'Remove',
                  visualDensity: VisualDensity.compact,
                  backgroundColor: context.colors.tagBg,
                ),
            ],
          ),
          const SizedBox(height: 6),
        ],
        if (!full)
          RawAutocomplete<String>(
            optionsBuilder: (value) {
              final q = value.text.trim().toLowerCase();
              if (q.isEmpty) return const Iterable<String>.empty();
              final selected = widget.values
                  .map((e) => e.toLowerCase())
                  .toSet();
              return widget.suggestions
                  .where(
                    (s) =>
                        s.toLowerCase().contains(q) &&
                        !selected.contains(s.toLowerCase()),
                  )
                  .take(8);
            },
            onSelected: _add,
            fieldViewBuilder: (context, controller, focusNode, onSubmit) {
              _text = controller;
              _focus = focusNode;
              return TextField(
                controller: controller,
                focusNode: focusNode,
                decoration: InputDecoration(hintText: widget.hint),
                onSubmitted: (v) {
                  _add(v);
                  _focus?.requestFocus();
                },
                onChanged: (v) {
                  if (v.endsWith(',')) _add(v);
                },
              );
            },
            optionsViewBuilder: (context, onSelected, options) => Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxHeight: 240,
                    maxWidth: 360,
                  ),
                  child: ListView(
                    padding: EdgeInsets.zero,
                    shrinkWrap: true,
                    children: [
                      for (final o in options)
                        ListTile(
                          dense: true,
                          title: Text(o),
                          onTap: () => onSelected(o),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
