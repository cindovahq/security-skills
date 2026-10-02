package com.acme.portal.repository;

import com.acme.portal.domain.Customer;
import org.springframework.data.jpa.domain.Specification;

public final class CustomerSpecifications {

    private CustomerSpecifications() {
    }

    public static Specification<Customer> nameContains(String q) {
        return (root, query, cb) -> q == null || q.isBlank()
            ? cb.conjunction()
            : cb.like(cb.lower(root.get("name")), "%" + q.toLowerCase() + "%");
    }

    public static Specification<Customer> inRegion(String region) {
        return (root, query, cb) -> region == null || region.isBlank()
            ? cb.conjunction()
            : cb.equal(root.get("region"), region);
    }

    public static Specification<Customer> managedBy(String username) {
        return (root, query, cb) -> cb.equal(root.get("accountManager").get("username"), username);
    }
}
