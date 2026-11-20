import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigRootModule } from './config/config-root.module';
import { DatabaseRootModule } from './database/database-root.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [ConfigRootModule, DatabaseRootModule, AuthModule, VideosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
