package com.acme.portal.web.api;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import com.acme.portal.domain.InvoiceStatus;
import com.acme.portal.repository.InvoiceRepository;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/partner")
public class PartnerApiController {

    private final InvoiceRepository invoices;

    public PartnerApiController(InvoiceRepository invoices) {
        this.invoices = invoices;
    }

    public record PartnerInvoice(String number, BigDecimal amount, InvoiceStatus status, LocalDate dueDate,
                                 String customer, String customerEmail) {
    }

    @GetMapping("/invoices")
    public List<PartnerInvoice> invoices(Authentication partner) {
        return invoices.findByPartnerCode(partner.getName()).stream()
            .map(i -> new PartnerInvoice(i.getNumber(), i.getAmount(), i.getStatus(), i.getDueDate(),
                i.getCustomer().getName(), i.getCustomer().getEmail()))
            .toList();
    }
}
