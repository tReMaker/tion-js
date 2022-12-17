const { createApp } = Vue;

const AIRINTAKE_CLOSED = 0;
const AIRINTAKE_MIXED = 1;
const AIRINTAKE_OPEN = 2;

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NOTIFY_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const WRITE_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

const COMMAND_PAIR = 5;
const COMMAND_REQUEST_PARAMS = 1;
const COMMAND_SET_PARAMS = 2;

/*
public static final byte[] PAIRING_DEVICE = {5};
public static final byte[] REQUEST_PARAMS = {1};
public static final byte[] RESPONSE_REQUEST_PARAMS = {16};
public static final byte[] RESPONSE_SET_OR_REQUEST_TIMER_PARAMS = {BreezerConst.Lite.MIDDLE_POCKET_ID};
public static final byte[] RESPONSE_SET_PARAMS = {32};
public static final byte[] SET_OR_REQUEST_TIMER_PARAMS = {4};
public static final byte[] SET_PARAMS = {2};
public static final byte[] SET_PARAMS_WITH_ROM_SAVE = {18, 52};
public static final byte[] SET_TIME_PARAMS = {3};
*/

let tionDevice = null;
let tionService = null;

function createCommand(command) {
    const bytes = [61, command, (command == COMMAND_PAIR ? 1 : 0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90];
    return new Uint8Array(bytes);
}

function signValue(value) {
    const sign = (value & 0b10000000) >> 7;

    if (sign == 0) {
        return value;
    }

    return -1 * (128 - (value & 0b01111111));
}

function getWord2Int(l, h) {
    return ((h * 256) + l);
}

function getOutputTemperature(a, b) {
    return Math.floor(((a <= 0 ? b : a) + (b <= 0 ? a : b)) / 2);
}

function getResourceFiltersInDays(value) {
    if (value <= 0 || value > 360) {
        return 1;
    }

    return value;
}

const ChartComponent = {
    name: 'ChartComponent',
    template: '<div class="p-chart"><canvas ref="canvas" :width="width" :height="height"></canvas></div>',
    emits: ['loaded'],
    props: {
        width: {
            type: Number,
            default: 300
        },
        height: {
            type: Number,
            default: 150
        },
    },
    mounted() {
        this.chart = null;
        this.chartData = null;

        this.initChart();
    },
    beforeUnmount() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
            this.chartData = null;
        }
    },
    methods: {
        initChart() {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }

            const options = {
                plugins: {
                    legend: {
                        labels: {
                            color: '#495057'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#495057'
                        },
                        grid: {
                            color: '#ebedef'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#495057'
                        },
                        grid: {
                            color: '#ebedef'
                        }
                    }
                }
            };

            this.chartData = {
                labels: [],
                datasets: [
                    {
                        label: 'In',
                        data: [],
                        fill: false,
                        borderColor: '#42A5F5',
                        tension: .4
                    },
                    {
                        label: 'Out',
                        data: [],
                        fill: false,
                        borderColor: '#FFA726',
                        tension: .4
                    }
                ],
            };

            this.chart = new Chart(this.$refs.canvas, {
                type: 'line',
                data: this.chartData,
                options: options,
            });

            this.$emit('loaded', this.chart);
        },
        addValue(label, inVal, outVal) {
            if (this.chartData === null) {
                return;
            }

            this.chartData.labels.push(label);
            this.chartData.datasets[0].data.push(inVal);
            this.chartData.datasets[1].data.push(outVal);

            if (this.chart !== null) {
                this.chart.update();
            }
        },
    }
};

