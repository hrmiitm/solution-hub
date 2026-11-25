/// Deterministic keyword suggestions from a title and Markdown description.
///
/// Term frequency over meaningful words (stopwords, URLs, code and Markdown
/// syntax removed), with title words weighted higher and repeated two-word
/// phrases preferred over their parts. Values that already exist elsewhere in
/// SolutionHub (`vocabulary`) get a boost so naming stays consistent.
List<String> suggestKeywords({
  required String title,
  required String description,
  Iterable<String> exclude = const [],
  Iterable<String> vocabulary = const [],
  int max = 8,
}) {
  final excluded = exclude.map((e) => e.toLowerCase()).toSet();
  // Words already covered by a chosen phrase ("computer vision" covers "computer").
  final excludedWords = excluded.expand((e) => e.split(' ')).toSet();
  final scores = <String, double>{};

  void addText(String text, double weight) {
    for (final sentence in _clean(
      text,
    ).split(RegExp(r'[.!?;:\n()\[\]{}|,]+'))) {
      final words = _tokens(sentence);
      for (var i = 0; i < words.length; i++) {
        final w = words[i];
        if (w != null) scores[w] = (scores[w] ?? 0) + weight;
        if (i + 1 < words.length && w != null && words[i + 1] != null) {
          final phrase = '$w ${words[i + 1]}';
          scores[phrase] = (scores[phrase] ?? 0) + weight * 1.2;
        }
      }
    }
  }

  addText(title, 3);
  addText(description, 1);

  final lowerText = '${_clean(title)} ${_clean(description)}'.toLowerCase();
  for (final v in vocabulary) {
    final term = v.toLowerCase().trim();
    if (term.length >= 2 &&
        RegExp('\\b${RegExp.escape(term)}\\b').hasMatch(lowerText)) {
      scores[term] = (scores[term] ?? 0) + 3;
    }
  }

  // Phrases must recur (or come from the title/vocabulary) to be useful.
  scores.removeWhere((k, v) => k.contains(' ') && v < 2.4);

  final ranked = scores.entries.toList()
    ..sort((a, b) {
      final byScore = b.value.compareTo(a.value);
      return byScore != 0 ? byScore : a.key.compareTo(b.key);
    });

  final picked = <String>[];
  for (final e in ranked) {
    final k = e.key;
    if (excluded.contains(k) || excludedWords.contains(k) || k.length > 40) {
      continue;
    }
    // Skip a word already covered by a chosen phrase, and vice versa.
    if (picked.any(
      (p) => p.split(' ').contains(k) || k.split(' ').contains(p),
    )) {
      continue;
    }
    // Skip near-duplicates such as "detects" next to "detection".
    if (!k.contains(' ') &&
        [...picked, ...excluded].any((p) => _stem(p) == _stem(k))) {
      continue;
    }
    picked.add(k);
    if (picked.length >= max) break;
  }
  return picked;
}

/// Crude stem for near-duplicate detection only (not shown to users).
String _stem(String w) => w.length > 5 ? w.substring(0, 5) : w;

String _clean(String text) => text
    .replaceAll(RegExp(r'```[\s\S]*?```'), ' ')
    .replaceAll(RegExp(r'`[^`]*`'), ' ')
    .replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), ' ')
    .replaceAll(RegExp(r'\[([^\]]*)\]\([^)]*\)'), r'$1')
    .replaceAll(RegExp(r'https?://\S+'), ' ')
    .replaceAll(RegExp(r'<[^>]*>'), ' ')
    .replaceAll(RegExp(r'[#*_>~]'), ' ');

/// Lowercased tokens; stopwords and noise become null to break phrases.
List<String?> _tokens(String sentence) => sentence
    .toLowerCase()
    .split(RegExp(r'[^a-z0-9+#\-]+'))
    .where((w) => w.isNotEmpty)
    .map((w) => w.replaceAll(RegExp(r'^-+|-+$'), ''))
    .map(
      (w) =>
          (w.length < 3 && !_shortTerms.contains(w)) ||
              _stopwords.contains(w) ||
              RegExp(r'^[\d\-]+$').hasMatch(w)
          ? null
          : w,
    )
    .toList();

const _shortTerms = {
  'ai',
  'ml',
  'ui',
  'ux',
  'ar',
  'vr',
  'c#',
  'go',
  'r',
  'cv',
  'bi',
  'qa',
  'nlp',
  'llm',
  'ocr',
  'api',
};

const _stopwords = {
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'are',
  'was',
  'were',
  'will',
  'would',
  'can',
  'could',
  'should',
  'has',
  'have',
  'had',
  'not',
  'but',
  'you',
  'your',
  'our',
  'ours',
  'their',
  'them',
  'they',
  'its',
  'into',
  'onto',
  'over',
  'under',
  'than',
  'then',
  'there',
  'here',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'why',
  'how',
  'all',
  'any',
  'each',
  'every',
  'more',
  'most',
  'other',
  'some',
  'such',
  'only',
  'own',
  'same',
  'too',
  'very',
  'just',
  'also',
  'about',
  'above',
  'after',
  'again',
  'against',
  'before',
  'being',
  'below',
  'between',
  'both',
  'during',
  'few',
  'further',
  'off',
  'once',
  'out',
  'per',
  'via',
  'while',
  'use',
  'used',
  'uses',
  'using',
  'based',
  'new',
  'one',
  'two',
  'three',
  'get',
  'gets',
  'make',
  'makes',
  'made',
  'like',
  'well',
  'way',
  'may',
  'might',
  'must',
  'shall',
  'does',
  'did',
  'done',
  'doing',
  'been',
  'because',
  'these',
  'those',
  'his',
  'her',
  'she',
  'him',
  'yes',
  'etc',
  'http',
  'https',
  'www',
  'com',
  'html',
  'across',
  'within',
  'without',
  'through',
  'up',
  'down',
  'let',
  'lets',
  'allow',
  'allows',
  'enable',
  'enables',
  'provide',
  'provides',
  'support',
  'supports',
  'help',
  'helps',
  'able',
  'first',
  'next',
  'last',
  'now',
  'currently',
  'project',
  'solution',
  'solutions',
  'overview',
  'status',
  'details',
  'description',
  'features',
  'feature',
  'work',
  'works',
  'working',
  'need',
  'needs',
  'including',
  'include',
  'includes',
  'many',
  'much',
  'lot',
  'lots',
  'even',
  'still',
  'yet',
};
