package com.acme.portal.service;

import java.math.BigDecimal;
import java.math.RoundingMode;

import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import org.springframework.stereotype.Service;

@Service
public class PricingService {

    private final ExpressionParser parser = new SpelExpressionParser();
    private final DiscountPolicy discountPolicy;

    public PricingService(DiscountPolicy discountPolicy) {
        this.discountPolicy = discountPolicy;
    }

    public record QuoteRequest(String sku, int quantity, BigDecimal unitPrice, String formula) {
    }

    public BigDecimal quote(QuoteRequest request) {
        BigDecimal base;
        if (request.formula() != null && !request.formula().isBlank()) {
            Expression expression = parser.parseExpression(request.formula());
            StandardEvaluationContext context = new StandardEvaluationContext(request);
            base = expression.getValue(context, BigDecimal.class);
        } else {
            base = request.unitPrice().multiply(BigDecimal.valueOf(request.quantity()));
        }
        BigDecimal discount = discountPolicy.discountFor(request.quantity(), request.unitPrice());
        return base.subtract(base.multiply(discount)).setScale(2, RoundingMode.HALF_UP);
    }
}