const App = {
    components: {
        'p-inputswitch': primevue.inputswitch,
        'p-button': primevue.button,
        'p-inputnumber': primevue.inputnumber,
        'p-progressbar': primevue.progressbar,
        'p-chart': ChartComponent,
    },
    data() {
        return {
            connected: false,
            message: 'Tion 3S',
            enable: false,
            fanSpeed: 1,
            airintakeMode: AIRINTAKE_CLOSED,
            temperatureIn: 0,
            temperatureOut: 0,
            heater: false,
            heaterTemperature: 0,
            sound: false,
            resourceFilters: 360,
        }
    },
    computed: {
        resourceFiltersPercentage() {
            if (this.resourceFilters <= 0 || this.resourceFilters > 360) {
                return 1;
            }

            return Math.floor((this.resourceFilters * 100) / 360);
        }
    },
    mounted() {
        this.timer = null;
    },
    methods: {
        onInputEnable(value) {
            this.setState();
        },
        setFanSpeed(speed) {
            this.fanSpeed = speed;
            this.setState();
        },
        setAirintakeMode(mode) {
            this.airintakeMode = mode;
            this.setState();
        },
        connect() {
            const options = {
                optionalServices: [SERVICE_UUID],
                acceptAllDevices: true,
            };

            navigator.bluetooth.requestDevice(options).then((device) => {
                tionDevice = device;
                return device.gatt.connect();
            }).then((server) => {
                return server.getPrimaryService(SERVICE_UUID);
            }).then((service) => {
                tionService = service;
                return service.getCharacteristic(NOTIFY_UUID);
            }).then((characteristic) => {
                characteristic.startNotifications().then(() => {
                    characteristic.addEventListener('characteristicvaluechanged', this.notifyCallback)
                });

                this.getState();
                this.connected = true;
            }).catch((error) => {
                this.disconnect();
                console.error(error);
            });
        },
        disconnect() {
            this.connected = false;
            tionService = null;

            if (tionDevice !== null) {
                tionDevice.gatt.disconnect();
                tionDevice = null;
            }
        },
        pair() {
            const options = {
                optionalServices: [SERVICE_UUID],
                acceptAllDevices: true,
            };

            navigator.bluetooth.requestDevice(options).then((device) => {
                tionDevice = device;
                return device.gatt.connect();
            }).then((server) => {
                return server.getPrimaryService(SERVICE_UUID);
            }).then((service) => {
                return service.getCharacteristic(WRITE_UUID);
            }).then((characteristic) => {
                return characteristic.writeValueWithoutResponse(createCommand(COMMAND_PAIR));
            }).then(() => {
                tionDevice.gatt.disconnect();
                tionDevice = null;
            }).catch((error) => {
                if (tionDevice !== null) {
                    tionDevice.gatt.disconnect();
                    tionDevice = null;
                }

                console.error(error);
            });
        },
        getState() {
            if (tionService === null || tionDevice === null) {
                return;
            }

            tionService.getCharacteristic(WRITE_UUID).then((characteristic) => {
                characteristic.writeValueWithoutResponse(createCommand(COMMAND_REQUEST_PARAMS));
            }).catch((error) => {
                console.error(error);
            });
        },
        setState() {
            if (tionService === null || tionDevice === null) {
                return;
            }

            const bytes = createCommand(COMMAND_SET_PARAMS);

            bytes[2] = this.fanSpeed;
            bytes[3] = this.heaterTemperature;
            bytes[4] = this.airintakeMode;
            bytes[5] = ((this.heater ? 1 : 0) | ((this.enable ? 1 : 0) << 1) | ((this.sound ? 1 : 0) << 3));
            bytes[6] = 1; // ???
            /*
            if (resetFilters) {
                bytes[7] = (bytes[7] | 2);
            }
            */
            // bytes[10] = (skipSettings ? 1 : 0); // сброс настроек

            const hex = [];

            for (let i = 0; i < 20; i++) {
                let hexStr = bytes[i].toString(16);

                if (hexStr.length === 1) {
                    hexStr = `0${hexStr}`;
                }

                hex.push(hexStr);
            }

            console.log(hex.join(' '));

            tionService.getCharacteristic(WRITE_UUID).then((characteristic) => {
                characteristic.writeValueWithoutResponse(bytes);
            }).catch((error) => {
                console.error(error);
            });
        },
        notifyCallback(event) {
            if (this.timer) {
                clearTimeout(this.timer);
            }

            this.timer = setTimeout(this.getState, 10000);

            const value = event.target.value;

            const hex = [];
            const data = [];

            for (let i = 0; i < 20; i++) {
                let hexStr = value.getUint8(i).toString(16);

                if (hexStr.length === 1) {
                    hexStr = `0${hexStr}`;
                }

                hex.push(hexStr);

                // отбрасываем первые два байта и последний байт
                // первый байт - ????
                // второй байт RESPONSE_xxx в данном случаии RESPONSE_REQUEST_PARAMS = 16
                // последений байт postix code = 90
                if (i >= 2 && i < 19) {
                    data.push(value.getUint8(i));
                }
            }

            console.log(hex.join(' '));

            this.enable = (((data[2] >> 1) & 1) === 1);
            this.heater = ((data[2] & 1) === 1);
            this.sound = (((data[2] >> 3) & 1) === 1);
            this.heaterTemperature = data[1];
            this.fanSpeed = data[0] & 0b1111;

            const tempIn = signValue(data[6]);
            this.temperatureIn = tempIn;

            const tempOut = getOutputTemperature(signValue(data[4]), signValue(data[5]));
            this.temperatureOut = tempOut;

            this.airintakeMode = ((data[0] & 0b11110000) >> 4);
            this.resourceFilters = getResourceFiltersInDays(getWord2Int(data[7], data[8]));

            // console.log('Airintake Mode:', this.airintakeMode);
            console.log('Timer On:', (data[2] >> 2) & 1);
            console.log('Sound Enabled:', (data[2] >> 3) & 1);
            // console.log('Version Of Firmware:', data[16], data[15]);
            // console.log('Output Temperature Left:', signValue(data[5]));
            // console.log('Output Temperature Right:', signValue(data[4]));
            // console.log('Version Of Firmware Hex:', data[16].toString(16), data[15].toString(16));
            console.log('Error Warning:', data[11]);
            console.log('Time:', `${data[9]}:${data[10]}`);
            console.log('Presets On:', data[3] & 1);
            console.log('Magic Air Connected:', (data[2] >> 5) & 1);
            console.log('Productivity:', data[12]);
            console.log('Unknown:', data[13], data[14]);

            const now = new Date();
            let hour = now.getHours();
            let minute = now.getMinutes();
            let second = now.getSeconds();

            if (hour < 10) {
                hour = `0${hour}`;
            }

            if (minute < 10) {
                minute = `0${minute}`;
            }

            if (second < 10) {
                second = `0${second}`;
            }

            this.$refs.chart.addValue(`${hour}:${minute}:${second}`, tempIn, tempOut);
        },
        tionResponse(event) {
            const value = event.target.value;
        },
    },
};

createApp(App).use(primevue.config.default).mount("#app");
