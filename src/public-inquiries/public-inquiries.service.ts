import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PublicInquiryStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  CreatePublicInquiryDto,
  FilterPublicInquiryDto,
  UpdatePublicInquiryStatusDto,
} from './dto/public-inquiry.dto';

@Injectable()
export class PublicInquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePublicInquiryDto) {
    return this.prisma.publicInquiry.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        email: dto.email?.trim() || null,
        company: dto.company?.trim() || null,
        service: dto.service?.trim() || null,
        message: dto.message?.trim() || null,
        source: dto.source?.trim() || 'web',
      },
    });
  }

  async findAll(query: FilterPublicInquiryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PublicInquiryWhereInput = {};
    if (query.status) where.status = query.status as PublicInquiryStatus;

    const [data, total] = await Promise.all([
      this.prisma.publicInquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { handledBy: true },
      }),
      this.prisma.publicInquiry.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const inquiry = await this.prisma.publicInquiry.findUnique({
      where: { id },
      include: { handledBy: true },
    });
    if (!inquiry) {
      throw new NotFoundException('La consulta no fue encontrada.');
    }
    return inquiry;
  }

  async updateStatus(id: string, dto: UpdatePublicInquiryStatusDto, userId: string) {
    await this.findOne(id);
    return this.prisma.publicInquiry.update({
      where: { id },
      data: {
        status: dto.status,
        handledById: dto.status === 'NUEVA' ? null : userId,
      },
      include: { handledBy: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.publicInquiry.delete({ where: { id } });
  }
}
