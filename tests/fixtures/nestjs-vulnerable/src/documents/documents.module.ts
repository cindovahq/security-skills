import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PdfService } from '../pdf/pdf.service';
import { UsersModule } from '../users/users.module';
import { DocumentRecord } from './document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentRecord]), UsersModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PdfService],
})
export class DocumentsModule {}
