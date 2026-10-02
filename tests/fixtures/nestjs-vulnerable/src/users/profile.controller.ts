import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  SerializeOptions,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ProfileDto } from './profile.dto';
import { UsersService } from './users.service';

@Controller('profile')
@UseInterceptors(ClassSerializerInterceptor)
@SerializeOptions({ strategy: 'excludeAll' })
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() current: AuthUser) {
    if (!current?.id) {
      throw new UnauthorizedException();
    }
    return new ProfileDto(await this.users.findOne(current.id));
  }
}
