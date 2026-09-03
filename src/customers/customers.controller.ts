import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FilterCustomerDto } from './dto/filter-customer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { extractRutFromPdf } from '../common/rut/rut-extractor.util';

interface RutUploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterCustomerDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthUser) {
    return this.customersService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customersService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.customersService.remove(id, user.id);
  }

  @Post('extract-rut')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  @UseInterceptors(FileInterceptor('file'))
  async extractRut(@UploadedFile() file?: RutUploadFile) {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF.');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new PayloadTooLargeException('El archivo supera los 5MB.');
    }
    const required = ['name', 'documentNumber'];
    const extracted = await extractRutFromPdf(file.buffer);
    const missing = required.filter((f) => !extracted[f as keyof typeof extracted]);
    if (missing.length > 0) {
      throw new BadRequestException(
        'No se pudieron reconocer los datos del RUT. Verifica que sea un PDF del RUT generado digitalmente (no escaneado).',
      );
    }
    return { extracted };
  }
}
