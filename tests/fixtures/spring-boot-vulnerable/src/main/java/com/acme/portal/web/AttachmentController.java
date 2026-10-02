package com.acme.portal.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import com.acme.portal.repository.SupportTicketRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Controller
public class AttachmentController {

    private final SupportTicketRepository tickets;
    private final String uploadDir;

    public AttachmentController(SupportTicketRepository tickets, @Value("${portal.uploads.dir}") String uploadDir) {
        this.tickets = tickets;
        this.uploadDir = uploadDir;
    }

    @PostMapping("/support/tickets/{id}/attachments")
    public String upload(@PathVariable Long id, @RequestParam("file") MultipartFile file, Authentication auth)
            throws IOException {
        tickets.findByIdAndAuthor(id, auth.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        Path target = Paths.get(uploadDir, String.valueOf(id), file.getOriginalFilename());
        Files.createDirectories(target.getParent());
        file.transferTo(target);
        return "redirect:/support/tickets/" + id;
    }

    @GetMapping("/support/attachments")
    public ResponseEntity<Resource> download(@RequestParam Long ticketId, @RequestParam String name,
                                             Authentication auth) {
        tickets.findByIdAndAuthor(ticketId, auth.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        Path path = Paths.get(uploadDir, String.valueOf(ticketId)).resolve(name);
        if (!Files.exists(path)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment")
            .body(new FileSystemResource(path));
    }
}
