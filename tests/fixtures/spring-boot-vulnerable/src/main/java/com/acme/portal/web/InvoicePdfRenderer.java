package com.acme.portal.web;

import java.nio.charset.StandardCharsets;

import com.acme.portal.domain.Invoice;
import org.springframework.stereotype.Component;

@Component
public class InvoicePdfRenderer {

    public byte[] render(Invoice invoice) {
        String body = "Invoice " + invoice.getNumber() + "\nAmount: " + invoice.getAmount()
            + "\nDue: " + invoice.getDueDate();
        return body.getBytes(StandardCharsets.UTF_8);
    }
}
