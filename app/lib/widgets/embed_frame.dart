// Embeds an external page (YouTube, Google Slides, PDF): an <iframe> on web,
// a WebView on Android.
export 'embed_frame_native.dart'
    if (dart.library.js_interop) 'embed_frame_web.dart';
