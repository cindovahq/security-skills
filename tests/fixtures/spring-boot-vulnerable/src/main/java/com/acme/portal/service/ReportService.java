package com.acme.portal.service;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ReportService {

    private final JdbcTemplate jdbcTemplate;
    private final NamedParameterJdbcTemplate namedJdbc;

    public ReportService(JdbcTemplate jdbcTemplate, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbcTemplate = jdbcTemplate;
        this.namedJdbc = namedJdbc;
    }

    public List<Map<String, Object>> revenueByRegion(String region) {
        String sql = "select c.region, date_trunc('month', i.due_date) as month, sum(i.amount) as total "
            + "from invoice i join customer c on c.id = i.customer_id "
            + "where i.status = 'PAID' and c.region = '" + region + "' "
            + "group by c.region, month order by month";
        return jdbcTemplate.queryForList(sql);
    }

    public List<Map<String, Object>> overdueByRegion(String region) {
        String sql = "select c.name, i.number, i.amount, i.due_date from invoice i "
            + "join customer c on c.id = i.customer_id "
            + "where i.status = 'OVERDUE' and c.region = :region order by i.due_date";
        return namedJdbc.queryForList(sql, Map.of("region", region));
    }
}
