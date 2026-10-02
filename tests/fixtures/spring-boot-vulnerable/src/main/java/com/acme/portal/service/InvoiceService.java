package com.acme.portal.service;

import java.util.List;

import com.acme.portal.domain.Invoice;
import com.acme.portal.domain.InvoiceStatus;
import com.acme.portal.repository.InvoiceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvoiceService {

    private static final Logger log = LoggerFactory.getLogger(InvoiceService.class);

    private final InvoiceRepository invoices;

    public InvoiceService(InvoiceRepository invoices) {
        this.invoices = invoices;
    }

    @Transactional
    public int refundAll(List<Long> invoiceIds) {
        int refunded = 0;
        for (Long id : invoiceIds) {
            refund(id);
            refunded++;
        }
        return refunded;
    }

    @PreAuthorize("hasRole('FINANCE')")
    @Transactional
    public void refund(Long invoiceId) {
        Invoice invoice = invoices.findById(invoiceId).orElseThrow();
        if (invoice.getStatus() != InvoiceStatus.PAID) {
            throw new IllegalStateException("Only paid invoices can be refunded");
        }
        invoice.setStatus(InvoiceStatus.REFUNDED);
        log.info("Refund issued for invoice {} ({})", invoice.getNumber(), invoice.getAmount());
    }
}
