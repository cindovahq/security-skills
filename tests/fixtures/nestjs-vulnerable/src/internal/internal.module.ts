import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { InternalController } from './internal.controller';

@Module({
  imports: [UsersModule],
  controllers: [InternalController],
})
export class InternalModule {}
