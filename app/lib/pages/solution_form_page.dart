import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../app_scope.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/keywords.dart';
import '../util/resources.dart';
import '../widgets/common.dart';
import '../widgets/markdown_view.dart';
import '../widgets/tag_input.dart';

/// One form for both creating and editing a solution. Pass [username] and
/// [slug] to edit an existing one.
class SolutionFormPage extends StatefulWidget {
  const SolutionFormPage({super.key, this.username, this.slug});
  final String? username;
  final String? slug;

  bool get isEdit => slug != null;

  @override
  State<SolutionFormPage> createState() => _SolutionFormPageState();
}

class _ResourceDraft {
  _ResourceDraft({String label = '', String url = '', String? type})
    : label = TextEditingController(text: label),
      url = TextEditingController(text: url),
      type = type ?? (url.isEmpty ? 'link' : detectResourceType(url)),
      typeLocked = type != null;

  final Key key = UniqueKey();
  final TextEditingController label;
  final TextEditingController url;
  String type;

  /// Set once the user picks a type by hand; stops auto-detection.
  bool typeLocked;

  void dispose() {
    label.dispose();
    url.dispose();
  }
}

class _SolutionFormPageState extends State<SolutionFormPage> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _summary = TextEditingController();
  final _description = TextEditingController();
  final _client = TextEditingController();
  final _thumbnail = TextEditingController();
  final List<_ResourceDraft> _resources = [];
  List<String> _keywords = [];
  List<String> _industry = [],
      _function = [],
      _category = [],
      _technologies = [];
  List<String> _suggested = [];
  String _type = 'demo';

  /// Set in _load: organization when available, else private (never public by default).
  SolutionVisibility _visibility = SolutionVisibility.private;
  String? _primary;
  bool _previewDescription = false;
  bool _moreOpen = false;
  bool _submitted = false;

  Solution? _original;
  Categories _categories = Categories.empty;
  bool _loading = true;
  bool _saving = false;
  Object? _loadError;
  Map<String, String> _serverErrors = {};
  Timer? _suggestTimer;

  ApiClient get _api => AppScope.of(context).api;
  String? get _orgDomain => AppScope.of(context).auth.me?.orgDomain;

  @override
  void initState() {
    super.initState();
    _title.addListener(_scheduleSuggestions);
    _description.addListener(_scheduleSuggestions);
    _load();
  }

  @override
  void dispose() {
    _suggestTimer?.cancel();
    for (final c in [_title, _summary, _description, _client, _thumbnail]) {
      c.dispose();
    }
    for (final r in _resources) {
      r.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final categories = await _api.categories();
      Solution? s;
      if (widget.isEdit) {
        s = await _api.solutionByPath(widget.username!, widget.slug!);
        if (!s.isOwner) {
          throw const ApiException(
            403,
            'forbidden',
            'Only the owner can edit this solution.',
          );
        }
      }
      if (!mounted) return;
      setState(() {
        _categories = categories;
        if (s != null) {
          _fill(s);
        } else if (_orgDomain != null) {
          _visibility = SolutionVisibility.organization;
        }
      });
      _updateSuggestions();
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _fill(Solution s) {
    _original = s;
    _title.text = s.title;
    _summary.text = s.summary;
    _description.text = s.descriptionMd ?? '';
    _client.text = s.client ?? '';
    _thumbnail.text = s.thumbnailUrl ?? '';
    _keywords = [...s.keywords];
    _industry = [...s.industry];
    _function = [...s.function];
    _category = [...s.category];
    _technologies = [...s.technologies];
    _type = s.type;
    _visibility = s.visibility;
    _primary = s.primaryResource;
    _resources.addAll(
      s.resources.map(
        (r) => _ResourceDraft(label: r.label, url: r.url, type: r.type),
      ),
    );
    _moreOpen =
        s.client != null ||
        s.thumbnailUrl != null ||
        s.industry.isNotEmpty ||
        s.function.isNotEmpty;
  }

  void _scheduleSuggestions() {
    _suggestTimer?.cancel();
    _suggestTimer = Timer(
      const Duration(milliseconds: 400),
      _updateSuggestions,
    );
  }

  void _updateSuggestions() {
    if (!mounted) return;
    final vocabulary = {
      for (final k in ['category', 'technology', 'industry', 'function'])
        ..._categories.values(k),
    };
    setState(() {
      _suggested = suggestKeywords(
        title: _title.text,
        description: _description.text,
        exclude: _keywords,
        vocabulary: vocabulary,
      );
    });
  }

  Map<String, dynamic> _payload() {
    final resources = [
      for (final r in _resources)
        if (r.url.text.trim().isNotEmpty)
          Resource(
            label: r.label.text.trim().isEmpty
                ? (resourceTypes[r.type] ?? 'Link')
                : r.label.text.trim(),
            url: r.url.text.trim(),
            type: r.type,
          ).toJson(),
    ];
    final urls = resources.map((r) => r['url']).toSet();
    return {
      'title': _title.text.trim(),
      'summary': _summary.text.trim(),
      'descriptionMd': _description.text.trim(),
      'type': _type,
      'visibility': _visibility.name,
      'keywords': _keywords,
      'resources': resources,
      'primaryResource': urls.contains(_primary) ? _primary : null,
      'client': _client.text.trim().isEmpty ? null : _client.text.trim(),
      'thumbnailUrl': _thumbnail.text.trim().isEmpty
          ? null
          : _thumbnail.text.trim(),
      'industry': _industry,
      'function': _function,
      'category': _category,
      'technologies': _technologies,
    };
  }

  Future<void> _save() async {
    setState(() {
      _serverErrors = {};
      _submitted = true;
      _previewDescription = false; // so the description field is validated
    });
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    if (!_formKey.currentState!.validate()) {
      showMessage(context, 'Please fix the highlighted fields.');
      return;
    }
    setState(() => _saving = true);
    try {
      final payload = _payload();
      final saved = widget.isEdit
          ? await _api.updateSolution(_original!.id, payload)
          : await _api.createSolution(payload);
      if (!mounted) return;
      showMessage(
        context,
        widget.isEdit ? 'Changes saved' : 'Solution created',
      );
      context.go(saved.path);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _serverErrors = e.details);
      _formKey.currentState!.validate();
      final extra = e.details.entries.where(
        (d) => d.key.startsWith('resources') || !_knownFields.contains(d.key),
      );
      showMessage(
        context,
        extra.isEmpty
            ? e.message
            : '${e.message}: ${extra.map((d) => '${d.key} ${d.value}').join('; ')}',
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  static const _knownFields = {
    'title',
    'descriptionMd',
    'summary',
    'thumbnailUrl',
    'client',
    'visibility',
  };

  String? _urlValidator(String? v, {bool required = false}) {
    final value = v?.trim() ?? '';
    if (value.isEmpty) return required ? 'Required' : null;
    return safeHttpUrl(value) == null ? 'Enter a full http(s) URL' : null;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingView();
    if (_loadError != null) {
      return PageBody(
        child: ErrorView(error: _loadError!, onRetry: _load),
      );
    }
    final compact = MediaQuery.sizeOf(context).width < kCompactWidth;

    return Form(
      key: _formKey,
      // After a failed save, errors update (and clear) as the user types.
      autovalidateMode: _submitted
          ? AutovalidateMode.onUserInteraction
          : AutovalidateMode.disabled,
      child: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              child: PageBody(
                maxWidth: 880,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      widget.isEdit ? 'Edit solution' : 'New solution',
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.6,
                      ),
                    ),
                    const SizedBox(height: 14),
                    Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _label('Title', required: true),
                          TextFormField(
                            controller: _title,
                            maxLength: 120,
                            decoration: const InputDecoration(
                              hintText: 'e.g. Live meeting translation for field teams',
                              counterText: '',
                            ),
                            validator: (v) => (v ?? '').trim().isEmpty
                                ? 'Title is required'
                                : _serverErrors['title'],
                          ),
                          if (!widget.isEdit)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: ValueListenableBuilder(
                                valueListenable: _title,
                                builder: (context, value, _) => Text(
                                  'URL: /${AppScope.of(context).auth.me?.username ?? 'you'}/${_slugPreview(value.text)}',
                                  style: const TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.muted,
                                  ),
                                ),
                              ),
                            ),
                          const SizedBox(height: 14),
                          Row(
                            children: [
                              Expanded(
                                child: _label(
                                  'Description',
                                  required: true,
                                  hint: 'Markdown supported',
                                ),
                              ),
                              SegmentedButton<bool>(
                                style: const ButtonStyle(
                                  visualDensity: VisualDensity.compact,
                                ),
                                showSelectedIcon: false,
                                segments: const [
                                  ButtonSegment(
                                    value: false,
                                    label: Text('Write'),
                                  ),
                                  ButtonSegment(
                                    value: true,
                                    label: Text('Preview'),
                                  ),
                                ],
                                selected: {_previewDescription},
                                onSelectionChanged: (v) => setState(
                                  () => _previewDescription = v.first,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          if (_previewDescription)
                            Container(
                              constraints: const BoxConstraints(minHeight: 180),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                border: Border.all(color: AppColors.line),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: _description.text.trim().isEmpty
                                  ? const Text(
                                      'Nothing to preview yet.',
                                      style: TextStyle(color: AppColors.muted),
                                    )
                                  : MarkdownView(_description.text),
                            )
                          else
                            TextFormField(
                              controller: _description,
                              minLines: 8,
                              maxLines: 22,
                              maxLength: 50000,
                              style: const TextStyle(
                                fontSize: 13.5,
                                height: 1.5,
                              ),
                              decoration: const InputDecoration(
                                hintText: 'What is it, who is it for, how does it work, what is the current state?',
                                counterText: '',
                              ),
                              validator: (v) => (v ?? '').trim().isEmpty
                                  ? 'Description is required'
                                  : _serverErrors['descriptionMd'],
                            ),
                          const SizedBox(height: 14),
                          _label(
                            'Short summary',
                            hint: 'Optional — taken from the description if left empty',
                          ),
                          TextFormField(
                            controller: _summary,
                            maxLength: 300,
                            maxLines: 2,
                            decoration: const InputDecoration(
                              hintText: 'One or two sentences shown on cards',
                              counterText: '',
                            ),
                            validator: (_) => _serverErrors['summary'],
                          ),
                          const SizedBox(height: 14),
                          TagInput(
                            label: 'Keywords',
                            values: _keywords,
                            lowercase: true,
                            maxItems: 20,
                            maxLength: 40,
                            hint: 'Add a keyword and press Enter',
                            onChanged: (v) {
                              setState(() => _keywords = v);
                              _updateSuggestions();
                            },
                          ),
                          if (_suggested.isNotEmpty &&
                              _keywords.length < 20) ...[
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                const Text(
                                  'Suggested:',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: AppColors.muted,
                                  ),
                                ),
                                for (final k in _suggested)
                                  ActionChip(
                                    label: Text('+ $k'),
                                    visualDensity: VisualDensity.compact,
                                    onPressed: () {
                                      setState(
                                        () => _keywords = [..._keywords, k],
                                      );
                                      _updateSuggestions();
                                    },
                                  ),
                                if (_suggested.length > 1)
                                  TextButton(
                                    onPressed: () {
                                      setState(
                                        () => _keywords = [
                                          ..._keywords,
                                          ..._suggested,
                                        ].take(20).toList(),
                                      );
                                      _updateSuggestions();
                                    },
                                    child: const Text(
                                      'Add all',
                                      style: TextStyle(fontSize: 12),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                          const SizedBox(height: 16),
                          Wrap(
                            spacing: 16,
                            runSpacing: 12,
                            crossAxisAlignment: WrapCrossAlignment.end,
                            children: [
                              SizedBox(
                                width: compact ? double.infinity : 220,
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _label('Type'),
                                    DropdownButtonFormField<String>(
                                      initialValue: _type,
                                      items: [
                                        for (final t in solutionTypes)
                                          DropdownMenuItem(
                                            value: t,
                                            child: Text(capitalize(t)),
                                          ),
                                      ],
                                      onChanged: (v) =>
                                          setState(() => _type = v ?? 'other'),
                                    ),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  _label('Visibility'),
                                  SegmentedButton<SolutionVisibility>(
                                    showSelectedIcon: false,
                                    segments: [
                                      for (final v in SolutionVisibility.values)
                                        ButtonSegment(
                                          value: v,
                                          icon: Icon(
                                            visibilityIcon(v),
                                            size: 16,
                                          ),
                                          label: Text(v.label),
                                          // Organization sharing needs a verified Workspace domain.
                                          enabled:
                                              v !=
                                                  SolutionVisibility
                                                      .organization ||
                                              _orgDomain != null ||
                                              _visibility ==
                                                  SolutionVisibility
                                                      .organization,
                                          tooltip:
                                              v ==
                                                      SolutionVisibility
                                                          .organization &&
                                                  _orgDomain == null
                                              ? 'Available with a Google Workspace (organization) account'
                                              : null,
                                        ),
                                    ],
                                    selected: {_visibility},
                                    onSelectionChanged: (v) =>
                                        setState(() => _visibility = v.first),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _visibility ==
                                                SolutionVisibility
                                                    .organization &&
                                            _orgDomain != null
                                        ? 'Only signed-in members of $_orgDomain'
                                        : _visibility.description,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: _serverErrors['visibility'] != null
                                          ? AppColors.danger
                                          : AppColors.muted,
                                    ),
                                  ),
                                  if (_serverErrors['visibility'] != null)
                                    Text(
                                      _serverErrors['visibility']!,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: AppColors.danger,
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    _resourcesPanel(compact),
                    const SizedBox(height: 14),
                    Card(
                      clipBehavior: Clip.antiAlias,
                      child: ExpansionTile(
                        initiallyExpanded: _moreOpen,
                        onExpansionChanged: (v) => _moreOpen = v,
                        shape: const Border(),
                        collapsedShape: const Border(),
                        title: const Text(
                          'More details',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                        subtitle: const Text(
                          'Optional: client, thumbnail, industry, function, category, technology',
                          style: TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                        childrenPadding: const EdgeInsets.fromLTRB(
                          16,
                          0,
                          16,
                          16,
                        ),
                        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _twoUp(
                            compact,
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _label('Client'),
                                TextFormField(
                                  controller: _client,
                                  maxLength: 120,
                                  decoration: const InputDecoration(
                                    hintText: 'Optional',
                                    counterText: '',
                                  ),
                                  validator: (_) => _serverErrors['client'],
                                ),
                              ],
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _label('Thumbnail image URL'),
                                TextFormField(
                                  controller: _thumbnail,
                                  decoration: const InputDecoration(
                                    hintText: 'https://…/image.png',
                                  ),
                                  validator: (v) =>
                                      _urlValidator(v) ??
                                      _serverErrors['thumbnailUrl'],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 12),
                          _twoUp(
                            compact,
                            TagInput(
                              label: 'Industry',
                              values: _industry,
                              suggestions: _categories.values('industry'),
                              onChanged: (v) => setState(() => _industry = v),
                            ),
                            TagInput(
                              label: 'Function',
                              values: _function,
                              suggestions: _categories.values('function'),
                              onChanged: (v) => setState(() => _function = v),
                            ),
                          ),
                          const SizedBox(height: 12),
                          _twoUp(
                            compact,
                            TagInput(
                              label: 'Solution category',
                              values: _category,
                              suggestions: _categories.values('category'),
                              onChanged: (v) => setState(() => _category = v),
                            ),
                            TagInput(
                              label: 'Technology',
                              values: _technologies,
                              suggestions: _categories.values('technology'),
                              onChanged: (v) =>
                                  setState(() => _technologies = v),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: AppColors.line)),
            ),
            child: SafeArea(
              top: false,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 880),
                  child: Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: compact ? 12 : 24,
                      vertical: 10,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: _saving
                              ? null
                              : () => context.go(
                                  widget.isEdit ? _original!.path : '/',
                                ),
                          child: const Text('Cancel'),
                        ),
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: _saving ? null : _save,
                          child: Text(
                            _saving
                                ? 'Saving…'
                                : (widget.isEdit
                                      ? 'Save changes'
                                      : 'Create solution'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _resourcesPanel(bool compact) {
    return Panel(
      title: 'Resources',
      trailing: _resources.length < 20
          ? TextButton.icon(
              onPressed: () => setState(() => _resources.add(_ResourceDraft())),
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add link'),
            )
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_resources.isEmpty)
            const Text(
              'Add repositories, demos, videos, slides, documents or models. Previews are shown where possible.',
              style: TextStyle(color: AppColors.muted, fontSize: 13),
            ),
          for (final (i, r) in _resources.indexed) _resourceRow(i, r, compact),
        ],
      ),
    );
  }

  Widget _resourceRow(int i, _ResourceDraft r, bool compact) {
    final label = TextFormField(
      controller: r.label,
      maxLength: 100,
      decoration: const InputDecoration(
        hintText: 'Label, e.g. Source code',
        counterText: '',
      ),
    );
    final url = TextFormField(
      controller: r.url,
      keyboardType: TextInputType.url,
      decoration: const InputDecoration(hintText: 'https://…'),
      validator: (v) => _urlValidator(v) ?? _serverErrors['resources[$i].url'],
      onChanged: (v) {
        if (!r.typeLocked) {
          setState(() => r.type = detectResourceType(v.trim()));
        }
      },
    );
    final type = DropdownButtonFormField<String>(
      initialValue: r.type,
      key: ValueKey('type-${r.type}'),
      isExpanded: true,
      items: [
        for (final e in resourceTypes.entries)
          DropdownMenuItem(
            value: e.key,
            child: Text(e.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (v) => setState(() {
        r.type = v ?? 'link';
        r.typeLocked = true;
      }),
    );
    final canPreview = previewableTypes.contains(r.type);
    final isPrimary = _primary != null && _primary == r.url.text.trim();
    final actions = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Tooltip(
          message: canPreview
              ? 'Use as the main preview'
              : 'This type cannot be previewed',
          child: IconButton(
            onPressed: canPreview
                ? () => setState(
                    () => _primary = isPrimary ? null : r.url.text.trim(),
                  )
                : null,
            icon: Icon(
              isPrimary ? Icons.star : Icons.star_border,
              color: isPrimary ? AppColors.amber : null,
            ),
          ),
        ),
        IconButton(
          tooltip: 'Remove',
          onPressed: () => setState(() {
            _resources.removeAt(i);
            r.dispose();
          }),
          icon: const Icon(Icons.close),
        ),
      ],
    );

    return Container(
      key: r.key,
      margin: const EdgeInsets.only(bottom: 10),
      padding: compact ? const EdgeInsets.all(10) : EdgeInsets.zero,
      decoration: compact
          ? BoxDecoration(
              border: Border.all(color: AppColors.line),
              borderRadius: BorderRadius.circular(9),
            )
          : null,
      child: compact
          ? Column(
              children: [
                url,
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(child: label),
                    const SizedBox(width: 6),
                    SizedBox(width: 130, child: type),
                  ],
                ),
                Align(alignment: Alignment.centerRight, child: actions),
              ],
            )
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 3, child: label),
                const SizedBox(width: 8),
                Expanded(flex: 5, child: url),
                const SizedBox(width: 8),
                SizedBox(width: 160, child: type),
                actions,
              ],
            ),
    );
  }

  Widget _twoUp(bool compact, Widget a, Widget b) => compact
      ? Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [a, const SizedBox(height: 12), b],
        )
      : Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: a),
            const SizedBox(width: 16),
            Expanded(child: b),
          ],
        );

  Widget _label(String text, {bool required = false, String? hint}) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: text,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          if (required)
            const TextSpan(
              text: ' *',
              style: TextStyle(color: AppColors.danger),
            ),
          if (hint != null)
            TextSpan(
              text: '  $hint',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
        ],
      ),
    ),
  );

  static String _slugPreview(String title) {
    final s = title
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return s.isEmpty ? 'solution' : (s.length > 60 ? s.substring(0, 60) : s);
  }
}
