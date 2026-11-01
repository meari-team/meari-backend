import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PushMessage = {
  to: string;
  title: string;
  subtitle?: string;
  body: string;
  data: Record<string, string>;
  channelId?: string;
};

// 토큰별 결과. invalidToken이면 그 토큰을 지운다 (앱 삭제 등)
export type PushResult = {
  token: string;
  ok: boolean;
  invalidToken: boolean;
  error?: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo 푸시 서비스로 보낸다. 앱이 꺼져 있어도 기기에 도착한다.
// ECHO_PUSH=off면 보내지 않는다 (개발·테스트). EXPO_ACCESS_TOKEN은 Expo 계정에서 '푸시 보안'을 켰을 때만 필요
@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);
  private readonly enabled: boolean;
  private readonly accessToken: string | undefined;

  constructor(config: ConfigService) {
    this.enabled = config.get('ECHO_PUSH', 'expo') !== 'off';
    this.accessToken = config.get<string>('EXPO_ACCESS_TOKEN');
  }

  get available(): boolean {
    return this.enabled;
  }

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    if (!this.enabled || messages.length === 0) {
      return messages.map((m) => ({
        token: m.to,
        ok: false,
        invalidToken: false,
        error: 'push_disabled',
      }));
    }
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.accessToken
          ? { authorization: `Bearer ${this.accessToken}` }
          : {}),
      },
      body: JSON.stringify(
        messages.map((m) => ({ ...m, sound: 'default', priority: 'high' })),
      ),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`expo_push_http_${res.status}`);
    }
    const json = (await res.json()) as {
      data?: {
        status: 'ok' | 'error';
        message?: string;
        details?: { error?: string };
      }[];
    };
    const tickets = json.data ?? [];
    return messages.map((m, i) => {
      const t = tickets[i];
      if (t?.status === 'ok')
        return { token: m.to, ok: true, invalidToken: false };
      const error = t?.details?.error ?? t?.message ?? 'unknown';
      this.logger.warn(JSON.stringify({ event: 'push_ticket_error', error }));
      return {
        token: m.to,
        ok: false,
        invalidToken: error === 'DeviceNotRegistered',
        error,
      };
    });
  }
}
