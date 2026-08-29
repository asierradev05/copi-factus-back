import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string | undefined;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');

    if (!host) {
      this.transporter = null;
      this.from = undefined;
      return;
    }

    const user = this.config.get<string>('SMTP_USER');
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth:
        user && this.config.get<string>('SMTP_PASS')
          ? { user, pass: this.config.get<string>('SMTP_PASS') as string }
          : undefined,
    });
    this.from =
      this.config.get<string>('SMTP_FROM') ??
      user ??
      this.config.get<string>('EMPTY_FROM');
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId: string; simulated: boolean }> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP no configurado. Correo simulado a "${options.to}" (asunto: "${options.subject}")`,
      );
      return { messageId: `dev-${Date.now()}`, simulated: true };
    }

    const info = (await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    })) as { messageId: string };

    return { messageId: info.messageId, simulated: false };
  }
}
