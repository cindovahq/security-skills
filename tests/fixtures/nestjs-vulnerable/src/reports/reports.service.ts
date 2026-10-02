import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  revenueByMonth(customerId: string, sort: string) {
    return this.dataSource.query(
      `SELECT date_trunc('month', "createdAt") AS month, SUM("amountCents") AS total
         FROM invoice
        WHERE "ownerId" = '${customerId}'
        GROUP BY 1
        ORDER BY ${sort}`,
    );
  }

  countByStatus(ownerId: string) {
    return this.dataSource.query(
      'SELECT status, COUNT(*) AS total FROM invoice WHERE "ownerId" = $1 GROUP BY status',
      [ownerId],
    );
  }
}
