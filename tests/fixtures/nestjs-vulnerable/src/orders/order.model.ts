import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Customer {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field()
  displayName: string;

  internalNotes?: string;
}

@ObjectType()
export class Order {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  totalCents: number;

  @Field()
  status: string;

  customerId: string;

  @Field(() => Customer)
  customer?: Customer;
}
