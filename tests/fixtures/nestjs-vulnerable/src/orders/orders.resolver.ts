import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { UsersService } from '../users/users.service';
import { Customer, Order } from './order.model';
import { OrdersService } from './orders.service';

@Resolver(() => Order)
export class OrdersResolver {
  constructor(
    private readonly orders: OrdersService,
    private readonly users: UsersService,
  ) {}

  @Query(() => [Order])
  myOrders(@CurrentUser() user: AuthUser) {
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    return this.orders.findForCustomer(user.id);
  }

  @ResolveField(() => Customer)
  async customer(@Parent() order: Order): Promise<Customer> {
    return this.users.findOne(order.customerId);
  }
}

@Resolver(() => Customer)
export class CustomerResolver {
  @ResolveField(() => String, { nullable: true })
  @Roles('admin')
  @UseGuards(RolesGuard)
  internalNotes(@Parent() customer: Customer) {
    return customer.internalNotes;
  }
}
