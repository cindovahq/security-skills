import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly users: UsersService) {}

  async register(dto: RegisterDto): Promise<User> {
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('Email already registered');
    }
    return this.users.create({
      ...dto,
      passwordHash: this.hash(dto.password),
    });
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (!user || user.passwordHash !== this.hash(password)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  private hash(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }
}
