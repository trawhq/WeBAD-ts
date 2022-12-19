import { average } from './utils';
import {
  MAX_INTERSPEECH_SILENCE_MSECS,
  MIN_AVERAGE_SIGNAL_VOLUME,
  MIN_SIGNAL_DURATION,
  PRE_RECORD_START_MSECS,
  SAMPLE_POLLING_MSECS,
  VOLUME_MUTE,
  VOLUME_SIGNAL,
  VOLUME_SILENCE,
} from './audioDetectionConfig';
import VolumeMeter from './volume-meter';
import { MuteEventDetail, PreSpeechStartEventDetail, SilenceEventDetail } from './events';

export interface AudioDetectionConfig {
  timeoutMilliSecs?: number;
  prespeechstartMilliSecs?: number;
  speakingMinVolume?: number;
  silenceVolume?: number;
  muteVolume?: number;
  recordingEnabled?: boolean;
}

/**
 * audio speech detection
 *
 * emit these custom events:
 *
 *  AUDIO SAMPLING:
 *    'clipping' -> TODO, audio volume is clipping (~1),
 *                  probably user is speaking, but volume produces distorsion
 *    'signal'   -> audio volume is high, so probably user is speaking.
 *    'silence'  -> audio volume is pretty low, the mic is on but there is not speech.
 *    'mute'     -> audio volume is almost zero, the mic is off.
 *
 *  MICROPHONE:
 *    'unmutedmic'  -> microphone is UNMUTED (passing from OFF to ON)
 *    'mutedmic'    -> microphone is MUTED (passing from ON to OFF)
 *
 *  RECORDING:
 *    'prespeechstart' -> speech prerecording START
 *    'speechstart'    -> speech START
 *    'speechstop'     -> speech STOP (success, recording seems a valid speech)
 *    'speechabort'    -> speech ABORTED (because level is too low or audio duration length too short)
 *
 *
 * @param {Object} config
 * @see DEFAULT_PARAMETERS_CONFIGURATION object in audioDetectionConfig.js
 *
 * @see https://javascript.info/dispatch-events
 *
 */
export class AudioDetection extends EventTarget {
  /**
   * volumeState
   *
   * volume range state of a single sample. Possible values:
   *
   *   'mute'
   *   'silence'
   *   'signal'
   *   'clipping' TODO
   *
   */
  public volumeState = 'mute';
  private speechStarted = false;
  private silenceItems = 0;
  private signalItems = 0;
  private speechstartTime = 0;
  private prerecordingItems = 0;
  private speechVolumesList: number[] = [];

  private maxSilenceItems = Math.round(MAX_INTERSPEECH_SILENCE_MSECS / SAMPLE_POLLING_MSECS);

  private readonly meter: VolumeMeter;
  private readonly timeoutMilliSecs: number;
  private readonly prespeechstartMilliSecs: number;
  private readonly speakingMinVolume: number;
  private readonly silenceVolume: number;
  private readonly muteVolume: number;
  private readonly recordingEnabled: boolean;

  private stopRunning = false;

  constructor(
    meter: VolumeMeter,
    {
      timeoutMilliSecs = SAMPLE_POLLING_MSECS,
      prespeechstartMilliSecs = PRE_RECORD_START_MSECS,
      speakingMinVolume = VOLUME_SIGNAL,
      silenceVolume = VOLUME_SILENCE,
      muteVolume = VOLUME_MUTE,
      recordingEnabled = true,
    }: AudioDetectionConfig = {},
  ) {
    super();
    this.meter = meter;
    this.timeoutMilliSecs = timeoutMilliSecs;
    this.prespeechstartMilliSecs = prespeechstartMilliSecs;
    this.speakingMinVolume = speakingMinVolume;
    this.silenceVolume = silenceVolume;
    this.muteVolume = muteVolume;
    this.recordingEnabled = recordingEnabled;
  }

  /**
   * methods
   */
  private averageSignal(): number {
    return average(this.speechVolumesList);
  }

  /**
   * mute
   *
   * Emits 2 custom events:
   *
   *  AUDIO SAMPLING:
   *    'mute'    -> audio volume is almost zero, the mic is off.
   *
   *  MICROPHONE:
   *    'mutedmic' -> microphone is MUTED (passing from ON to OFF)
   */
  private mute(timestamp: number, duration: number) {
    const eventData: MuteEventDetail = {
      detail: {
        event: 'mute',
        volume: this.meter.volume,
        timestamp,
        duration,
      },
    };

    this.dispatchEvent(new CustomEvent('mute', eventData));

    // mic is muted (is closed)
    // trigger event on transition
    if (this.volumeState !== 'mute') {
      this.dispatchEvent(new CustomEvent('mutedmic', eventData));
      this.volumeState = 'mute';
    }
  }

  /**
   * signal
   *
   * Emits 3 custom events:
   *
   *  AUDIO SAMPLING:
   *    'signal'  -> audio volume is high, so probably user is speaking.
   *
   *  MICROPHONE:
   *    'unmutedmic'  -> microphone is UNMUTED (passing from OFF to ON)
   *
   *  RECORDING:
   *    'speechstart' -> speech START
   *
   */
  private signal(timestamp: number, duration: number) {
    this.silenceItems = 0;

    const eventData = {
      detail: {
        event: 'signal',
        volume: this.meter.volume,
        timestamp,
        duration,
        items: ++this.signalItems,
      },
    };

    if (!this.speechStarted) {
      this.dispatchEvent(new CustomEvent('speechstart', eventData));

      this.speechstartTime = timestamp;
      this.speechStarted = true;
      this.speechVolumesList = [];
    }

    this.speechVolumesList.push(this.meter.volume);

    this.dispatchEvent(new CustomEvent('signal', eventData));

    // mic is unmuted (is open)
    // trigger event on transition
    if (this.volumeState === 'mute') {
      this.dispatchEvent(new CustomEvent('unmutedmic', eventData));
      this.volumeState = 'signal';
    }
  }

