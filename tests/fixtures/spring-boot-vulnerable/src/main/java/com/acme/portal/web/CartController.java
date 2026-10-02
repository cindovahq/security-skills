package com.acme.portal.web;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.util.Base64;

import com.acme.portal.domain.Cart;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class CartController {

    private static final String COOKIE = "portal_cart";

    @GetMapping("/cart")
    public String view(@CookieValue(name = COOKIE, required = false) String cookie, Model model) throws Exception {
        model.addAttribute("cart", readCart(cookie));
        return "cart";
    }

    @PostMapping("/cart/items")
    public String add(@CookieValue(name = COOKIE, required = false) String cookie,
                      @RequestParam String sku, @RequestParam int quantity,
                      HttpServletResponse response) throws Exception {
        Cart cart = readCart(cookie);
        cart.add(sku, quantity);
        Cookie updated = new Cookie(COOKIE, writeCart(cart));
        updated.setPath("/");
        updated.setHttpOnly(true);
        response.addCookie(updated);
        return "redirect:/cart";
    }

    private Cart readCart(String cookie) throws IOException, ClassNotFoundException {
        if (cookie == null || cookie.isBlank()) {
            return new Cart();
        }
        byte[] bytes = Base64.getUrlDecoder().decode(cookie);
        try (ObjectInputStream in = new ObjectInputStream(new ByteArrayInputStream(bytes))) {
            return (Cart) in.readObject();
        }
    }

    private String writeCart(Cart cart) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ObjectOutputStream out = new ObjectOutputStream(bytes)) {
            out.writeObject(cart);
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.toByteArray());
    }
}
