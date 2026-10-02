import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { Repository } from 'typeorm';
import { PdfService } from '../pdf/pdf.service';
import { UsersService } from '../users/users.service';
import { DocumentRecord } from './document.entity';

export const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');
const AVATAR_DIR = join(process.cwd(), 'storage', 'avatars');

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(DocumentRecord) private readonly repo: Repository<DocumentRecord>,
    private readonly users: UsersService,
    private readonly pdf: PdfService,
  ) {}

  register(ownerId: string, file: Express.Multer.File): Promise<DocumentRecord> {
    return this.repo.save(
      this.repo.create({ ownerId, storedName: file.filename, originalName: file.originalname }),
    );
  }

  async saveAvatar(userId: string | undefined, file: Express.Multer.File) {
    if (!userId) {
      throw new UnauthorizedException();
    }
    const storedName = `${randomUUID()}.bin`;
    await mkdir(AVATAR_DIR, { recursive: true });
    await writeFile(join(AVATAR_DIR, storedName), file.buffer);
    return this.users.update(userId, { avatarFile: storedName });
  }

  async extractText(id: string, userId: string | undefined): Promise<{ text: string }> {
    if (!userId) {
      throw new UnauthorizedException();
    }
    const record = await this.repo.findOneBy({ id, ownerId: userId });
    if (!record) {
      throw new NotFoundException();
    }
    return { text: await this.pdf.extractText(join(UPLOAD_DIR, record.storedName)) };
  }
}
