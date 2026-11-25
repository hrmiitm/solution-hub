import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Resource types; must match worker/src/lib/resources.ts (the backend is
/// authoritative and re-validates everything).
const resourceTypes = <String, String>{
  'youtube': 'YouTube video',
  'image': 'Image',
  'slides': 'Google Slides',
  'pdf': 'PDF',
  'markdown': 'Markdown',
  'text': 'Text file',
  'repository': 'Repository',
  'model': 'Model / dataset',
  'demo': 'Live demo',
  'documentation': 'Documentation',
  'link': 'Link',
};

const previewableTypes = {
  'youtube',
  'image',
  'slides',
  'pdf',
  'markdown',
  'text',
};

IconData resourceIcon(String type) => switch (type) {
  'youtube' => Icons.play_circle_outline,
  'image' => Icons.image_outlined,
  'slides' => Icons.slideshow_outlined,
  'pdf' => Icons.picture_as_pdf_outlined,
  'markdown' => Icons.article_outlined,
  'text' => Icons.description_outlined,
  'repository' => Icons.code,
  'model' => Icons.hub_outlined,
  'demo' => Icons.rocket_launch_outlined,
  'documentation' => Icons.menu_book_outlined,
  _ => Icons.link,
};

/// Returns a normalized http(s) URL, or null for anything else
/// (javascript:, data:, relative URLs, embedded credentials...).
String? safeHttpUrl(String input) {
  final uri = Uri.tryParse(input.trim());
  if (uri == null ||
      !(uri.isScheme('http') || uri.isScheme('https')) ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty) {
    return null;
  }
  return uri.toString();
}

final _imageExt = RegExp(
  r'\.(png|jpe?g|gif|webp|avif|bmp)$',
  caseSensitive: false,
);
final _textExt = RegExp(
  r'\.(txt|log|csv|tsv|json|ya?ml|toml|ini)$',
  caseSensitive: false,
);
const _imageHosts = {
  'images.unsplash.com',
  'i.imgur.com',
  'upload.wikimedia.org',
  'picsum.photos',
};
const _demoHostSuffixes = [
  '.vercel.app',
  '.netlify.app',
  '.pages.dev',
  '.workers.dev',
  '.streamlit.app',
  '.hf.space',
  '.github.io',
  '.web.app',
];

String detectResourceType(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null) return 'link';
  final host = uri.host.toLowerCase().replaceFirst(RegExp(r'^www\.'), '');
  final path = uri.path.toLowerCase();
  if (youtubeId(url) != null) return 'youtube';
  if (host == 'docs.google.com' && path.startsWith('/presentation/')) {
    return 'slides';
  }
  if (path.endsWith('.pdf') ||
      (host == 'arxiv.org' && path.startsWith('/pdf/'))) {
    return 'pdf';
  }
  if (_imageExt.hasMatch(path) || _imageHosts.contains(host)) return 'image';
  if (RegExp(r'\.(md|markdown)$').hasMatch(path)) return 'markdown';
  if (_textExt.hasMatch(path)) return 'text';
  if (host == 'huggingface.co') {
    return path.startsWith('/spaces/') ? 'demo' : 'model';
  }
  if (const {
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'codeberg.org',
  }.contains(host)) {
    return 'repository';
  }
  if (host.startsWith('docs.') ||
      host.endsWith('.readthedocs.io') ||
      path.startsWith('/docs')) {
    return 'documentation';
  }
  if (_demoHostSuffixes.any(host.endsWith)) return 'demo';
  return 'link';
}

String? youtubeId(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null) return null;
  final host = uri.host.toLowerCase().replaceFirst(RegExp(r'^(www|m)\.'), '');
  String? id;
  if (host == 'youtu.be') {
    id = uri.pathSegments.isNotEmpty ? uri.pathSegments.first : null;
  } else if (host == 'youtube.com' || host == 'youtube-nocookie.com') {
    if (uri.path == '/watch') {
      id = uri.queryParameters['v'];
    } else if (uri.pathSegments.length >= 2 &&
        const {'embed', 'shorts', 'live'}.contains(uri.pathSegments.first)) {
      id = uri.pathSegments[1];
    }
  }
  return id != null && RegExp(r'^[A-Za-z0-9_-]{6,20}$').hasMatch(id)
      ? id
      : null;
}

/// URL to put in an iframe/WebView for embeddable types, else null.
String? embedUrl(String type, String url, {required bool isWeb}) {
  switch (type) {
    case 'youtube':
      final id = youtubeId(url);
      return id == null ? null : 'https://www.youtube-nocookie.com/embed/$id';
    case 'slides':
      final m = RegExp(r'/presentation/d/([A-Za-z0-9_-]+)').firstMatch(url);
      return m == null
          ? null
          : 'https://docs.google.com/presentation/d/${m.group(1)}/embed?start=false&loop=false';
    case 'pdf':
      // Browsers render PDFs natively; Android WebView cannot, so use Google's viewer there.
      return isWeb
          ? url
          : 'https://docs.google.com/viewer?embedded=true&url=${Uri.encodeComponent(url)}';
  }
  return null;
}

/// GitHub "blob" pages are HTML; their raw file is what we can render.
String rawContentUrl(String url) {
  final m = RegExp(r'^https://github\.com/([^/]+)/([^/]+)/blob/(.+)$')
      .firstMatch(url);
  return m == null
      ? url
      : 'https://raw.githubusercontent.com/${m.group(1)}/${m.group(2)}/${m.group(3)}';
}

/// Opens an external link in a new tab/browser. Only http(s) and mailto are allowed.
Future<void> openExternal(BuildContext context, String url) async {
  final uri = Uri.tryParse(url);
  final ok =
      uri != null &&
      (uri.isScheme('http') || uri.isScheme('https') || uri.isScheme('mailto'));
  if (!ok ||
      !await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
        webOnlyWindowName: '_blank',
      )) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This link could not be opened.')),
      );
    }
  }
}
