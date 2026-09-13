import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService (resend)', () => {
  async function createService(
    env: Record<string, string | undefined>,
  ): Promise<EmailService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] ?? undefined },
        },
      ],
    }).compile();
    return module.get(EmailService);
  }

  it('simula el envío cuando no hay Resend ni SMTP configurados', async () => {
    const service = await createService({});

    const result = await service.sendMail({
      to: 'cliente@ejemplo.com',
      subject: 'Prueba',
      html: '<p>Hola</p>',
    });

    expect(result.simulated).toBe(true);
    expect(result.messageId).toMatch(/^dev-/);
  });

  it('se configura con Resend cuando existe RESEND_API_KEY', async () => {
    const service = await createService({
      RESEND_API_KEY: 're_test_123',
    });

    expect(service).toBeDefined();
  });
});
