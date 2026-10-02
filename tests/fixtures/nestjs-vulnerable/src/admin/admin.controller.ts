import { Controller, Delete, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { UsersService } from '../users/users.service';

@Roles('admin')
@Controller('admin/users')
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.findAll();
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(id);
  }
}
