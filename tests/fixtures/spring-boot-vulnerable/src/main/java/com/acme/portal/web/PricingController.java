package com.acme.portal.web;

import java.math.BigDecimal;
import java.util.Map;

import com.acme.portal.service.PricingService;
import com.acme.portal.service.PricingService.QuoteRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PricingController {

    private final PricingService pricing;

    public PricingController(PricingService pricing) {
        this.pricing = pricing;
    }

    @PostMapping("/pricing/quote")
    public Map<String, BigDecimal> quote(@RequestBody QuoteRequest request) {
        return Map.of("total", pricing.quote(request));
    }
}
