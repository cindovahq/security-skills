package com.acme.portal.repository;

import java.util.List;

import com.acme.portal.domain.Invoice;
import com.acme.portal.domain.InvoiceStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InvoiceRepository extends JpaRepository<Invoice, Long> {

    List<Invoice> findByOwnerUsername(String username);

    List<Invoice> findByCustomerId(Long customerId);

    List<Invoice> findByPartnerCode(String partnerCode);

    @Query("select i from Invoice i where i.status = :status and i.owner.username = :username order by i.dueDate")
    List<Invoice> findByStatusForUser(@Param("status") InvoiceStatus status, @Param("username") String username);
}
