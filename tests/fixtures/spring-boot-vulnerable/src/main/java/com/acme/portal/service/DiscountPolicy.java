package com.acme.portal.service;

import java.math.BigDecimal;
import java.util.List;

import com.acme.portal.config.DiscountProperties;
import org.springframework.expression.EvaluationContext;
import org.springframework.expression.Expression;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;
import org.springframework.stereotype.Component;

@Component
public class DiscountPolicy {

    private final List<Expression> rules;
    private final EvaluationContext context = SimpleEvaluationContext.forReadOnlyDataBinding().build();

    public DiscountPolicy(DiscountProperties properties) {
        SpelExpressionParser parser = new SpelExpressionParser();
        this.rules = properties.rules().stream().map(parser::parseExpression).toList();
    }

    public record OrderLine(int quantity, BigDecimal unitPrice) {
    }

    public BigDecimal discountFor(int quantity, BigDecimal unitPrice) {
        OrderLine line = new OrderLine(quantity, unitPrice);
        return rules.stream()
            .map(rule -> rule.getValue(context, line, BigDecimal.class))
            .reduce(BigDecimal.ZERO, BigDecimal::max);
    }
}
