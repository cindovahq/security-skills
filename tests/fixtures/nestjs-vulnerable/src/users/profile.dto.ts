import { Expose } from 'class-transformer';
import { User } from './user.entity';

export class ProfileDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  displayName: string;

  @Expose()
  avatarFile: string;

  constructor(user: User) {
    this.id = user.id;
    this.email = user.email;
    this.displayName = user.displayName;
    this.avatarFile = user.avatarFile;
  }
}
