package com.acme.portal.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("portal.discounts")
public record DiscountProperties(List<String> rules) {
}
