package com.acme.portal.web.api;

import java.math.BigDecimal;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CatalogApiController {

    public record Product(String sku, String name, BigDecimal listPrice) {
    }

    private static final List<Product> CATALOG = List.of(
        new Product("ACME-100", "Standard plan (monthly)", new BigDecimal("49.00")),
        new Product("ACME-200", "Business plan (monthly)", new BigDecimal("149.00")),
        new Product("ACME-300", "Enterprise plan (monthly)", new BigDecimal("499.00")));

    @GetMapping("/api/public/catalog")
    public List<Product> catalog() {
        return CATALOG;
    }
}
