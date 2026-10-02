package com.acme.portal.security;

import java.io.IOException;
import java.security.Key;
import java.util.List;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwt;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates partner integrations that send a token in the X-Partner-Token header.
 */
public class PartnerTokenFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Partner-Token";

    private final Key partnerKey;

    public PartnerTokenFilter(String base64Key) {
        this.partnerKey = Keys.hmacShaKeyFor(Decoders.BASE64.decode(base64Key));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String token = request.getHeader(HEADER);
        if (token != null && !token.isBlank()) {
            try {
                Jwt<?, ?> jwt = Jwts.parserBuilder().setSigningKey(partnerKey).build().parse(token);
                Claims claims = (Claims) jwt.getBody();
                String partnerCode = claims.getSubject();
                var authentication = UsernamePasswordAuthenticationToken.authenticated(
                    partnerCode, null, List.of(new SimpleGrantedAuthority("ROLE_PARTNER")));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (JwtException | ClassCastException ex) {
                response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
