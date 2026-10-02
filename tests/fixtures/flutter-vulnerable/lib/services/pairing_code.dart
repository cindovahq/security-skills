import 'dart:math';

/// Six-digit code the driver reads out to the customer at hand-over.
String newHandoverCode() {
  final n = Random().nextInt(900000) + 100000;
  return n.toString();
}
