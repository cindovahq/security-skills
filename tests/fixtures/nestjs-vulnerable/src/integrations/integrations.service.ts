import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class IntegrationsService {
  constructor(private readonly http: HttpService) {}

  async fetchPreview(url: string) {
    const { data, headers } = await firstValueFrom(
      this.http.get<string>(url, { timeout: 5000, responseType: 'text' }),
    );
    const title = /<title>([^<]*)<\/title>/i.exec(data)?.[1] ?? null;
    return { title, contentType: headers['content-type'], excerpt: data.slice(0, 2000) };
  }
}
