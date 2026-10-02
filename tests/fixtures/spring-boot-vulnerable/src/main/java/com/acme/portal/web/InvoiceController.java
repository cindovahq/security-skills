package com.acme.portal.web;

import java.util.List;

import com.acme.portal.domain.Invoice;
import com.acme.portal.domain.InvoiceStatus;
import com.acme.portal.domain.User;
import com.acme.portal.repository.InvoiceRepository;
import com.acme.portal.repository.UserRepository;
import com.acme.portal.service.InvoiceImportService;
import com.acme.portal.service.InvoiceService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Controller
@RequestMapping("/invoices")
public class InvoiceController {

    private final InvoiceRepository invoices;
    private final UserRepository users;
    private final InvoiceService invoiceService;
    private final InvoiceImportService importService;
    private final InvoicePdfRenderer pdfRenderer;

    public InvoiceController(InvoiceRepository invoices, UserRepository users, InvoiceService invoiceService,
                             InvoiceImportService importService, InvoicePdfRenderer pdfRenderer) {
        this.invoices = invoices;
        this.users = users;
        this.invoiceService = invoiceService;
        this.importService = importService;
        this.pdfRenderer = pdfRenderer;
    }

    @GetMapping
    public String list(Authentication auth, Model model) {
        model.addAttribute("invoices", invoices.findByOwnerUsername(auth.getName()));
        return "invoices/list";
    }

    @GetMapping("/search")
    public String byStatus(@RequestParam InvoiceStatus status, Authentication auth, Model model) {
        model.addAttribute("invoices", invoices.findByStatusForUser(status, auth.getName()));
        return "invoices/list";
    }

    @GetMapping("/{id}")
    public String show(@PathVariable Long id, Model model) {
        Invoice invoice = invoices.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        model.addAttribute("invoice", invoice);
        return "invoices/show";
    }

    @GetMapping(value = "/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> pdf(@PathVariable Long id, Authentication auth) {
        Invoice invoice = invoices.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!invoice.getOwner().getUsername().equals(auth.getName())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return ResponseEntity.ok(pdfRenderer.render(invoice));
    }

    @PostMapping("/refunds")
    public String refund(@RequestParam List<Long> ids) {
        invoiceService.refundAll(ids);
        return "redirect:/invoices";
    }

    @PostMapping("/import")
    public String importInvoices(@RequestParam("file") MultipartFile file, Authentication auth) throws Exception {
        User owner = users.findByUsername(auth.getName()).orElseThrow();
        importService.importXml(file.getInputStream(), owner);
        return "redirect:/invoices";
    }
}
