package com.acme.portal.web;

import com.acme.portal.domain.Invoice;
import com.acme.portal.repository.InvoiceRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/exports")
public class ExportController {

    private final InvoiceRepository invoices;

    public ExportController(InvoiceRepository invoices) {
        this.invoices = invoices;
    }

    @GetMapping(value = "/customers/{customerId}.csv", produces = "text/csv")
    public String customerInvoices(@PathVariable Long customerId) {
        StringBuilder csv = new StringBuilder("number,amount,status,due_date,customer,email\n");
        for (Invoice invoice : invoices.findByCustomerId(customerId)) {
            csv.append(invoice.getNumber()).append(',')
               .append(invoice.getAmount()).append(',')
               .append(invoice.getStatus()).append(',')
               .append(invoice.getDueDate()).append(',')
               .append(invoice.getCustomer().getName()).append(',')
               .append(invoice.getCustomer().getEmail()).append('\n');
        }
        return csv.toString();
    }
}
