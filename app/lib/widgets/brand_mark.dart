import 'package:flutter/material.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, required this.size});

  final double size;

  @override
  Widget build(BuildContext context) => Image.asset(
    'web/icons/Icon-192.png',
    width: size,
    height: size,
    excludeFromSemantics: true,
  );
}
