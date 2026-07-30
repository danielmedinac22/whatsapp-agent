/**
 * opus-recorder no trae tipos. Se declara solo lo que usamos: grabar ogg/opus
 * en el navegador, que es el único formato con el que Meta acepta una nota de
 * voz (`voice: true`) — Chrome graba webm y Meta lo rechaza.
 */
declare module "opus-recorder" {
  interface RecorderOptions {
    encoderPath?: string;
    encoderApplication?: number;
    encoderSampleRate?: number;
    numberOfChannels?: number;
    streamPages?: boolean;
    monitorGain?: number;
    recordingGain?: number;
    maxFramesPerPage?: number;
  }

  export default class Recorder {
    constructor(options?: RecorderOptions);
    static isRecordingSupported(): boolean;
    /** Bytes del archivo completo (ogg/opus) al detener. */
    ondataavailable: ((data: Uint8Array) => void) | null;
    onstart: (() => void) | null;
    onstop: (() => void) | null;
    start(): Promise<void>;
    stop(): void;
    close(): void;
  }
}
