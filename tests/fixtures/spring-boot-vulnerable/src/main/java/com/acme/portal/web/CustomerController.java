package com.acme.portal.web;

import static com.acme.portal.repository.CustomerSpecifications.inRegion;
import static com.acme.portal.repository.CustomerSpecifications.managedBy;
import static com.acme.portal.repository.CustomerSpecifications.nameContains;

import com.acme.portal.repository.CustomerRepository;
import org.springframework.data.domain.Sort;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class CustomerController {

    private final CustomerRepository customers;

    public CustomerController(CustomerRepository customers) {
        this.customers = customers;
    }

    @GetMapping("/customers")
    public String search(@RequestParam(required = false) String q,
                         @RequestParam(required = false) String region,
                         Authentication auth, Model model) {
        model.addAttribute("customers", customers.findAll(
            managedBy(auth.getName()).and(nameContains(q)).and(inRegion(region)),
            Sort.by("name")));
        return "customers/list";
    }
}
