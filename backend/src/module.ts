import {Module} from '@nestjs/common';
import {ApiController} from './api.controller';
import {ApiService} from './api.service';
import {DeskGateway} from './realtime.gateway';
@Module({
  imports: [],
  controllers: [ApiController],
  providers: [ApiService, DeskGateway],
})
export class AppModule {}
