import 'package:flutter/material.dart';
import 'package:google_sign_in_web/web_only.dart' as gsi;

Widget googleSignInButton({
  required VoidCallback onPressed,
  required bool busy,
}) {
  return Builder(
    builder: (context) => SizedBox(
      height: 44,
      child: gsi.renderButton(
        configuration: gsi.GSIButtonConfiguration(
          type: gsi.GSIButtonType.standard,
          theme: Theme.of(context).brightness == Brightness.dark
              ? gsi.GSIButtonTheme.filledBlack
              : gsi.GSIButtonTheme.outline,
          size: gsi.GSIButtonSize.large,
          text: gsi.GSIButtonText.continueWith,
          shape: gsi.GSIButtonShape.rectangular,
          minimumWidth: 260,
        ),
      ),
    ),
  );
}
