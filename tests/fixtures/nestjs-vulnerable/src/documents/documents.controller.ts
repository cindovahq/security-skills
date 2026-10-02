import {
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { diskStorage, memoryStorage } from 'multer';
import { join } from 'path';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { DocumentsService, UPLOAD_DIR } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, file.originalname),
      }),
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    return this.documents.register(user.id, file);
  }

  @Get('download/:name')
  download(@Param('name') name: string) {
    return new StreamableFile(createReadStream(join(UPLOAD_DIR, name)));
  }

  @Get(':id/text')
  text(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documents.extractText(id, user?.id);
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  avatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(png|jpeg)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documents.saveAvatar(user?.id, file);
  }
}
