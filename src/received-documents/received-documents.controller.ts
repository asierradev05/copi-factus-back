import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ReceivedDocumentsService } from './received-documents.service';
import {
  CreateReceivedDocumentDto,
  FilterReceivedDocumentDto,
  UpdateReceivedDocumentDto,
} from './dto/received-document.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('received-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceivedDocumentsController {
  constructor(private readonly receivedDocuments: ReceivedDocumentsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterReceivedDocumentDto) {
    return this.receivedDocuments.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.receivedDocuments.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(
    @Body() dto: CreateReceivedDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receivedDocuments.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReceivedDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receivedDocuments.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.receivedDocuments.remove(id, user.id);
  }
}
