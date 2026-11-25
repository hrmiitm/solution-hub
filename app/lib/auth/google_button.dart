// Platform-specific Google sign-in button: Google-rendered on web (required
// by Google Identity Services), a regular button that starts the native
// Credential Manager flow on Android.
export 'google_button_native.dart'
    if (dart.library.js_interop) 'google_button_web.dart';
