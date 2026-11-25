import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../api/models.dart';
import '../theme.dart';
import '../util/resources.dart';
import 'common.dart';
import 'embed_frame.dart';
import 'markdown_view.dart';

const _maxFetchedBytes = 300 * 1024;

/// Inline preview for a resource, with a clear "open" fallback whenever the
/// host refuses embedding, blocks cross-origin reads, or the request fails.
/// Content is fetched directly by the client; there is no server-side proxy.
class ResourcePreview extends StatelessWidget {
  const ResourcePreview(this.resource, {super.key});
  final Resource resource;

  @override
  Widget build(BuildContext context) {
    final r = resource;
    final embed = embedUrl(r.type, r.url, isWeb: kIsWeb);
    switch (r.type) {
      case 'youtube' || 'slides' || 'pdf' when embed != null:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: AspectRatio(
                aspectRatio: r.type == 'pdf' ? 4 / 3 : 16 / 9,
                child: ColoredBox(
                  color: context.colors.bg,
                  child: EmbedFrame(url: embed, sandbox: r.type != 'pdf'),
                ),
              ),
            ),
            _OpenHint(resource: r),
          ],
        );
      case 'image':
        return ClipRRect(
          borderRadius: BorderRadius.circular(9),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 440),
            child: NetImage(
              r.url,
              fit: BoxFit.contain,
              onError: () => FallbackLink(resource: r),
            ),
          ),
        );
      case 'markdown' || 'text':
        return _FetchedText(resource: r);
    }
    return FallbackLink(resource: r, reason: null);
  }
}

class _OpenHint extends StatelessWidget {
  const _OpenHint({required this.resource});
  final Resource resource;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerRight,
    child: TextButton.icon(
      onPressed: () => openExternal(context, resource.url),
      icon: const Icon(Icons.open_in_new, size: 14),
      label: const Text(
        'Not loading? Open in a new tab',
        style: TextStyle(fontSize: 12),
      ),
    ),
  );
}

class _FetchedText extends StatefulWidget {
  const _FetchedText({required this.resource});
  final Resource resource;

  @override
  State<_FetchedText> createState() => _FetchedTextState();
}

class _FetchedTextState extends State<_FetchedText> {
  late final Future<String> _content = _load();

  Future<String> _load() async {
    final url = rawContentUrl(widget.resource.url);
    final res = await http
        .get(Uri.parse(url))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    final bytes = res.bodyBytes.length > _maxFetchedBytes
        ? res.bodyBytes.sublist(0, _maxFetchedBytes)
        : res.bodyBytes;
    final text = utf8.decode(bytes, allowMalformed: true);
    if (RegExp(r'^\s*<(!doctype|html)', caseSensitive: false).hasMatch(text)) {
      throw Exception('Not a text file');
    }
    return text;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: _content,
      builder: (context, snap) {
        if (snap.hasError) {
          return FallbackLink(
            resource: widget.resource,
            reason: 'This file could not be loaded here (the host may block access).',
          );
        }
        if (!snap.hasData) {
          return const SizedBox(height: 120, child: LoadingView());
        }
        final isMarkdown = widget.resource.type == 'markdown';
        return Container(
          constraints: const BoxConstraints(maxHeight: 460),
          decoration: BoxDecoration(
            border: Border.all(color: context.colors.line),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Scrollbar(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(14),
              child: isMarkdown
                  ? MarkdownView(
                      snap.data!,
                      baseUrl: rawContentUrl(widget.resource.url),
                    )
                  : SelectableText(
                      snap.data!,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12.5,
                        height: 1.5,
                      ),
                    ),
            ),
          ),
        );
      },
    );
  }
}

/// A link card used when a resource cannot (or should not) be embedded.
class FallbackLink extends StatelessWidget {
  const FallbackLink({
    super.key,
    required this.resource,
    this.reason = 'Preview unavailable for this link.',
  });
  final Resource resource;
  final String? reason;

  @override
  Widget build(BuildContext context) {
    final host = Uri.tryParse(resource.url)?.host ?? resource.url;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.colors.bg,
        border: Border.all(color: context.colors.line),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        children: [
          Icon(resourceIcon(resource.type), color: context.colors.accent),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  resource.label,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                Text(
                  reason ?? host,
                  style: TextStyle(fontSize: 12, color: context.colors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: () => openExternal(context, resource.url),
            icon: const Icon(Icons.open_in_new, size: 15),
            label: const Text('Open'),
          ),
        ],
      ),
    );
  }
}
