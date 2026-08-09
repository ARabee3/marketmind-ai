import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AssetStorage, CONTENT_ASSET_STORAGE } from "./asset-storage.port";
import { LocalFilesystemAssetStorage } from "./local-filesystem-asset-storage";
import { R2AssetStorage } from "./r2-asset-storage";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CONTENT_ASSET_STORAGE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): AssetStorage => {
        const provider = configService.get<string>(
          "content.assetStorageProvider",
          "filesystem",
        );
        if (provider === "r2") {
          return new R2AssetStorage({
            endpoint: configService.getOrThrow<string>("content.r2.endpoint"),
            accessKeyId: configService.getOrThrow<string>(
              "content.r2.accessKeyId",
            ),
            secretAccessKey: configService.getOrThrow<string>(
              "content.r2.secretAccessKey",
            ),
            bucket: configService.getOrThrow<string>("content.r2.bucket"),
            region: configService.get<string>("content.r2.region", "auto"),
            usePathStyleEndpoint: configService.get<boolean>(
              "content.r2.usePathStyleEndpoint",
              true,
            ),
          });
        }
        return new LocalFilesystemAssetStorage(configService);
      },
    },
  ],
  exports: [CONTENT_ASSET_STORAGE],
})
export class AssetStorageModule {}
