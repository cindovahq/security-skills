package com.acme.portal.web;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@RestController
public class WebhookController {

    private final RestClient restClient;

    public WebhookController(RestClient.Builder builder) {
        this.restClient = builder.build();
    }

    @PostMapping("/integrations/webhooks/test")
    public ResponseEntity<Map<String, Object>> test(@RequestParam String url) {
        try {
            ResponseEntity<String> reply = restClient.get().uri(url).retrieve().toEntity(String.class);
            return ResponseEntity.ok(Map.of(
                "status", reply.getStatusCode().value(),
                "body", reply.getBody() == null ? "" : reply.getBody()));
        } catch (RestClientException ex) {
            return ResponseEntity.ok(Map.of("status", 0, "error", ex.getMessage()));
        }
    }
}
