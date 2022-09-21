import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { ResetPromise, throttle } from './throttle';
import { celciusToFahrenheit, fahrenheitToCelcius } from './temperature';

const DEVICE_ITEM_TYPE = 'application/vnd.nexia.device+json';
const THERMOSTAT_DEVICE_TYPE = 'xxl_thermostat';

export class MobileClient {
  _status: ResetPromise<Status>;
  _client: AxiosInstance;

  constructor(public houseId: string, public mobileId: string, public apiKey: string) {
    this._client = axios.create({
      headers: {
        'X-MobileId': mobileId,
        'X-ApiKey': apiKey,
      },
    });
    const getStatus = async () => {
      const ret = await this._client.get(`https://www.mynexia.com/mobile/houses/${this.houseId}`);
      return ret.data as Status;
    };
    this._status = throttle(getStatus, 5_000);
  }

  async status(): Promise<Status> {
    return this._status();
  }

  async post(url: string, json: unknown) {
    const ret = await this._client.post(url, json);
    this.clearCache();
    return ret;
  }

  clearCache() {
    this._status.reset();
  }

  async thermostats(): Promise<Thermostat[]> {
    const status = await this.status();
    const children = status.result._links.child;
    const found = children.find(c => c.data.item_type === DEVICE_ITEM_TYPE) as StatusChildDevice | undefined;
    const dev = found?.data.items.filter(d => d.type === THERMOSTAT_DEVICE_TYPE) as StatusThermostat[];
    return dev.map(d => new Thermostat(d, this));
  }

  async thermostat(id: number): Promise<Thermostat | undefined> {
    return (await this.thermostats()).find(t => t.id === id);
  }
}

export class Thermostat {
  constructor(public raw: StatusThermostat, public client: MobileClient) {
  }

  get id() {
    return this.raw.id;
  }

  get name() {
    return this.raw.name;
  }

  get outdoorTemperature() {
    return this.raw.has_outdoor_temperature ?
      fahrenheitToCelcius(Number(this.raw.outdoor_temperature)) :
      undefined;
  }

  get indoorHumidity() {
    return this.raw.has_indoor_humidity ?
      Number(this.raw.indoor_humidity) :
      undefined;
  }

  get zones() {
    return this.raw.zones.map(rz => new Zone(rz, this.client));
  }

  zone(id: number) {
    return this.zones.find(z => z.id === id);
  }
}

export class Zone {
  constructor(public raw: StatusZone, public client: MobileClient) {
  }

  get id() {
    return this.raw.id;
  }

  get name() {
    return this.raw.name;
  }

  get currentTemp() {
    return fahrenheitToCelcius(this.raw.temperature);
  }

  get _thermostatFeature() {
    return this.raw.features.find(f => f.name === 'thermostat') as ThermostatFeature;
  }

  get _thermostatModeFeature() {
    return this.raw.features.find(f => f.name === 'thermostat_mode') as ThermostatModeFeature;
  }

  get setpointHeat() {
    return fahrenheitToCelcius(this.raw.setpoints.heat);
  }

  get setpointCool() {
    return fahrenheitToCelcius(this.raw.setpoints.cool);
  }

  get status() {
    return this._thermostatFeature.system_status;
  }

  get mode() {
    return this.raw.current_zone_mode;
  }

  async setMode(value: MODE) {
    const url = this._thermostatModeFeature.actions.update_thermostat_mode.href;
    return await this.client.post(url, { value });
  }

  async setCoolSetpoint(cool: number) {
    cool = celciusToFahrenheit(cool);
    const url = this._thermostatFeature.actions.set_cool_setpoint.href;
    return await this.client.post(url, { cool });
  }

  async setHeatSetpoint(heat: number) {
    heat = celciusToFahrenheit(heat);
    const url = this._thermostatFeature.actions.set_heat_setpoint.href;
    return await this.client.post(url, { heat });
  }
}

interface Status {
  success: boolean;
  error: unknown;
  result: {
    name: string;
    _links: {
      child: StatusChild[];
    };
  };
}

interface StatusChild {
  href: string;
  type: string;
  data: {
    items: Record<string, unknown>[];
    item_type: string;
  };
}

interface StatusChildDevice extends StatusChild {
  data: {
    items: {
      id: number;
      name: string;
      type: string;
    }[];
    item_type: string;
  };
}

interface StatusThermostat {
  id: number;
  name: string;
  type: string;
  has_outdoor_temperature: boolean;
  outdoor_temperature: string;
  has_indoor_humidity: boolean;
  indoor_humidity: string;
  system_status: string;
  manufacturer: string;
  features: {
    name: string;
  }[];
  zones: StatusZone[];
}

type MODE = 'COOL' | 'HEAT' | 'AUTO' | 'OFF';
type ZONE_STATUS = 'System Idle' | 'Cooling' | 'Heating' | 'Waiting...' | 'Fan Running';

interface StatusZone {
  id: number;
  name: string;
  type: string;
  current_zone_mode: MODE;
  temperature: number;
  setpoints: {
    heat: number;
    cool: number;
  };
  features: {
    name: string;
  }[];
}

interface ThermostatFeature {
  name: 'thermostat';
  temperature: number;
  actions: {
    set_cool_setpoint: {
      href: string;
    };
    set_heat_setpoint: {
      href: string;
    };
  };
  scale: 'f' | 'c';
  setpoint_cool: number;
  setpoint_heat: number;
  system_status: ZONE_STATUS;
}

interface ThermostatModeFeature {
  name: 'thermostat_mode';
  value: MODE;
  actions: {
    update_thermostat_mode: {
      href: string;
    };
  };
}
