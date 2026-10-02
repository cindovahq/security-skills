import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GeoService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async lookup(ip: string) {
    const { data } = await firstValueFrom(
      this.http.get(`https://geo.acme-partner.test/v1/lookup/${encodeURIComponent(ip)}`, {
        headers: { 'x-api-key': this.config.get<string>('GEO_API_KEY') },
        timeout: 3000,
      }),
    );
    return { country: data.country, city: data.city };
  }
}
