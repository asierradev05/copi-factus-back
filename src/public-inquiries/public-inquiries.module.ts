import { Module } from '@nestjs/common';
import { PublicInquiriesController } from './public-inquiries.controller';
import { PublicInquiriesService } from './public-inquiries.service';

@Module({
  controllers: [PublicInquiriesController],
  providers: [PublicInquiriesService],
  exports: [PublicInquiriesService],
})
export class PublicInquiriesModule {}
