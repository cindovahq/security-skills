#!/usr/bin/env bash
# Release build for both stores. Run from the repository root.
set -euo pipefail

flutter pub get

flutter build appbundle --release \
  --obfuscate --split-debug-info=build/symbols/android \
  --dart-define-from-file=config/prod.json

flutter build ipa --release \
  --obfuscate --split-debug-info=build/symbols/ios \
  --dart-define-from-file=config/prod.json
