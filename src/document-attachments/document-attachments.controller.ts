import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { DocumentAttachmentsService } from './document-attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { FilterAttachmentDto } from './dto/filter-attachment.dto';

@Controller('api/attachments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentAttachmentsController {
  constructor(private readonly service: DocumentAttachmentsService) {}

  @Get()
  findAll(@Query() query: FilterAttachmentDto) {
    return this.service.findByEntity(query.entityType, query.entityId);
  }

  @Get(':id/file')
  getFile(@Param('id') id: string) {
    return this.service.getSignedReadUrl(id);
  }

  @Post('presign')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  presign(@Body() body: { fileName: string; entityType: string; entityId: string }) {
    return this.service.presignUpload(body.fileName, body.entityType, body.entityId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: CreateAttachmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
