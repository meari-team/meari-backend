import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EchoService } from './echo.service.js';

// 서버 안에서 주기적으로(기본 1분) 예약된 메아리 회차를 처리한다.
// 앱이 꺼져 있어도 서버가 만들고 푸시로 알린다. NestJS는 1인스턴스 전제(ADR-005)지만,
// 회차는 조건부 갱신과 유니크 키로 잡아서 겹쳐 돌아도 중복 생성되지 않는다.
// ECHO_SCHEDULER=off면 돌지 않는다 (테스트)
@Injectable()
export class EchoScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EchoScheduler.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly echo: EchoService,
    config: ConfigService,
  ) {
    this.enabled = config.get('ECHO_SCHEDULER', 'on') !== 'off';
    this.intervalMs = Number(config.get('ECHO_TICK_MS', 60_000));
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  // 앞 처리가 끝나지 않았으면 이번 틱은 건너뛴다
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await this.echo.processDue(new Date());
        await this.echo.retryFailedPushes(new Date());
      } catch (e) {
        this.logger.error(
          JSON.stringify({
            event: 'echo_tick_failed',
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
