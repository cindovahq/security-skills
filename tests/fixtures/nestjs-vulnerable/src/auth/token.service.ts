import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/user.entity';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  issueAccessToken(user: User): string {
    return this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
  }

  issueResetToken(user: User): { token: string; expiresAt: Date } {
    const token = this.jwt.sign({ sub: user.id, purpose: 'reset' }, { expiresIn: '15m' });
    const { exp } = this.jwt.decode(token) as { exp: number };
    return { token, expiresAt: new Date(exp * 1000) };
  }
}
