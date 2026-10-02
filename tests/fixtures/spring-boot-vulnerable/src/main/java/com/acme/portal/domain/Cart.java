package com.acme.portal.domain;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

public class Cart implements Serializable {

    private static final long serialVersionUID = 1L;

    private final List<CartItem> items = new ArrayList<>();

    public List<CartItem> getItems() {
        return items;
    }

    public void add(String sku, int quantity) {
        items.add(new CartItem(sku, quantity));
    }

    public record CartItem(String sku, int quantity) implements Serializable {
    }
}
