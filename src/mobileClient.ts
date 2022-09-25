import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { HouseStatus, MODE, Zone } from './houseStatus';
import { celciusToFahrenheit } from './temperature';

export class MobileClient {
  _client: AxiosInstance;

  constructor(public houseId: string, public mobileId: string, public apiKey: string) {
    this._client = axios.create({
      headers: {
        'X-MobileId': mobileId,
        'X-ApiKey': apiKey,
      },
    });
  }

  async status(): Promise<HouseStatus> {
    const ret = await this._client.get(`https://www.mynexia.com/mobile/houses/${this.houseId}`);
    return new HouseStatus(ret.data);
  }

  async post(url: string, json: unknown) {
    const ret = await this._client.post(url, json);
    return ret;
  }

  async setMode(zone: Zone, value: MODE) {
    const url = zone._thermostatModeFeature.actions.update_thermostat_mode.href;
    return await this.post(url, { value });
  }

  async setCoolSetpoint(zone: Zone, cool: number) {
    cool = celciusToFahrenheit(cool);
    const url = zone._thermostatFeature.actions.set_cool_setpoint.href;
    return await this.post(url, { cool });
  }

  async setHeatSetpoint(zone: Zone, heat: number) {
    heat = celciusToFahrenheit(heat);
    const url = zone._thermostatFeature.actions.set_heat_setpoint.href;
    return await this.post(url, { heat });
  }
}
