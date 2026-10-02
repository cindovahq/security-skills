package com.acme.portal.web;

import java.util.Locale;

import com.acme.portal.domain.User;
import com.acme.portal.repository.UserRepository;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
@RequestMapping("/account")
public class AccountController {

    private final UserRepository users;

    public AccountController(UserRepository users) {
        this.users = users;
    }

    public record ProfileView(String username, String email, String displayName, String apiKey) {
    }

    @GetMapping("/profile")
    public String profile(Authentication auth, Model model) {
        model.addAttribute("user", users.findByUsername(auth.getName()).orElseThrow());
        return "account/profile";
    }

    @GetMapping("/profile.json")
    @ResponseBody
    public ProfileView profileJson(Authentication auth) {
        User user = users.findByUsername(auth.getName()).orElseThrow();
        return new ProfileView(user.getUsername(), user.getEmail(), user.getDisplayName(), user.getApiKey());
    }

    @PostMapping("/profile")
    public String updateProfile(@ModelAttribute("user") User form, Authentication auth) {
        User current = users.findByUsername(auth.getName()).orElseThrow();
        form.setId(current.getId());
        form.setUsername(current.getUsername());
        form.setPasswordHash(current.getPasswordHash());
        form.setApiKey(current.getApiKey());
        users.save(form);
        return "redirect:/account/profile";
    }

    @PostMapping("/preferences")
    public String updatePreferences(@RequestParam String layout, Authentication auth) {
        User current = users.findByUsername(auth.getName()).orElseThrow();
        current.setDashboardLayout(layout);
        users.save(current);
        return "redirect:/dashboard";
    }

    @GetMapping("/locale")
    public String changeLocale(@RequestParam String lang,
                               @RequestParam(defaultValue = "/dashboard") String returnUrl,
                               HttpServletResponse response) {
        Cookie cookie = new Cookie("portal_lang", Locale.forLanguageTag(lang).toLanguageTag());
        cookie.setPath("/");
        cookie.setHttpOnly(true);
        response.addCookie(cookie);
        return "redirect:" + returnUrl;
    }
}
