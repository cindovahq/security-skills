import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CustomerResolver, OrdersResolver } from './orders.resolver';
import { OrdersService } from './orders.service';

@Module({
  imports: [UsersModule],
  providers: [OrdersService, OrdersResolver, CustomerResolver],
})
export class OrdersModule {}
