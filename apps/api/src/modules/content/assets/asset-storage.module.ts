import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetStorage, CONTENT_ASSET_STORAGE } from './asset-storage.port';
import { LocalFilesystemAssetStorage } from './local-filesystem-asset-storage';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CONTENT_ASSET_STORAGE,
      useClass: LocalFilesystemAssetStorage,
    },
  ],
  exports: [CONTENT_ASSET_STORAGE],
})
export class AssetStorageModule {}