  /**
   * silence
   *
   * Emits 3 custom events:
   *
   *  AUDIO SAMPLING:
   *    'silence' -> audio volume is pretty low, the mic is on but there is not speech.
   *
   *  MICROPHONE:
   *    'unmutedmic'  -> microphone is UNMUTED (passing from OFF to ON)
   *
   *  RECORDING:
   *    'speechstop'  -> speech recording STOP (success, recording seems a valid speech)
   *    'speechabort' -> speech recording ABORTED (because level is too low or audio duration length too short)
   *
   */
  private silence(timestamp: number, duration: number) {
    this.signalItems = 0;

    const eventData: SilenceEventDetail = {
      detail: {
        event: 'silence',
        volume: this.meter.volume,
        timestamp,
        duration,
        items: ++this.silenceItems,
        abort: undefined,
      },
    };

    this.dispatchEvent(new CustomEvent('silence', eventData));

    // mic is unmuted (goes ON)
    // trigger event on transition
    if (this.volumeState === 'mute') {
      this.dispatchEvent(new CustomEvent('unmutedmic', eventData));
      this.volumeState = 'silence';
    }

    //
    // after a MAX_INTERSPEECH_SILENCE_MSECS
    // a virdict event is generated:
    //   speechabort if audio chunck is to brief or at too low volume
    //   speechstop  if audio chunk appears to be a valid speech
    //
    if (this.speechStarted && this.silenceItems === this.maxSilenceItems) {
      const signalDuration = duration - MAX_INTERSPEECH_SILENCE_MSECS;
      const averageSignalValue = this.averageSignal();

      // speech abort
      // signal duration too short
      if (signalDuration < MIN_SIGNAL_DURATION) {
        eventData.detail.abort = `signal duration (${signalDuration}) < MIN_SIGNAL_DURATION (${MIN_SIGNAL_DURATION})`;
        this.dispatchEvent(new CustomEvent('speechabort', eventData));
      }

      // speech abort
      // signal level too low
      else if (averageSignalValue < MIN_AVERAGE_SIGNAL_VOLUME) {
        eventData.detail.abort = `signal average volume (${averageSignalValue}) < MIN_AVERAGE_SIGNAL_VOLUME (${MIN_AVERAGE_SIGNAL_VOLUME})`;
        this.dispatchEvent(new CustomEvent('speechabort', eventData));
      }

      // speech stop
      // audio chunk appears to be a valid speech
      else {
        this.dispatchEvent(new CustomEvent('speechstop', eventData));
      }

      this.speechStarted = false;
    }
  }

  /**

   volume level
   0.0 .---->-.----->--.-------->--.-------->--.------> 1.0
   ^      ^        ^           ^           ^
   |      |        |           |           |
   mute   unmute   silence     speaking    clipping

   */
  private sampleThresholdsDecision() {
    const timestamp = Date.now();
    const duration = timestamp - this.speechstartTime;

    if (this.meter.volume < this.muteVolume) {
      // MUTE
      // mic is OFF/mute (volume is ~0)
      this.mute(timestamp, duration);
    } else if (this.meter.volume > this.speakingMinVolume) {
      // SIGNAL
      // audio detection, maybe it's SPEECH
      this.signal(timestamp, duration);
    } else {
      // (meter.volume < config.silenceVolume)
      // SILENCE
      // mic is ON. Audio level is low (background noise)
      this.silence(timestamp, duration);
    }
  }

  /**
   * prerecording
   *
   * Emits the event:
   *
   *  RECORDING:
   *    'prespeechstart' -> speech prerecording START
   *
   * Every prespeechstartMsecs milliseconds,
   * in SYNC with the main sampling (every timeoutMsecs milliseconds)
   *
   */
  private prerecording() {
    ++this.prerecordingItems;

    const eventData: PreSpeechStartEventDetail = {
      detail: {
        event: 'prespeechstart',
        volume: this.meter.volume,
        timestamp: Date.now(),
        items: this.prerecordingItems,
      },
    };

    // emit event 'prespeechstart' every prespeechstartMilliSecs.
    // considering that prespeechstartMilliSecs is a multiple of timeoutMsecs
    if (this.prerecordingItems * this.timeoutMilliSecs >= this.prespeechstartMilliSecs) {
      // emit the event if speech is not started
      if (!this.speechStarted) {
        this.dispatchEvent(new CustomEvent('prespeechstart', eventData));
      }

      this.prerecordingItems = 0;
    }
  }

  private run() {
    setTimeout(() => {
      this.prerecording();

      // to avoid feedback, recording could be suspended
      // when the system play audio with a loudspeakers
      if (this.recordingEnabled) {
        this.sampleThresholdsDecision();
      }

      if (!this.stopRunning) {
        // recursively call this function
        this.run();
      }
    }, this.timeoutMilliSecs);
  }

  start() {
    this.stopRunning = false;
    this.run();
  }

  stop() {
    this.stopRunning = true;
  }
}
