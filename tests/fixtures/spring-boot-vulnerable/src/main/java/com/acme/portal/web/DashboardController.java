package com.acme.portal.web;

import com.acme.portal.domain.User;
import com.acme.portal.repository.InvoiceRepository;
import com.acme.portal.repository.UserRepository;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class DashboardController {

    private final UserRepository users;
    private final InvoiceRepository invoices;

    public DashboardController(UserRepository users, InvoiceRepository invoices) {
        this.users = users;
        this.invoices = invoices;
    }

    @GetMapping({"/", "/dashboard"})
    public String dashboard(Authentication auth, Model model) {
        if (auth == null) {
            return "redirect:/login";
        }
        User user = users.findByUsername(auth.getName()).orElseThrow();
        model.addAttribute("user", user);
        model.addAttribute("invoices", invoices.findByOwnerUsername(user.getUsername()));
        String layout = user.getDashboardLayout() == null ? "default" : user.getDashboardLayout();
        return "dashboard/" + layout;
    }
}
