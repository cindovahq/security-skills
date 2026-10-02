import 'package:shared_preferences/shared_preferences.dart';

class SettingsStore {
  Future<String> themeMode() async =>
      (await SharedPreferences.getInstance()).getString('theme_mode') ?? 'system';

  Future<void> setThemeMode(String mode) async =>
      (await SharedPreferences.getInstance()).setString('theme_mode', mode);

  Future<bool> onboardingDone() async =>
      (await SharedPreferences.getInstance()).getBool('onboarding_done') ?? false;

  Future<void> markOnboardingDone() async =>
      (await SharedPreferences.getInstance()).setBool('onboarding_done', true);
}
