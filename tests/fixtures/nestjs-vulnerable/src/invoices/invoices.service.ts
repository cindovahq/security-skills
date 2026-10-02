import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestContextService } from '../common/request-context.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { Invoice } from './invoice.entity';

const SORT_COLUMNS = {
  created: 'invoice.createdAt',
  amount: 'invoice.amountCents',
} as const;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private readonly repo: Repository<Invoice>,
    private readonly context: RequestContextService,
    private readonly gateway: NotificationsGateway,
  ) {}

  list(query: ListInvoicesDto): Promise<Invoice[]> {
    const qb = this.repo
      .createQueryBuilder('invoice')
      .where('invoice.ownerId = :ownerId', { ownerId: this.context.userId });
    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }
    qb.orderBy(SORT_COLUMNS[query.sort ?? 'created'], query.order === 'asc' ? 'ASC' : 'DESC');
    return qb.getMany();
  }

  search(term: string): Promise<Invoice[]> {
    return this.repo
      .createQueryBuilder('invoice')
      .where(`invoice.description ILIKE '%${term}%'`)
      .orderBy('invoice.createdAt', 'DESC')
      .limit(50)
      .getMany();
  }

  findOne(id: string): Promise<Invoice> {
    return this.repo.findOneByOrFail({ id });
  }

  async updateNotes(id: string, userId: string | undefined, notes: string): Promise<Invoice> {
    if (!userId) {
      throw new UnauthorizedException();
    }
    const invoice = await this.repo.findOneBy({ id, ownerId: userId });
    if (!invoice) {
      throw new NotFoundException();
    }
    invoice.notes = notes;
    return this.repo.save(invoice);
  }

  async markPaid(id: string): Promise<void> {
    const invoice = await this.findOne(id);
    invoice.status = 'paid';
    await this.repo.save(invoice);
    this.gateway.notifyUser(invoice.ownerId, 'invoice.paid', { id: invoice.id });
  }
}
