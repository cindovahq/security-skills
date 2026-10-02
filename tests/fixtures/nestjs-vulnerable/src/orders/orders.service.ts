import { Injectable } from '@nestjs/common';
import { Order } from './order.model';

const ORDERS: Order[] = [
  { id: 'ord-1001', customerId: 'c-1', totalCents: 12900, status: 'shipped' },
  { id: 'ord-1002', customerId: 'c-2', totalCents: 4500, status: 'processing' },
];

@Injectable()
export class OrdersService {
  findForCustomer(customerId: string): Order[] {
    return ORDERS.filter((order) => order.customerId === customerId);
  }
}
