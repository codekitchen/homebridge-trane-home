import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MobileClient } from './mobileClient';
import { ResetPromise, throttle } from './throttle';
import { HouseStatus } from './houseStatus';

const MODE_MAP = {
  'OFF': 0,
  'HEAT': 1,
  'COOL': 2,
  'AUTO': 3,
};

const MODE_INV_MAP = {
  0: 'OFF',
  1: 'HEAT',
  2: 'COOL',
  3: 'AUTO',
};

const STATE_MAP = {
  'Heating': 1,
  'Cooling': 2,
};

export class Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  _client: MobileClient;
  _getStatus: ResetPromise<HouseStatus>;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    this._client = new MobileClient(config.houseId, config.mobileId, config.apiKey);

    this._getStatus = throttle(() => {
      this.log.debug('getting status');
      return this._client.status();
    }, 5_000);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  async houseStatus() {
    // TODO: reset status on POST to refresh
    return this._getStatus();
  }

  async thermostat(id: number) {
    const ret = (await this.houseStatus()).thermostat(id);
    if (!ret) {
      throw new Error(`thermostat not found: ${id}`);
    }
    return ret;
  }

  async zone(tid: number, zid: number) {
    const ret = (await this.thermostat(tid)).zone(zid);
    if (!ret) {
      throw new Error(`zone not found: ${zid} for thermostat: ${tid}`);
    }
    return ret;
  }

  async discoverDevices() {
    const thermostats = (await this.houseStatus()).thermostats();

    for (const t of thermostats) {
      if (t.outdoorTemperature !== undefined) {
        const uuid = this.api.hap.uuid.generate(`${t.id}-outdoorTemp`);
        let acc = this.accessories.find(a => a.UUID === uuid);
        if (!acc) {
          acc = new this.api.platformAccessory('Outdoor Temp', uuid);
          acc.getService(this.Service.AccessoryInformation)!
            .setCharacteristic(this.Characteristic.Manufacturer, 'Default-Manufacturer')
            .setCharacteristic(this.Characteristic.Model, 'Default-Model')
            .setCharacteristic(this.Characteristic.SerialNumber, 'Default-Serial');
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
          this.accessories.push(acc);
        }
        const temp = acc.getService(this.Service.TemperatureSensor) || acc.addService(this.Service.TemperatureSensor);
        temp.getCharacteristic(this.Characteristic.CurrentTemperature).onGet(() => this.thermostat(t.id).then(t => t.outdoorTemperature!));
      }

      for (const z of t.zones) {
        const uuid = this.api.hap.uuid.generate(`${t.id}-zone-${z.id}`);
        let acc = this.accessories.find(a => a.UUID === uuid);
        if (!acc) {
          acc = new this.api.platformAccessory(z.name === 'NativeZone' ? t.name : z.name, uuid);
          acc.getService(this.Service.AccessoryInformation)!
            .setCharacteristic(this.Characteristic.Manufacturer, 'Default-Manufacturer')
            .setCharacteristic(this.Characteristic.Model, 'Default-Model')
            .setCharacteristic(this.Characteristic.SerialNumber, 'Default-Serial');
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
          this.accessories.push(acc);
        }

        const thermo = acc.getService(this.Service.Thermostat) || acc.addService(this.Service.Thermostat);

        thermo.getCharacteristic(this.Characteristic.CurrentTemperature).onGet(() => this.zone(t.id, z.id).then(z => z.currentTemp));
        thermo.getCharacteristic(this.Characteristic.TargetTemperature).onGet(async () => {
          const zone = await this.zone(t.id, z.id);
          if (zone.mode === 'COOL') {
            return zone.setpointCool;
          }
          if (zone.mode === 'HEAT') {
            return zone.setpointHeat;
          }
          return 23.89; // TODO: what to do when in another mode?
        })
          .onSet(async (val) => {
            const zone = await this.zone(t.id, z.id);
            if (zone.mode === 'COOL') {
              this.log.debug('setting cooling setpoint to', val);
              await this._client.setCoolSetpoint(zone, Number(val));
            }
            if (zone.mode === 'HEAT') {
              this.log.debug('setting heating setpoint to', val);
              await this._client.setHeatSetpoint(zone, Number(val));
            }
          });
        thermo.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState).onGet(
          () => this.zone(t.id, z.id).then(z => STATE_MAP[z.status] || 0));
        thermo.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).onGet(
          () => this.zone(t.id, z.id).then(z => MODE_MAP[z.mode]));
        thermo.getCharacteristic(this.Characteristic.CoolingThresholdTemperature).onGet(
          () => this.zone(t.id, z.id).then(z => z.setpointCool));
        thermo.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).onGet(
          () => this.zone(t.id, z.id).then(z => z.setpointHeat));
        if (t.indoorHumidity !== undefined) {
          thermo.getCharacteristic(this.Characteristic.CurrentRelativeHumidity).onGet(
            () => this.thermostat(t.id).then(t => t.indoorHumidity!));
        }

        thermo.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).onSet(async val => {
          const setVal = MODE_INV_MAP[Number(val)];
          this.log.debug('setting target state to', setVal);
          await this._client.setMode(z, setVal);
        });
        thermo.getCharacteristic(this.Characteristic.CoolingThresholdTemperature).onSet(async val => {
          this.log.debug('setting cooling setpoint to', val);
          await this._client.setCoolSetpoint(z, Number(val));
        });
        thermo.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).onSet(async val => {
          this.log.debug('setting heating setpoint to', val);
          await this._client.setHeatSetpoint(z, Number(val));
        });
      }
    }
  }
}
