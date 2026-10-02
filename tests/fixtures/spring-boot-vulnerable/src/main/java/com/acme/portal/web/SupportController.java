package com.acme.portal.web;

import com.acme.portal.domain.SupportTicket;
import com.acme.portal.repository.SupportTicketRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.server.ResponseStatusException;

@Controller
@RequestMapping("/support")
public class SupportController {

    private final SupportTicketRepository tickets;

    public SupportController(SupportTicketRepository tickets) {
        this.tickets = tickets;
    }

    @InitBinder("ticket")
    void initTicketBinder(WebDataBinder binder) {
        binder.setAllowedFields("subject", "body");
    }

    @GetMapping("/tickets")
    public String myTickets(Authentication auth, Model model) {
        model.addAttribute("tickets", tickets.findByAuthorOrderByCreatedAtDesc(auth.getName()));
        return "support/list";
    }

    @PostMapping("/tickets")
    public String create(@ModelAttribute("ticket") SupportTicket ticket, Authentication auth) {
        ticket.setAuthor(auth.getName());
        ticket.setStatus("OPEN");
        SupportTicket saved = tickets.save(ticket);
        return "redirect:/support/tickets/" + saved.getId();
    }

    @GetMapping("/tickets/{id}")
    public String show(@PathVariable Long id, Authentication auth, Model model) {
        boolean staff = auth.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals("ROLE_SUPPORT") || a.getAuthority().equals("ROLE_ADMIN"));
        SupportTicket ticket = (staff ? tickets.findById(id) : tickets.findByIdAndAuthor(id, auth.getName()))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        model.addAttribute("ticket", ticket);
        model.addAttribute("staff", staff);
        return "support/ticket";
    }
}
