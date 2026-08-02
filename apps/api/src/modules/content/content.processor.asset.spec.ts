import { Test, TestingModule } from '@nestjs/testing';
import { ContentProcessor } from './content.processor';
import { ContentPackRepository } from './repositories/content-pack.repository';
import { ContentCycleRepository } from './repositories/content-cycle.repository';
import { ContentWeekContextRepository } from './repositories/content-week-context.repository';
import { StrategyRepository } from '../strategy/strategy.repository';
import { ContentAiClient } from './content.client';
import { CONTENT_ASSET_STORAGE, AssetStorage } from './assets/asset-storage.port';
import { ProviderError } from '../../common/errors/provider-error';

describe('ContentProcessor - Static Asset Generation', () => {
  let processor: ContentProcessor;
  let packRepo: jest.Mocked<ContentPackRepository>;
  let cycleRepo: jest.Mocked<ContentCycleRepository>;
  let weekContextRepo: jest.Mocked<ContentWeekContextRepository>;
  let strategyRepo: jest.Mocked<StrategyRepository>;
  let aiClient: jest.Mocked<ContentAiClient>;
  let assetStorage: jest.Mocked<AssetStorage>;

  beforeEach(async () => {
    packRepo = {
      createAsset: jest.fn(),
    } as any;

    cycleRepo = {
      getCycleById: jest.fn(),
    } as any;

    weekContextRepo = {
      getWeekById: jest.fn(),
    } as any;

    strategyRepo = {
      readStrategy: jest.fn(),
      getVersionByNumber: jest.fn(),
      getDecisionById: jest.fn(),
      getActiveConfirmedProfileVersion: jest.fn(),
    } as any;

    aiClient = {
      generateStaticAsset: jest.fn(),
    } as any;

    assetStorage = {
      store: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentProcessor,
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekContextRepo },
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentAiClient, useValue: aiClient },
        { provide: CONTENT_ASSET_STORAGE, useValue: assetStorage },
      ],
    }).compile();

    processor = module.get<ContentProcessor>(ContentProcessor);
  });

  describe('handleGenerateStaticAsset', () => {
    const jobData = {
      contentItemVersionId: 'version-1',
      creativeBrief: 'Generate a product image',
      altText: 'Product image',
      width: 800,
      height: 600,
      idempotencyKey: 'idem-key',
      correlationId: 'corr-1',
    };

    it('should store ready asset with checksum', async () => {
      const asset = {
        id: 'asset-1',
        content_item_version_id: 'version-1',
        kind: 'generated_static' as const,
        status: 'ready' as const,
        mime_type: 'image/png',
        storage_key: 'assets/version-1/asset-1.png',
        checksum: 'sha256:abc123',
        width: 800,
        height: 600,
        alt_text: 'Product image',
        provider_name: 'dalle',
        provider_model: 'dall-e-3',
        provider_request_id: 'req-1',
        failure_code: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      aiClient.generateStaticAsset.mockResolvedValue({
        contract_version: 'content-v1',
        asset,
        validation: { valid: true, issues: [] },
      });

      await processor.process({
        name: 'generate-static-asset',
        data: jobData,
      } as any);

      expect(aiClient.generateStaticAsset).toHaveBeenCalledWith({
        contract_version: 'content-v1',
        content_item_version_id: 'version-1',
        creative_brief: 'Generate a product image',
        alt_text: 'Product image',
        width: 800,
        height: 600,
        idempotency_key: 'idem-key',
      });

      expect(packRepo.createAsset).toHaveBeenCalledWith({
        contentItemVersionId: 'version-1',
        kind: 'generated_static',
        status: 'ready',
        mimeType: 'image/png',
        width: 800,
        height: 600,
        storageKey: 'assets/version-1/asset-1.png',
        checksum: 'sha256:abc123',
        altText: 'Product image',
        providerName: 'dalle',
        providerModel: 'dall-e-3',
        providerRequestId: 'req-1',
        failureCode: null,
      });
    });

    it('should handle failed asset generation', async () => {
      const asset = {
        id: 'asset-1',
        content_item_version_id: 'version-1',
        kind: 'generated_static' as const,
        status: 'failed' as const,
        mime_type: null,
        storage_key: null,
        checksum: null,
        width: null,
        height: null,
        alt_text: 'Product image',
        provider_name: 'dalle',
        provider_model: 'dall-e-3',
        provider_request_id: 'req-1',
        failure_code: 'CONTENT_PROVIDER_FAILURE' as const,
        created_at: '2024-01-01T00:00:00Z',
      };

      aiClient.generateStaticAsset.mockResolvedValue({
        contract_version: 'content-v1',
        asset,
        validation: { valid: true, issues: [] },
      });

      await processor.process({
        name: 'generate-static-asset',
        data: jobData,
      } as any);

      expect(assetStorage.store).not.toHaveBeenCalled();

      expect(packRepo.createAsset).toHaveBeenCalledWith({
        contentItemVersionId: 'version-1',
        kind: 'generated_static',
        status: 'failed',
        mimeType: null,
        width: null,
        height: null,
        storageKey: null,
        checksum: null,
        altText: 'Product image',
        providerName: 'dalle',
        providerModel: 'dall-e-3',
        providerRequestId: 'req-1',
        failureCode: 'CONTENT_PROVIDER_FAILURE',
      });
    });

    it('should handle provider error with retryable flag', async () => {
      const error = new ProviderError(
        'CONTENT_PROVIDER_FAILURE',
        'AI service unavailable',
        true,
      );

      aiClient.generateStaticAsset.mockRejectedValue(error);

      await expect(
        processor.process({
          name: 'generate-static-asset',
          data: jobData,
        } as any),
      ).rejects.toThrow(error);

      expect(packRepo.createAsset).toHaveBeenCalledWith({
        contentItemVersionId: 'version-1',
        kind: 'generated_static',
        status: 'failed',
        mimeType: null,
        width: null,
        height: null,
        storageKey: null,
        checksum: null,
        altText: 'Product image',
        providerName: null,
        providerModel: null,
        providerRequestId: null,
        failureCode: 'CONTENT_PROVIDER_FAILURE',
      });
    });

    it('should handle non-retryable provider error', async () => {
      const error = new ProviderError(
        'CONTENT_SCHEMA_FAILURE',
        'Invalid request',
        false,
      );

      aiClient.generateStaticAsset.mockRejectedValue(error);

      await processor.process({
        name: 'generate-static-asset',
        data: jobData,
      } as any);

      expect(packRepo.createAsset).toHaveBeenCalledWith({
        contentItemVersionId: 'version-1',
        kind: 'generated_static',
        status: 'failed',
        mimeType: null,
        width: null,
        height: null,
        storageKey: null,
        checksum: null,
        altText: 'Product image',
        providerName: null,
        providerModel: null,
        providerRequestId: null,
        failureCode: 'CONTENT_SCHEMA_FAILURE',
      });
    });
  });
});
