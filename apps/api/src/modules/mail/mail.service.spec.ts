import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { MailService } from './mail.service';
import { ResendAdapter } from './resend.adapter';
import { MailDeliveryError } from './mail-delivery.error';

const createMockResendAdapter = () => ({
  send: jest.fn(),
});

const createMockConfigService = (nodeEnv: string) => ({
  get: jest.fn((key: string) => {
    if (key === 'app.nodeEnv') return nodeEnv;
    return undefined;
  }),
});

describe('MailService', () => {
  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Development / test mode — console mock
  // =========================================================================

  describe('in development mode', () => {
    let service: MailService;
    let adapter: ReturnType<typeof createMockResendAdapter>;

    beforeEach(async () => {
      adapter = createMockResendAdapter();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: ResendAdapter, useValue: adapter },
          { provide: ConfigService, useValue: createMockConfigService('development') },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
    });

    it('should NOT call ResendAdapter.send when in development mode', async () => {
      await service.sendMail('user@example.com', 'Hello', '<p>World</p>');
      expect(adapter.send).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when in development mode', async () => {
      await expect(
        service.sendMail('user@example.com', 'Hello', '<p>World</p>'),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Production mode — delegates to ResendAdapter
  // =========================================================================

  describe('in production mode', () => {
    let service: MailService;
    let adapter: ReturnType<typeof createMockResendAdapter>;

    beforeEach(async () => {
      adapter = createMockResendAdapter();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: ResendAdapter, useValue: adapter },
          { provide: ConfigService, useValue: createMockConfigService('production') },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
    });

    it('should delegate to ResendAdapter.send in production mode', async () => {
      adapter.send.mockResolvedValue(undefined);

      await service.sendMail('user@example.com', 'Subject', '<p>body</p>');

      expect(adapter.send).toHaveBeenCalledWith(
        'user@example.com',
        'Subject',
        '<p>body</p>',
      );
    });

    it('should propagate MailDeliveryError from adapter', async () => {
      adapter.send.mockRejectedValue(new MailDeliveryError('Resend API error'));

      await expect(
        service.sendMail('user@example.com', 'Subject', '<p>body</p>'),
      ).rejects.toBeInstanceOf(MailDeliveryError);
    });
  });
});
