import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UsersService } from '../users/users.service';

@Controller()
export class InternalController {
  constructor(private readonly users: UsersService) {}

  @MessagePattern({ cmd: 'user.lookup' })
  lookup(@Payload() data: { email: string }) {
    return this.users.findByEmail(data.email);
  }

  @MessagePattern({ cmd: 'user.setRole' })
  setRole(@Payload() data: { userId: string; role: string }) {
    return this.users.update(data.userId, { role: data.role });
  }
}
