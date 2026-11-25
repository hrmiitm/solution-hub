import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';

class EmbedFrame extends StatefulWidget {
  const EmbedFrame({super.key, required this.url, this.sandbox = true});
  final String url;
  final bool sandbox;

  @override
  State<EmbedFrame> createState() => _EmbedFrameState();
}

class _EmbedFrameState extends State<EmbedFrame> {
  late final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setNavigationDelegate(
      NavigationDelegate(
        // Stay on https content; never follow other schemes.
        onNavigationRequest: (r) => r.url.startsWith('https://')
            ? NavigationDecision.navigate
            : NavigationDecision.prevent,
      ),
    )
    ..loadRequest(Uri.parse(widget.url));

  @override
  Widget build(BuildContext context) {
    // Default gesture handling: taps go to the embed, vertical drags keep
    // scrolling the page. "Open" links offer the full-screen experience.
    return WebViewWidget(controller: _controller);
  }
}
