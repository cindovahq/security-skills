import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  create(data: Partial<User>): Promise<User> {
    return this.repo.save(this.repo.create(data));
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  findOne(id: string): Promise<User> {
    return this.repo.findOneByOrFail({ id });
  }

  findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async update(id: string, changes: UpdateUserDto | Partial<User>): Promise<User> {
    const user = await this.findOne(id);
    Object.assign(user, changes);
    return this.repo.save(user);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
