import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { SettingsAdminController } from './settings-admin.controller';

@Module({
  imports: [UsersModule],
  controllers: [AdminController, SettingsAdminController],
})
export class AdminModule {}
