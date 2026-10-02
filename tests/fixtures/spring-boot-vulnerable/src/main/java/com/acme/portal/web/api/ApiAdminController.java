package com.acme.portal.web.api;

import java.util.List;

import com.acme.portal.domain.Role;
import com.acme.portal.domain.User;
import com.acme.portal.repository.UserRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class ApiAdminController {

    private final UserRepository users;

    public ApiAdminController(UserRepository users) {
        this.users = users;
    }

    public record UserSummary(Long id, String username, String email, Role role, boolean enabled) {
    }

    public record RoleChange(Role role) {
    }

    @GetMapping("/users")
    public List<UserSummary> listUsers() {
        return users.findAll().stream()
            .map(u -> new UserSummary(u.getId(), u.getUsername(), u.getEmail(), u.getRole(), u.isEnabled()))
            .toList();
    }

    @PutMapping("/users/{id}/role")
    public UserSummary changeRole(@PathVariable Long id, @RequestBody RoleChange change) {
        User user = users.findById(id).orElseThrow();
        user.setRole(change.role());
        User saved = users.save(user);
        return new UserSummary(saved.getId(), saved.getUsername(), saved.getEmail(), saved.getRole(), saved.isEnabled());
    }
}
