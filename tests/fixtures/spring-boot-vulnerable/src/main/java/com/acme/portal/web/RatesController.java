package com.acme.portal.web;

import com.acme.portal.service.ExchangeRateClient;
import com.acme.portal.service.ExchangeRateClient.Rate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RatesController {

    private final ExchangeRateClient rates;

    public RatesController(ExchangeRateClient rates) {
        this.rates = rates;
    }

    @GetMapping("/rates/{currency}")
    public Rate rate(@PathVariable String currency) {
        return rates.latest(currency);
    }
}
