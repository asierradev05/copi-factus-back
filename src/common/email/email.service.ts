import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export const DEFAULT_EMAIL_FROM = 'servicios@copigraficassierra.com';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly transporter: Transporter | null;
  private from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.from =
        this.config.get<string>('EMAIL_FROM') ?? DEFAULT_EMAIL_FROM;
      this.transporter = null;
      return;
    }

    this.resend = null;
    this.from = DEFAULT_EMAIL_FROM;

    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.transporter = null;
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
      this.config.get<string>('EMAIL_FROM') ??
      DEFAULT_EMAIL_FROM;
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId: string; simulated: boolean }> {
    if (this.resend) {
      const result = await this.resend.emails.send({
        from: this.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
        })),
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Error al enviar por Resend.');
      }
      return {
        messageId: result.data?.id ?? `resend-${Date.now()}`,
        simulated: false,
      };
    }

    if (!this.transporter) {
      this.logger.warn(
        `Correo (Resend/SMTP) no configurado. Correo simulado a "${options.to}" (asunto: "${options.subject}")`,
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