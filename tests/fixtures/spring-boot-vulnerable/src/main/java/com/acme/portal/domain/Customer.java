package com.acme.portal.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

@Entity
public class Customer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private String email;

    private String region;

    @ManyToOne
    private User accountManager;

    public Long getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getRegion() { return region; }
    public void setRegion(String region) { this.region = region; }
    public User getAccountManager() { return accountManager; }
    public void setAccountManager(User accountManager) { this.accountManager = accountManager; }
}
