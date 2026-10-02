package com.acme.portal.web;

import com.acme.portal.domain.Role;
import com.acme.portal.domain.User;
import com.acme.portal.repository.UserRepository;
import org.springframework.security.access.annotation.Secured;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
@RequestMapping("/admin")
@Secured("ROLE_ADMIN")
public class AdminController {

    private final UserRepository users;

    public AdminController(UserRepository users) {
        this.users = users;
    }

    @GetMapping("/users")
    public String users(Model model) {
        model.addAttribute("users", users.findAll());
        return "admin/users";
    }

    @PostMapping("/users/{id}/role")
    public String changeRole(@PathVariable Long id, @RequestParam Role role) {
        User user = users.findById(id).orElseThrow();
        user.setRole(role);
        users.save(user);
        return "redirect:/admin/users";
    }

    @PostMapping("/users/{id}/disable")
    public String disable(@PathVariable Long id) {
        User user = users.findById(id).orElseThrow();
        user.setEnabled(false);
        users.save(user);
        return "redirect:/admin/users";
    }
}
