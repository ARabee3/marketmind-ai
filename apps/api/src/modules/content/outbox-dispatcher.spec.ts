import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { OutboxDispatcher } from './outbox-dispatcher';
import { PublicationCandidateRepository } from './repositories/publication-candidate.repository';

describe('OutboxDispatcher', () => {
  let dispatcher: OutboxDispatcher;
  let candidateRepo: jest.Mocked<PublicationCandidateRepository>;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockCandidateRepo = {
      listOutboxPending: jest.fn(),
      markOutboxDispatched: jest.fn(),
      markOutboxFailed: jest.fn(),
    };

    const mockHttpService = {
      post: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxDispatcher,
        {
          provide: PublicationCandidateRepository,
          useValue: mockCandidateRepo,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    dispatcher = module.get<OutboxDispatcher>(OutboxDispatcher);
    candidateRepo = module.get(PublicationCandidateRepository);
    httpService = module.get(HttpService);
    configService = module.get(ConfigService);
  });

  describe('process', () => {
    const mockEvent = {
      id: 1n,
      eventId: 'test-event-id',
      eventType: 'content.publication_candidate.created.v1',
      correlationId: 'test-correlation-id',
      candidateId: 'test-candidate-id',
      payload: { test: 'data' },
      state: 'pending',
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: new Date(),
      dispatchedAt: null,
    };

    it('should mark event as dispatched when webhook URL is not configured', async () => {
      configService.get.mockReturnValue(undefined);
      candidateRepo.listOutboxPending.mockResolvedValue([mockEvent]);
      candidateRepo.markOutboxDispatched.mockResolvedValue(undefined);

      await dispatcher.process({
        data: { eventId: 'test-event-id' },
      } as any);

      expect(candidateRepo.listOutboxPending).toHaveBeenCalledWith(1);
      expect(candidateRepo.markOutboxDispatched).toHaveBeenCalledWith('test-event-id');
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should dispatch event to webhook URL when configured', async () => {
      configService.get.mockReturnValue('https://webhook.example.com');
      candidateRepo.listOutboxPending.mockResolvedValue([mockEvent]);
      httpService.post.mockReturnValue(of({ status: 200, data: {} }) as any);
      candidateRepo.markOutboxDispatched.mockResolvedValue(undefined);

      await dispatcher.process({
        data: { eventId: 'test-event-id' },
      } as any);

      expect(candidateRepo.listOutboxPending).toHaveBeenCalledWith(1);
      expect(httpService.post).toHaveBeenCalledWith(
        'https://webhook.example.com',
        mockEvent.payload,
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Id': 'test-event-id',
            'X-Event-Type': 'content.publication_candidate.created.v1',
          },
        },
      );
      expect(candidateRepo.markOutboxDispatched).toHaveBeenCalledWith('test-event-id');
      expect(candidateRepo.markOutboxFailed).not.toHaveBeenCalled();
    });

    it('should mark event as failed when webhook call fails', async () => {
      configService.get.mockReturnValue('https://webhook.example.com');
      candidateRepo.listOutboxPending.mockResolvedValue([mockEvent]);
      httpService.post.mockReturnValue(
        throwError(() => new Error('Network error')),
      );
      candidateRepo.markOutboxFailed.mockResolvedValue(undefined);

      await expect(
        dispatcher.process({
          data: { eventId: 'test-event-id' },
        } as any),
      ).rejects.toThrow('Network error');

      expect(candidateRepo.listOutboxPending).toHaveBeenCalledWith(1);
      expect(httpService.post).toHaveBeenCalled();
      expect(candidateRepo.markOutboxFailed).toHaveBeenCalledWith(
        'test-event-id',
        'Network error',
      );
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
    });

    it('should handle event not found gracefully', async () => {
      configService.get.mockReturnValue('https://webhook.example.com');
      candidateRepo.listOutboxPending.mockResolvedValue([]);

      await dispatcher.process({
        data: { eventId: 'non-existent-event' },
      } as any);

      expect(candidateRepo.listOutboxPending).toHaveBeenCalledWith(1);
      expect(httpService.post).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxFailed).not.toHaveBeenCalled();
    });

    it('should handle event with different eventId', async () => {
      configService.get.mockReturnValue('https://webhook.example.com');
      candidateRepo.listOutboxPending.mockResolvedValue([mockEvent]);

      await dispatcher.process({
        data: { eventId: 'different-event-id' },
      } as any);

      expect(candidateRepo.listOutboxPending).toHaveBeenCalledWith(1);
      expect(httpService.post).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxFailed).not.toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      configService.get.mockReturnValue('https://webhook.example.com');
      candidateRepo.listOutboxPending.mockResolvedValue([mockEvent]);
      httpService.post.mockReturnValue(
        throwError(() => 'String error'),
      );
      candidateRepo.markOutboxFailed.mockResolvedValue(undefined);

      let thrownError: any;
      try {
        await dispatcher.process({
          data: { eventId: 'test-event-id' },
        } as any);
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBe('String error');
      expect(candidateRepo.markOutboxFailed).toHaveBeenCalledWith(
        'test-event-id',
        'Unknown error',
      );
    });
  });
});
