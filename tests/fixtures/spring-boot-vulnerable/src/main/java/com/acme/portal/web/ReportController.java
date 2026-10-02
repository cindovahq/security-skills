package com.acme.portal.web;

import java.util.List;
import java.util.Map;

import com.acme.portal.service.ReportService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/reports")
public class ReportController {

    private final ReportService reports;

    public ReportController(ReportService reports) {
        this.reports = reports;
    }

    @GetMapping("/revenue")
    public List<Map<String, Object>> revenue(@RequestParam(defaultValue = "EU") String region) {
        return reports.revenueByRegion(region);
    }

    @GetMapping("/overdue")
    public List<Map<String, Object>> overdue(@RequestParam(defaultValue = "EU") String region) {
        return reports.overdueByRegion(region);
    }
}
