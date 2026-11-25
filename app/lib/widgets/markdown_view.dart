import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../theme.dart';
import '../util/resources.dart';
import 'common.dart';

/// Renders Markdown as native Flutter widgets. No HTML is ever interpreted
/// (raw HTML in the source is not executed), links open externally only if
/// they are http(s)/mailto, and images load only from http(s) URLs. This is
/// what makes user-supplied Markdown XSS-safe.
class MarkdownView extends StatelessWidget {
  const MarkdownView(this.data, {super.key, this.baseUrl});
  final String data;

  /// For Markdown fetched from a URL: resolves relative links/images.
  final String? baseUrl;

  String? _resolve(String? href) {
    if (href == null) return null;
    final base = baseUrl == null ? null : Uri.tryParse(baseUrl!);
    final uri = base != null ? base.resolve(href) : Uri.tryParse(href);
    if (uri == null) return null;
    if (uri.isScheme('mailto')) return uri.toString();
    return safeHttpUrl(uri.toString());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final body = theme.textTheme.bodyMedium!.copyWith(
      fontSize: 14,
      height: 1.65,
      color: context.colors.ink,
    );
    return MarkdownBody(
      data: data,
      selectable: true,
      onTapLink: (text, href, title) {
        final url = _resolve(href);
        if (url != null) openExternal(context, url);
      },
      imageBuilder: (uri, title, alt) {
        final url = _resolve(uri.toString());
        if (url == null) {
          return Text(alt ?? '', style: TextStyle(color: context.colors.muted));
        }
        return ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 340),
          child: NetImage(
            url,
            fit: BoxFit.contain,
            onError: () =>
                Text(alt ?? '', style: TextStyle(color: context.colors.muted)),
          ),
        );
      },
      styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
        p: body,
        listBullet: body,
        tableBody: body.copyWith(fontSize: 13),
        tableHead: body.copyWith(fontSize: 13, fontWeight: FontWeight.w700),
        tableBorder: TableBorder.all(color: context.colors.line),
        tableCellsPadding: const EdgeInsets.all(7),
        h1: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          height: 1.4,
        ),
        h2: const TextStyle(
          fontSize: 19,
          fontWeight: FontWeight.w700,
          height: 1.4,
        ),
        h3: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          height: 1.4,
        ),
        a: TextStyle(
          color: context.colors.accent,
          decoration: TextDecoration.underline,
        ),
        code: TextStyle(
          fontFamily: 'monospace',
          fontSize: 13,
          backgroundColor: context.colors.tagBg,
          color: context.colors.ink,
        ),
        codeblockDecoration: BoxDecoration(
          color: context.colors.tagBg,
          borderRadius: BorderRadius.circular(8),
        ),
        codeblockPadding: const EdgeInsets.all(12),
        blockquoteDecoration: BoxDecoration(
          border: Border(
            left: BorderSide(color: context.colors.line, width: 3),
          ),
        ),
        blockquotePadding: const EdgeInsets.only(left: 12, top: 2, bottom: 2),
        blockSpacing: 10,
      ),
    );
  }
}
