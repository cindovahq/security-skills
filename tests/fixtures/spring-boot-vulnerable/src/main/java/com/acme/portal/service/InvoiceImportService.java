package com.acme.portal.service;

import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

import com.acme.portal.domain.Invoice;
import com.acme.portal.domain.User;
import com.acme.portal.repository.InvoiceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

@Service
public class InvoiceImportService {

    private final InvoiceRepository invoices;

    public InvoiceImportService(InvoiceRepository invoices) {
        this.invoices = invoices;
    }

    @Transactional
    public List<Invoice> importXml(InputStream xml, User owner) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        DocumentBuilder builder = factory.newDocumentBuilder();
        Document document = builder.parse(xml);

        List<Invoice> imported = new ArrayList<>();
        NodeList nodes = document.getElementsByTagName("invoice");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element element = (Element) nodes.item(i);
            Invoice invoice = new Invoice();
            invoice.setNumber(text(element, "number"));
            invoice.setAmount(new BigDecimal(text(element, "amount")));
            invoice.setDueDate(LocalDate.parse(text(element, "dueDate")));
            invoice.setOwner(owner);
            imported.add(invoices.save(invoice));
        }
        return imported;
    }

    private static String text(Element parent, String tag) {
        return parent.getElementsByTagName(tag).item(0).getTextContent().trim();
    }
}
