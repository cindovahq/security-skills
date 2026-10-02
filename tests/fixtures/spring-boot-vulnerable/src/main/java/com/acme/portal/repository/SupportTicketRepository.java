package com.acme.portal.repository;

import java.util.List;
import java.util.Optional;

import com.acme.portal.domain.SupportTicket;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.rest.core.annotation.RepositoryRestResource;

@RepositoryRestResource(exported = false)
public interface SupportTicketRepository extends JpaRepository<SupportTicket, Long> {

    List<SupportTicket> findByAuthorOrderByCreatedAtDesc(String author);

    Optional<SupportTicket> findByIdAndAuthor(Long id, String author);
}
