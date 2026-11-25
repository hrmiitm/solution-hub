import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

class EmbedFrame extends StatelessWidget {
  const EmbedFrame({super.key, required this.url, this.sandbox = true});
  final String url;

  /// PDFs must not be sandboxed: browsers refuse to run their PDF viewer in
  /// sandboxed frames. Other embeds get a sandbox limited to what players need.
  final bool sandbox;

  @override
  Widget build(BuildContext context) {
    return HtmlElementView.fromTagName(
      key: ValueKey(url),
      tagName: 'iframe',
      onElementCreated: (element) {
        final frame = element as web.HTMLIFrameElement
          ..src = url
          ..allow = 'encrypted-media; picture-in-picture; fullscreen'
          ..allowFullscreen = true
          ..referrerPolicy = 'strict-origin-when-cross-origin'
          ..loading = 'lazy';
        frame.style
          ..border = '0'
          ..width = '100%'
          ..height = '100%';
        if (sandbox) {
          frame.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-presentation allow-popups',
          );
        }
      },
    );
  }
}
